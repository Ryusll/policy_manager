import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { json } from 'express';
import { PoliciesService } from './policies.service';
import { PolicyPdfService } from './policy-pdf.service';
import { PolicyHwpxService } from './policy-hwpx.service';
import { PolicyImportService } from './policy-import.service';
import { PoliciesController } from './policies.controller';
import { AuditModule } from '../audit/audit.module';
import { VariablesModule } from '../variables/variables.module';
import { POLICY_IMPORT_BODY_LIMIT, POLICY_IMPORT_MEDIA_TYPE } from './policy-import.dto';

@Module({
  imports: [AuditModule, VariablesModule],
  providers: [PoliciesService, PolicyPdfService, PolicyHwpxService, PolicyImportService],
  controllers: [PoliciesController],
  exports: [PoliciesService],
})
export class PoliciesModule implements NestModule {
  /**
   * 텍스트 가져오기(T-135)는 문서 전체를 한 요청으로 보낸다 — 전역 JSON 한도(100kb)로는 긴 규정이 413 이 된다. 전역 파서는
   * `application/json` 만 읽으므로, 이 경로의 전용 형식만 여기서 더 크게 읽는다(다른 경로의 한도는 그대로)
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(json({ type: POLICY_IMPORT_MEDIA_TYPE, limit: POLICY_IMPORT_BODY_LIMIT }))
      .forRoutes({ path: 'policies/import', method: RequestMethod.POST });
  }
}
