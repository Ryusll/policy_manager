import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import type { GoogleOAuthProfile } from './google.strategy';
import type { GoogleOAuthState } from './oauth-state';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const slug = (dto.tenantSlug || 'demo').trim().toLowerCase();
    const email = dto.email.trim().toLowerCase();

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (!tenant) throw new UnauthorizedException('Tenant not found');

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      include: { tenant: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.passwordHash) {
      throw new UnauthorizedException('Use Google sign-in for this account');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.buildAuthResponse(user);
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (existing) throw new ConflictException('Tenant slug already exists');

    const tenant = await this.prisma.tenant.create({
      data: { name: dto.tenantName, slug: dto.tenantSlug },
    });

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: 'admin',
      },
      include: { tenant: true },
    });

    return this.buildAuthResponse(user);
  }

  async completeGoogleOAuth(
    profile: GoogleOAuthProfile,
    state: GoogleOAuthState,
  ) {
    const { googleId } = profile;

    const existingOAuth = await this.prisma.user.findFirst({
      where: { oauthProvider: 'google', oauthSub: googleId },
      include: { tenant: true },
    });
    if (existingOAuth) {
      if (state.mode === 'register') {
        throw new ConflictException(
          'This Google account is already registered. Sign in instead.',
        );
      }
      const slug = this.normalizeTenantSlug(state.tenantSlug || 'demo');
      if (existingOAuth.tenant.slug !== slug) {
        throw new BadRequestException(
          `This Google account belongs to organization "${existingOAuth.tenant.slug}"`,
        );
      }
      return this.buildAuthResponse(existingOAuth);
    }

    if (state.mode === 'register') {
      return this.registerWithGoogle(profile, state);
    }

    return this.loginWithGoogle(profile, state);
  }

  private async registerWithGoogle(
    profile: GoogleOAuthProfile,
    state: GoogleOAuthState,
  ) {
    const { email, name, googleId } = profile;
    const slug = this.normalizeTenantSlug(state.tenantSlug);
    if (slug.length < 2 || slug.length > 40) {
      throw new BadRequestException('Invalid organization code');
    }
    const tenantName = state.tenantName?.trim();
    if (!tenantName) {
      throw new BadRequestException('Organization name is required');
    }

    const existing = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('Organization code already exists');
    }

    const tenant = await this.prisma.tenant.create({
      data: { name: tenantName, slug },
    });

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name,
        passwordHash: null,
        oauthProvider: 'google',
        oauthSub: googleId,
        role: 'admin',
      },
      include: { tenant: true },
    });

    return this.buildAuthResponse(user);
  }

  private async loginWithGoogle(
    profile: GoogleOAuthProfile,
    state: GoogleOAuthState,
  ) {
    const { email, name, googleId } = profile;
    const slug = this.normalizeTenantSlug(state.tenantSlug || 'demo');

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (!tenant) {
      throw new BadRequestException('Organization not found');
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      include: { tenant: true },
    });

    if (byEmail) {
      if (byEmail.oauthSub) {
        if (byEmail.oauthSub !== googleId) {
          throw new ConflictException(
            'This email is linked to another Google account',
          );
        }
        return this.buildAuthResponse(byEmail);
      }
      const updated = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          oauthProvider: 'google',
          oauthSub: googleId,
          name: name || byEmail.name,
        },
        include: { tenant: true },
      });
      return this.buildAuthResponse(updated);
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name,
        passwordHash: null,
        oauthProvider: 'google',
        oauthSub: googleId,
        role: 'viewer',
      },
      include: { tenant: true },
    });

    return this.buildAuthResponse(user);
  }

  private normalizeTenantSlug(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    platformRole?: string;
    tenantId: string;
    tenant: {
      slug: string;
      name: string;
      plan: string;
      planExpiresAt?: Date | null;
      billingStatus?: string;
    };
  }) {
    const tokens = await this.generateTokens(user);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        platformRole: user.platformRole || 'none',
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
        tenantName: user.tenant.name,
        plan: user.tenant.plan,
        planExpiresAt: user.tenant.planExpiresAt || null,
        billingStatus: user.tenant.billingStatus || 'active',
      },
    };
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user || user.refreshToken !== refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(user);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: tokens.refreshToken },
    });
    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    role: string;
  }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret',
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
