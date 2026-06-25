import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY, ROLES_KEY } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPlatformRoles = this.reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles && !requiredPlatformRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException();

    if (requiredPlatformRoles && !requiredPlatformRoles.includes(user.platformRole || 'none')) {
      throw new ForbiddenException('Insufficient platform permissions');
    }

    if (requiredRoles && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}