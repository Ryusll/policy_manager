import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** 대시보드 집계(T-213) — 읽기만 한다. 법령 연결 도달·후보 조건은 함수로 가져다 쓴다(모듈 의존 없음, PrismaModule 은 전역) */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
