import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

/** T-130 규정 근거 AI 질의응답(D-09 결정 2026-10-09) */
@Module({
  imports: [AuditModule],
  controllers: [AskController],
  providers: [AskService],
})
export class AskModule {}
