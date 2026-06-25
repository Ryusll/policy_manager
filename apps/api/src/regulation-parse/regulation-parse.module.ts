import { Module } from '@nestjs/common';
import { RegulationParseController } from './regulation-parse.controller';
import { RegulationParseService } from './regulation-parse.service';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [PoliciesModule],
  controllers: [RegulationParseController],
  providers: [RegulationParseService],
})
export class RegulationParseModule {}
