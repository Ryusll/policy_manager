import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import type { GoogleOAuthProfile } from './google.strategy';
import type { GoogleOAuthState } from './oauth-state';
import { resolveGoogleAccount, GoogleOAuthRejection } from './google-account-resolution';

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

  /**
   * 콜백에서 넘어온 구글 신원을 계정으로 잇는다 (T-42).
   *
   * 판단은 전부 `resolveGoogleAccount` 에 있다 — 이 경로는 구글 없이는 통합
   * 테스트로 재현할 수 없어서, 분기를 DB 밖으로 빼내야 실제로 확인할 수 있다.
   * 여기서는 조회와 실행만 한다.
   */
  async completeGoogleOAuth(
    profile: GoogleOAuthProfile,
    state: GoogleOAuthState,
  ) {
    const slug = this.normalizeTenantSlug(
      state.mode === 'register' ? state.tenantSlug : state.tenantSlug || 'demo',
    );

    const linked = await this.prisma.user.findFirst({
      where: { oauthProvider: 'google', oauthSub: profile.googleId },
      include: { tenant: true },
    });
    const tenant = slug ? await this.prisma.tenant.findUnique({ where: { slug } }) : null;
    const userInTenant = tenant
      ? await this.prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email: profile.email } },
        })
      : null;

    const decision = resolveGoogleAccount({
      identity: {
        email: profile.email,
        name: profile.name,
        googleId: profile.googleId,
        emailVerified: profile.emailVerified,
      },
      mode: state.mode,
      tenantSlug: slug,
      tenantName: state.tenantName ?? '',
      linkedUser: linked ? { id: linked.id, tenantSlug: linked.tenant.slug } : null,
      tenant: tenant ? { id: tenant.id } : null,
      userInTenant: userInTenant
        ? { id: userInTenant.id, oauthSub: userInTenant.oauthSub }
        : null,
    });

    switch (decision.kind) {
      case 'reject':
        throw new GoogleOAuthRejection(decision.code, decision.message);

      case 'authenticate': {
        const user = await this.prisma.user.findUniqueOrThrow({
          where: { id: decision.userId },
          include: { tenant: true },
        });
        return this.buildAuthResponse(user);
      }

      case 'link': {
        const user = await this.prisma.user.update({
          where: { id: decision.userId },
          data: {
            oauthProvider: 'google',
            oauthSub: profile.googleId,
            name: profile.name || undefined,
          },
          include: { tenant: true },
        });
        return this.buildAuthResponse(user);
      }

      case 'createTenant': {
        const created = await this.prisma.tenant.create({
          data: { name: decision.tenantName, slug: decision.tenantSlug },
        });
        const user = await this.prisma.user.create({
          data: {
            tenantId: created.id,
            email: profile.email,
            name: profile.name,
            passwordHash: null,
            oauthProvider: 'google',
            oauthSub: profile.googleId,
            role: 'admin',
          },
          include: { tenant: true },
        });
        return this.buildAuthResponse(user);
      }
    }
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

  /**
   * 예전에는 컨트롤러가 JWT 페이로드를 **검증 없이** 잘라 `sub` 를 꺼내 넘겼다.
   * 저장된 토큰과 문자열 비교를 하고 있어 위조는 막혔지만, **만료는 아무도 보지
   * 않았다** — `JWT_REFRESH_EXPIRES_IN` 이 장식이었다는 뜻이다. 형식이 어긋난
   * 값에는 500 이 났다. 여기서 제대로 검증한다(T-42).
   */
  async refresh(refreshToken: string) {
    let userId: string;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(refreshToken, {
        secret: this.refreshSecret(),
      });
      userId = payload?.sub;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!userId) throw new UnauthorizedException('Invalid refresh token');

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

  /** 서명과 검증이 서로 다른 값을 쓰지 않도록 한곳에서 읽는다 */
  private refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET || 'refresh-secret';
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    role: string;
  }) {
    // `jti` 가 없으면 같은 초에 두 번 발급된 토큰이 **글자까지 똑같다**(iat 가 초 단위라).
    // 그러면 갱신이 회전이 아니게 되고 — 옛 토큰이 그대로 살아 있다 —
    // 저장값 비교로 폐기할 방법도 사라진다(T-42 통합 테스트에서 드러났다).
    const base = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...base, jti: randomUUID() },
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
      ),
      this.jwtService.signAsync(
        { ...base, jti: randomUUID() },
        {
          secret: this.refreshSecret(),
          expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
        },
      ),
    ]);
    return { accessToken, refreshToken };
  }
}
