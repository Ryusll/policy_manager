import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secret',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      platformRole: (user as any).platformRole || 'none',
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      tenantName: user.tenant.name,
      plan: user.tenant.plan,
      planExpiresAt: (user.tenant as any).planExpiresAt ?? null,
      billingStatus: (user.tenant as any).billingStatus ?? 'active',
      tenant: user.tenant,
    };
  }
}