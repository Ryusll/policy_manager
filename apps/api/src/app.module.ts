import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PoliciesModule } from './policies/policies.module';
import { VersionsModule } from './versions/versions.module';
import { VariablesModule } from './variables/variables.module';
import { SearchModule } from './search/search.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { TenantBrandingModule } from './tenant-branding/tenant-branding.module';
import { ExportModule } from './export/export.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PlanGuard } from './common/guards/plan.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { IntegrationsModule } from './integrations/integrations.module';
import { BillingModule } from './billing/billing.module';
import { UsersModule } from './users/users.module';
import { HealthController } from './health.controller';
import { CommentsModule } from './comments/comments.module';
import { TemplatesModule } from './templates/templates.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { RegulationParseModule } from './regulation-parse/regulation-parse.module';
import { LawGoKrModule } from './lawgokr/lawgokr.module';
import { PlatformBrandingModule } from './platform-branding/platform-branding.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FavoritesModule } from './favorites/favorites.module';

@Module({
  controllers: [HealthController],
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    PoliciesModule,
    VersionsModule,
    VariablesModule,
    SearchModule,
    AdminModule,
    AuditModule,
    TenantBrandingModule,
    ExportModule,
    IntegrationsModule,
    BillingModule,
    UsersModule,
    CommentsModule,
    TemplatesModule,
    PlatformAdminModule,
    RegulationParseModule,
    LawGoKrModule,
    PlatformBrandingModule,
    NotificationsModule,
    FavoritesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PlanGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}