import { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { splitLawInForce, type LawChangeKind, type LawInForce } from './law-in-force';

/**
 * 법령 하나의 현행 본문과 시행 예정 개정(T-150 ②). 법령은 테넌트 공용이라 tenantId 가 없다(ADR-0020) —
 * 우리 조문에 걸린 영향은 연결(`LawLink.tenantId`)을 거치는 화면이 따로 본다.
 * 조항·이벤트·판 기록을 REPEATABLE READ 한 트랜잭션에서 읽는다 — 세 읽기가 같은 스냅숏이라, 그 사이 동기화가 판을 반영해도
 * 섞이지 않는다(READ COMMITTED 면 문장마다 스냅숏이 달라 방금 들어온 판이 '바뀌는 조항 0개'로 잠깐 보일 수 있다, T-150 검토).
 */
export async function readLawInForce(prisma: PrismaService, lawId: string, now: Date = new Date()): Promise<LawInForce> {
  const today = todayDateOnly(now);
  const [articles, events, versions] = await prisma.$transaction([
    prisma.lawArticle.findMany({
      where: { lawId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        nodeKey: true,
        articleNo: true,
        clauseNo: true,
        itemNo: true,
        label: true,
        title: true,
        content: true,
        sortOrder: true,
        effectiveNotes: true,
        deletedAt: true,
      },
    }),
    prisma.lawChangeEvent.findMany({
      where: { lawId, lawEffectiveDate: { gt: today } },
      select: {
        id: true,
        nodeKey: true,
        changeType: true,
        beforeContent: true,
        afterContent: true,
        lawEffectiveDate: true,
        lawVersionId: true,
        detectedAt: true,
      },
    }),
    prisma.lawVersion.findMany({
      where: { lawId },
      select: {
        id: true,
        mst: true,
        orderKey: true,
        lawType: true,
        promulgatedDate: true,
        promulgationNo: true,
        revisionType: true,
        effectiveDate: true,
        stageEffectiveDates: true,
      },
    }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return splitLawInForce({
    today: toDateOnlyString(today),
    articles,
    events: events.map((e) => ({ ...e, changeType: e.changeType as LawChangeKind })),
    versions,
  });
}
