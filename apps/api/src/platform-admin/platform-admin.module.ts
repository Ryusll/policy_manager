import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformBrandingModule } from '../platform-branding/platform-branding.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [AuditModule, PlatformBrandingModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}

