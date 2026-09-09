import { Module } from '@nestjs/common';
import { RegulationParseController } from './regulation-parse.controller';
import { RegulationParseService } from './regulation-parse.service';
import { PoliciesModule } from '../policies/policies.module';
import { LawGoKrModule } from '../lawgokr/lawgokr.module';

@Module({
  imports: [PoliciesModule, LawGoKrModule],
  controllers: [RegulationParseController],
  providers: [RegulationParseService],
})
export class RegulationParseModule {}
