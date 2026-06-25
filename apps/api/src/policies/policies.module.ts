import { Module } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PoliciesController } from './policies.controller';
import { AuditModule } from '../audit/audit.module';
import { VariablesModule } from '../variables/variables.module';

@Module({
  imports: [AuditModule, VariablesModule],
  providers: [PoliciesService],
  controllers: [PoliciesController],
  exports: [PoliciesService],
})
export class PoliciesModule {}