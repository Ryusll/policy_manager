import { Module } from '@nestjs/common';
import { LawChangesModule } from '../law-changes/law-changes.module';
import { AmendmentsController } from './amendments.controller';
import { AmendmentsService } from './amendments.service';

/**
 * S7 법령 개정 연계 — 개정 후보 (T-106).
 * 영향 판정은 `LawChangesService` 의 것을 그대로 쓴다(화면의 영향과 후보가 갈라지지 않게).
 * `AmendmentsService` 를 export 하는 것은 법령 동기화(LawsModule)가 끝날 때 자동 생성을 부르기 위해서다.
 */
@Module({
  imports: [LawChangesModule],
  controllers: [AmendmentsController],
  providers: [AmendmentsService],
  exports: [AmendmentsService],
})
export class AmendmentsModule {}
