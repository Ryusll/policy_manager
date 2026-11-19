import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';
import { AskConsentService } from './ask-consent.service';
import { AskHistoryController } from './ask-history.controller';
import { AskHistoryService } from './ask-history.service';

/** T-130 규정 근거 AI 질의응답(D-09 결정 2026-10-09). 내 지난 질문은 T-218 */
@Module({
  imports: [AuditModule],
  controllers: [AskController, AskHistoryController],
  providers: [AskService, AskConsentService, AskHistoryService],
})
export class AskModule {}
