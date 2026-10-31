import { Module } from '@nestjs/common';
import { LawChangesController } from './law-changes.controller';
import { LawChangesService } from './law-changes.service';

/**
 * S7 법령 개정 연계 — 변경 이벤트·영향 분석 (T-105).
 * `LawChangesService` 를 export 하는 것은 개정 후보 생성(T-106)이 영향 분석 결과를 입력으로 쓰기 위해서다.
 */
@Module({
  controllers: [LawChangesController],
  providers: [LawChangesService],
  exports: [LawChangesService],
})
export class LawChangesModule {}
