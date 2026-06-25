import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [AuditModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
