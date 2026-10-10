import { Controller, Post, Get, Body, Request, HttpCode, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, RegisterDto } from './auth.dto';
import { AllowDuringPasswordChange, Public } from '../common/guards/decorators';
import { publicSignupEnabled, SIGNUP_CLOSED_MESSAGE } from './signup-policy';

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

  /** 로그인 화면이 회원가입 링크를 보일지 정한다 (T-122) */
  @Public()
  @Get('options')
  @ApiOperation({ summary: '로그인 화면 설정 — 공개 회원가입 허용 여부' })
  options() {
    return { publicSignup: publicSignupEnabled() };
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register new tenant — 공개 회원가입이 닫혀 있으면 403 (T-122)' })
  register(@Body() dto: RegisterDto) {
    if (!publicSignupEnabled()) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'SIGNUP_CLOSED',
        message: SIGNUP_CLOSED_MESSAGE,
      });
    }
    return this.authService.register(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @AllowDuringPasswordChange()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Logout' })
  logout(@Request() req: any) {
    return this.authService.logout(req.user.id);
  }

  @AllowDuringPasswordChange()
  @Post('me')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get current user' })
  me(@Request() req: any) {
    return req.user;
  }
}