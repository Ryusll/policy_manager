import {
  Controller,
  Post,
  Get,
  Body,
  Request,
  HttpCode,
  Req,
  Res,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request as ExpressRequest, Response } from 'express';
import * as passport from 'passport';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, RegisterDto } from './auth.dto';
import { Public } from '../common/guards/decorators';
import type { GoogleOAuthProfile } from './google.strategy';
import {
  createGoogleOAuthState,
  parseGoogleOAuthState,
  getOAuthStateSecret,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from './oauth-state';
import { GoogleOAuthRejection } from './google-account-resolution';
import { getPublicUrl } from '../common/config/public-url';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register new tenant' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Start Google OAuth (redirect)' })
  googleStart(
    @Req() req: ExpressRequest,
    @Res() res: Response,
    @Query('mode') mode?: string,
    @Query('tenantSlug') tenantSlug?: string,
    @Query('tenantName') tenantName?: string,
  ) {
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET
    ) {
      return res
        .status(503)
        .json({ message: 'Google OAuth is not configured' });
    }
    const resolvedMode = mode === 'register' ? 'register' : 'login';
    const slug = (tenantSlug || 'demo').trim();
    const name = (tenantName || '').trim();
    if (resolvedMode === 'register' && (!slug || !name)) {
      return res.status(400).json({
        message:
          'tenantSlug and tenantName are required when mode=register',
      });
    }
    // state 는 서명하고, 같은 난수를 쿠키에도 심는다. 콜백에서 둘을 대조해야
    // "남이 만든 콜백 URL 을 열게 하는" 공격(로그인 CSRF)을 막을 수 있다(T-42).
    const { state, nonce } = createGoogleOAuthState(
      { mode: resolvedMode, tenantSlug: slug, tenantName: name },
      getOAuthStateSecret(),
    );
    res.cookie(OAUTH_STATE_COOKIE, nonce, this.stateCookieOptions());
    passport.authenticate('google', {
      scope: ['email', 'profile'],
      state,
    })(req, res);
  }

  /**
   * httpOnly — 스크립트가 읽을 이유가 없다.
   * SameSite=Lax — 콜백은 구글에서 넘어오는 최상위 GET 이동이라 Lax 로 전달된다.
   *                None 으로 열면 아무 사이트나 이 쿠키를 실은 요청을 만들 수 있다.
   * path — 인증 경로 밖으로 새어 나갈 이유가 없다.
   */
  private stateCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: getPublicUrl().startsWith('https://'),
      path: '/api/auth',
      maxAge: OAUTH_STATE_TTL_MS,
    };
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  googleCallback(@Req() req: ExpressRequest, @Res() res: Response) {
    const fe = getPublicUrl();
    // 쿠키는 성패와 무관하게 바로 지운다. 같은 state 를 두 번 쓰면 두 번째는
    // 대조할 값이 없어 실패한다 — 재사용 방어가 여기서 나온다.
    const nonce = (req as ExpressRequest & { cookies?: Record<string, string> }).cookies?.[
      OAUTH_STATE_COOKIE
    ];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth' });

    const fail = (reason: string) =>
      res.redirect(`${fe}/login?error=oauth&reason=${encodeURIComponent(reason)}`);

    // **state 를 먼저 본다.** 예전에는 코드 교환이 끝난 뒤에야 state 를 봤다 —
    // 위조된 콜백 하나가 매번 구글로 나가는 요청을 만들었다는 뜻이다.
    const state = parseGoogleOAuthState(
      req.query.state as string,
      getOAuthStateSecret(),
      nonce,
    );
    if (!state) {
      return fail('state');
    }

    passport.authenticate(
      'google',
      { session: false },
      async (err: Error | null, user: GoogleOAuthProfile | false) => {
        if (err || !user) {
          return fail('provider');
        }
        try {
          const result = await this.authService.completeGoogleOAuth(user, state);
          const params = new URLSearchParams({
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
          });
          return res.redirect(`${fe}/oauth/callback?${params.toString()}`);
        } catch (e) {
          // 거부 사유를 잃으면 사용자는 "실패했습니다"만 보고 같은 실패를 반복한다.
          return fail(e instanceof GoogleOAuthRejection ? e.code : 'server');
        }
      },
    )(req, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout' })
  logout(@Request() req: any) {
    return this.authService.logout(req.user.id);
  }

  @Post('me')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get current user' })
  me(@Request() req: any) {
    return req.user;
  }
}