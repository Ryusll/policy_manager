import { Module } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PolicyPdfService } from './policy-pdf.service';
import { PolicyHwpxService } from './policy-hwpx.service';
import { PoliciesController } from './policies.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [PoliciesService, PolicyPdfService, PolicyHwpxService],
  controllers: [PoliciesController],
  exports: [PoliciesService],
})
export class PoliciesModule {}