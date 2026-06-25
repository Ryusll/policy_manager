import { Module } from '@nestjs/common';
import { VariablesService } from './variables.service';
import { VariablesController } from './variables.controller';

@Module({
  providers: [VariablesService],
  controllers: [VariablesController],
  exports: [VariablesService],
})
export class VariablesModule {}