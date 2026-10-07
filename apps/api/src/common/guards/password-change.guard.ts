import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_DURING_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from './decorators';

export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/**
 * 남(회사 관리자·아스트룸)이 정해 준 비밀번호로 들어온 사용자는 비밀번호를 바꾸기 전까지
 * 변경·로그아웃·내 정보 외에는 아무것도 못 한다 (T-122).
 *
 * 화면만 막으면 장식이다 — 정해 준 사람은 그 비밀번호를 알고 있으므로, API 를 직접 부르면 그대로
 * 쓸 수 있다. 그래서 서버가 막는다. JwtAuthGuard 바로 다음에 돈다(그래야 `req.user` 가 있다).
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE_KEY, targets)) return true;

    const { user } = context.switchToHttp().getRequest();
    if (user?.mustChangePassword) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: PASSWORD_CHANGE_REQUIRED,
        message: '비밀번호를 먼저 바꿔야 합니다. 관리자가 정해 준 비밀번호는 처음 로그인할 때 바꿔야 합니다.',
      });
    }
    return true;
  }
}
