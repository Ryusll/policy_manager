import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
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
import { LawsModule } from './laws/laws.module';
import { LawLinksModule } from './law-links/law-links.module';
import { LawChangesModule } from './law-changes/law-changes.module';
import { AmendmentsModule } from './amendments/amendments.module';
import { PlatformBrandingModule } from './platform-branding/platform-branding.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FavoritesModule } from './favorites/favorites.module';
import { AskModule } from './ask/ask.module';
import { LockBusyFilter } from './common/lock-busy.filter';

@Module({
  controllers: [HealthController],
  imports: [
    // IP 당·경로별 분당 한도. 운영은 기본 100 그대로다. 통합 테스트는 한 IP 에서 수백 번 로그인하므로
    // 개발·CI(docker-compose.yml)만 올린다 — 첫 로그인 비밀번호 변경(T-122)으로 로그인이 늘었다
    ThrottlerModule.forRoot([{ ttl: 60000, limit: Number(process.env.THROTTLE_LIMIT) || 100 }]),
    PrismaModule,
    AuthModule,
    PoliciesModule,
    VersionsModule,
    VariablesModule,
    SearchModule,
    AdminModule,
    AuditModule,
    TenantBrandingModule,
    IntegrationsModule,
    BillingModule,
    UsersModule,
    CommentsModule,
    TemplatesModule,
    PlatformAdminModule,
    RegulationParseModule,
    LawGoKrModule,
    LawsModule,
    LawLinksModule,
    LawChangesModule,
    AmendmentsModule,
    PlatformBrandingModule,
    NotificationsModule,
    FavoritesModule,
    AskModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 인증 직후 — 남이 정해 준 비밀번호를 바꾸기 전에는 거의 모든 API 를 막는다(T-122)
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: PlanGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // 잠금 기다림·교착·트랜잭션 제한 → 다시 시도할 수 있는 응답(T-131)
    { provide: APP_FILTER, useClass: LockBusyFilter },
  ],
})
export class AppModule {}