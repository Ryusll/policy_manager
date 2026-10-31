import { Module } from '@nestjs/common';
import { LawLinksController } from './law-links.controller';
import { LawLinksService } from './law-links.service';

/** S7 법령 개정 연계 — 법령 관계 정보 (T-101) */
@Module({
  controllers: [LawLinksController],
  providers: [LawLinksService],
  exports: [LawLinksService],
})
export class LawLinksModule {}
