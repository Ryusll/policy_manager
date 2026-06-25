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
import { parseGoogleOAuthState } from './oauth-state';
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
    const state = Buffer.from(
      JSON.stringify({
        mode: resolvedMode,
        tenantSlug: slug,
        tenantName: name,
      }),
    ).toString('base64url');
    passport.authenticate('google', {
      scope: ['email', 'profile'],
      state,
    })(req, res);
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth callback' })
  googleCallback(@Req() req: ExpressRequest, @Res() res: Response) {
    const fe = getPublicUrl();
    passport.authenticate(
      'google',
      { session: false },
      async (err: Error | null, user: GoogleOAuthProfile | false) => {
        if (err || !user) {
          return res.redirect(`${fe}/login?error=oauth`);
        }
        const state = parseGoogleOAuthState(req.query.state as string);
        if (!state) {
          return res.redirect(`${fe}/login?error=oauth_state`);
        }
        try {
          const result = await this.authService.completeGoogleOAuth(
            user,
            state,
          );
          const params = new URLSearchParams({
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
          });
          return res.redirect(`${fe}/oauth/callback?${params.toString()}`);
        } catch {
          return res.redirect(`${fe}/login?error=oauth`);
        }
      },
    )(req, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    const decoded: any = JSON.parse(
      Buffer.from(dto.refreshToken.split('.')[1], 'base64').toString(),
    );
    return this.authService.refresh(decoded.sub, dto.refreshToken);
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