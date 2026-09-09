import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenantBrandingController } from './tenant-branding.controller';
import { TenantBrandingService } from './tenant-branding.service';

@Module({
  imports: [AuditModule],
  controllers: [TenantBrandingController],
  providers: [TenantBrandingService],
})
export class TenantBrandingModule {}
