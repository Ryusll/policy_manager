import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogService } from './audit-log.service';
import { AuditController } from './audit.controller';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditLogService],
  exports: [AuditService],
})
export class AuditModule {}
