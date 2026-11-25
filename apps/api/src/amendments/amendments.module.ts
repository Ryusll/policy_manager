import { Module } from '@nestjs/common';
import { LawChangesModule } from '../law-changes/law-changes.module';
import { VariablesModule } from '../variables/variables.module';
import { AmendmentsController } from './amendments.controller';
import { AmendmentsService } from './amendments.service';
import { AmendmentCorrectionService } from './amendment-correction';
import { AmendmentDocumentService } from './amendment-document.service';
import { AuditModule } from '../audit/audit.module';
import { PolicyPdfService } from '../policies/policy-pdf.service';
import { AmendmentCatchupService } from './amendment-catchup.service';

/**
 * S7 법령 개정 연계 — 개정 후보 (T-106).
 * 영향 판정은 `LawChangesService` 의 것을 그대로 쓴다(화면의 영향과 후보가 갈라지지 않게).
 * `AmendmentsService` 를 export 하는 것은 법령 동기화(LawsModule)가 끝날 때 자동 생성을 부르기 위해서다.
 * `AmendmentCatchupService` 는 법령 관계(LawLinksModule)가 연결을 확정한 뒤 부른다(T-149) — 이 모듈은 LawLinksModule 을 가져오지 않는다(순환 없음).
 */
@Module({
  imports: [LawChangesModule, VariablesModule, AuditModule],
  controllers: [AmendmentsController],
  // 개정안 문서(T-162)는 규정 PDF 와 같은 렌더러를 쓴다 — 상태 없는 서비스라 여기서 따로 만든다(PoliciesModule 을 끌어오지 않게)
  providers: [AmendmentsService, AmendmentCorrectionService, AmendmentDocumentService, PolicyPdfService, AmendmentCatchupService],
  exports: [AmendmentsService, AmendmentCatchupService],
})
export class AmendmentsModule {}
