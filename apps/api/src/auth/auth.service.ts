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

    // 비밀번호 없는 계정은 예전 구글 로그인으로 만든 것이다. 구글 로그인을 없앴으므로(T-136)
    // 회사 관리자가 비밀번호를 재설정해 줘야 들어온다 — 무엇이 틀렸는지 알 수 있게 따로 알린다
    if (!user.passwordHash) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'PASSWORD_NOT_SET',
        message: 'Password not set for this account',
      });
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

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    platformRole?: string;
    mustChangePassword?: boolean;
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
        // 남이 정해 준 비밀번호로 들어왔다 — 화면이 비밀번호 변경부터 시킨다(T-122)
        mustChangePassword: user.mustChangePassword === true,
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
