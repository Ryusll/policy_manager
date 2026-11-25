import { Module } from '@nestjs/common';
import { LawGoKrController } from './lawgokr.controller';
import { LawGoKrService } from './lawgokr.service';
import { LawGoKrCache } from './lawgokr.cache';

/**
 * T-53 법제처 국가법령정보 공동활용 OPEN API 프록시.
 *
 * `LawGoKrService`를 export 해두는 것은 T-55(가져오기 마법사의 "법제처에서 가져오기" 탭)에서
 * `RegulationParseModule`이 이 서비스를 주입받아 파싱 세션을 만들게 하기 위해서다.
 */
@Module({
  controllers: [LawGoKrController],
  providers: [LawGoKrService, LawGoKrCache],
  exports: [LawGoKrService],
})
export class LawGoKrModule {}
