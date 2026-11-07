import { Module } from '@nestjs/common';
import { AmendmentsModule } from '../amendments/amendments.module';
import { LawLinksController } from './law-links.controller';
import { LawLinksService } from './law-links.service';

/** S7 법령 개정 연계 — 법령 관계 정보 (T-101). 연결을 확정하면 개정 후보를 만든다(T-149 — AmendmentCatchupService) */
@Module({
  imports: [AmendmentsModule],
  controllers: [LawLinksController],
  providers: [LawLinksService],
  exports: [LawLinksService],
})
export class LawLinksModule {}
