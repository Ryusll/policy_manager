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
import { hashRefreshToken, sessionTtlMs } from './session-policy';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, meta: { userAgent?: string } = {}) {
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

    return this.buildAuthResponse(user, { remember: dto.remember === true, userAgent: meta.userAgent });
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

    return this.buildAuthResponse(user, { remember: false });
  }

  /**
   * 로그인 = 이 기기의 세션 하나를 연다 (T-137).
   *
   * 예전에는 사용자당 갱신 토큰을 하나만 저장해서, 다른 PC·브라우저에서 로그인하면 먼저 쓰던 쪽이
   * 다음 갱신 때 튕겼다. 이제 기기마다 세션 행이 있고, 토큰에는 세션 id(`sid`)가 실린다.
   */
  private async buildAuthResponse(
    user: {
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
    },
    opts: { remember: boolean; userAgent?: string },
  ) {
    const now = new Date();
    const ttl = sessionTtlMs(opts.remember);
    const sessionId = randomUUID();
    const tokens = await this.generateTokens(user, sessionId, ttl);
    await this.prisma.$transaction([
      // 끝난 세션은 그 사람이 다시 로그인할 때 치운다 — 행이 끝없이 쌓이지 않게
      this.prisma.authSession.deleteMany({
        where: {
          userId: user.id,
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 86_400_000) } }],
        },
      }),
      this.prisma.authSession.create({
        data: {
          id: sessionId,
          userId: user.id,
          tokenHash: hashRefreshToken(tokens.refreshToken),
          remember: opts.remember,
          expiresAt: new Date(now.getTime() + ttl),
          userAgent: opts.userAgent ? opts.userAgent.slice(0, 300) : null,
        },
      }),
    ]);

    return {
      ...tokens,
      remember: opts.remember,
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
   * 갱신 — 서명·만료를 검증하고(T-42), 세션이 살아 있고 **지금 유효한 토큰**인지 본 뒤 회전한다.
   * 회전할 때마다 세션 만료도 다시 늘어난다(자동 로그인 30일, 아니면 12시간).
   */
  async refresh(refreshToken: string) {
    let payload: { sub?: string; sid?: string };
    try {
      payload = await this.jwtService.verifyAsync<{ sub?: string; sid?: string }>(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!payload?.sub) throw new UnauthorizedException('Invalid refresh token');
    if (!payload.sid) return this.refreshLegacy(payload.sub, refreshToken);

    const now = new Date();
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { tenant: true } } },
    });
    const presented = hashRefreshToken(refreshToken);
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= now ||
      // 회전된 옛 토큰 — 다른 탭이 먼저 갱신했거나, 누가 훔친 토큰이다
      session.tokenHash !== presented
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const ttl = sessionTtlMs(session.remember);
    const tokens = await this.generateTokens(session.user, session.id, ttl);
    // 같은 토큰으로 두 요청이 동시에 와도 한쪽만 회전한다 — 바꾸기 전 토큰 해시를 조건으로 건다
    const { count } = await this.prisma.authSession.updateMany({
      where: { id: session.id, tokenHash: presented, revokedAt: null },
      data: {
        tokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt: new Date(now.getTime() + ttl),
        lastUsedAt: now,
      },
    });
    if (count !== 1) throw new UnauthorizedException('Invalid refresh token');
    return { ...tokens, remember: session.remember };
  }

  /**
   * T-137 배포 전에 받은 갱신 토큰(세션 id 없음) — 사용자당 하나 저장하던 값과 맞으면 **한 번만**
   * 세션으로 옮긴다. 배포했다고 모두를 로그인 화면으로 보내지 않으려는 것이다. 자동 로그인 여부는
   * 알 수 없으니 기본(12시간)으로 연다.
   */
  private async refreshLegacy(userId: string, refreshToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
    if (!user || !user.refreshToken || user.refreshToken !== refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, refreshToken },
      data: { refreshToken: null },
    });
    if (count !== 1) throw new UnauthorizedException('Invalid refresh token');
    const res = await this.buildAuthResponse(user, { remember: false });
    return { accessToken: res.accessToken, refreshToken: res.refreshToken, remember: false };
  }

  /** 로그아웃 = 이 기기의 세션만 끝낸다. 세션을 모르는 옛 토큰이면 그 사람의 세션을 모두 끝낸다 */
  async logout(userId: string, sessionId?: string | null) {
    const now = new Date();
    if (sessionId) {
      await this.prisma.authSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return;
    }
    await this.prisma.$transaction([
      this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.user.update({ where: { id: userId }, data: { refreshToken: null } }),
    ]);
  }

  /** 서명과 검증이 서로 다른 값을 쓰지 않도록 한곳에서 읽는다 */
  private refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET || 'refresh-secret';
  }

  private async generateTokens(
    user: { id: string; email: string; role: string },
    sessionId: string,
    refreshTtlMs: number,
  ) {
    // `jti` 가 없으면 같은 초에 두 번 발급된 토큰이 **글자까지 똑같다**(iat 가 초 단위라).
    // 그러면 갱신이 회전이 아니게 되고 — 옛 토큰이 그대로 살아 있다 —
    // 저장값 비교로 폐기할 방법도 사라진다(T-42 통합 테스트에서 드러났다).
    // `sid` 는 어느 기기의 세션인지 — 로그아웃이 그 기기의 세션만 끝내는 데 쓴다(T-137).
    // 세션이 끝나도 이미 받은 접근 토큰은 예전처럼 만료(15분)까지 통한다 — 갱신만 막힌다
    const base = { sub: user.id, email: user.email, role: user.role, sid: sessionId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...base, jti: randomUUID() },
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
      ),
      this.jwtService.signAsync(
        { ...base, jti: randomUUID() },
        { secret: this.refreshSecret(), expiresIn: Math.ceil(refreshTtlMs / 1000) },
      ),
    ]);
    return { accessToken, refreshToken };
  }
}
