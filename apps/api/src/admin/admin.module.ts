import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditModule } from '../audit/audit.module';
import { VariablesModule } from '../variables/variables.module';

@Module({
  imports: [AuditModule, VariablesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
