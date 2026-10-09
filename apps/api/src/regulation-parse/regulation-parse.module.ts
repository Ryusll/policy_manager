import { Module } from '@nestjs/common';
import { RegulationParseController } from './regulation-parse.controller';
import { RegulationParseService } from './regulation-parse.service';
import { ReparseController } from './reparse.controller';
import { ReparseService } from './reparse.service';
import { PoliciesModule } from '../policies/policies.module';
import { LawGoKrModule } from '../lawgokr/lawgokr.module';
import { AuditModule } from '../audit/audit.module';
import { VariablesModule } from '../variables/variables.module';

@Module({
  imports: [PoliciesModule, LawGoKrModule, AuditModule, VariablesModule],
  controllers: [RegulationParseController, ReparseController],
  providers: [RegulationParseService, ReparseService],
})
export class RegulationParseModule {}
