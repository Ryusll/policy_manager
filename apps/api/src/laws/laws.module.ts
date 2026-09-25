import { Module } from '@nestjs/common';
import { LawsController } from './laws.controller';
import { LawsService } from './laws.service';
import { LawGoKrModule } from '../lawgokr/lawgokr.module';

/**
 * S7 법령 개정 연계 — 법령 엔티티 (T-100).
 *
 * `LawsService`를 export 해두는 것은 T-103(변경 감지)·T-104(주기 동기화)가
 * 같은 등록 경로를 재사용해 재수신하기 위해서다.
 */
@Module({
  imports: [LawGoKrModule],
  controllers: [LawsController],
  providers: [LawsService],
  exports: [LawsService],
})
export class LawsModule {}
