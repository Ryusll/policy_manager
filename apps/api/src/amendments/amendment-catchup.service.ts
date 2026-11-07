import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { todayDateOnly } from '../common/date-only';
import { ourLinks } from '../law-links/our-links';
import { linkReachesEvent, linkReachWhere, reachOfEvents } from '../law-changes/law-link-reach';
import { closestPerArticle } from '../laws/law-node-key';
import { AmendmentsService } from './amendments.service';
import { articlesWithCandidates } from './amendment-reach';
import { notifyBundle, notifyFailure } from './amendment-notify';
import {
  catchupReason,
  inCatchupWindow,
  inConfirmWindow,
  windowStart,
  type CandidateOrigin,
  type CatchupReason,
} from './amendment-catchup-rules';

/**
 * (회사 하나의) 변경마다 만들 조문. linkIds — 확정 시점 경로에서 그 변경에 닿는, 이번에 확정한 연결(후보가 생기게 한 계기 — 감사에 남긴다).
 * 후보의 근거 연결은 영향 판정이 고른 가장 가까운 연결이라 더 가까운 기존 연결이 있으면 이것과 다르다
 */
export type CatchupWork = { eventId: string; articleIds: string[]; linkIds?: string[] };
/** 일괄 처리 대상 — 조문마다 왜 놓쳤는지(㉠·㉡) */
export type CatchupTarget = CatchupWork & { tenantId: string; reasons: Record<string, CatchupReason> };
/** failed — 만들지 못한 변경 id. notifyFailed — 후보는 만들었는데 묶음 알림을 쓰지 못했다 */
export type GenerateSummary = { events: number; articles: number; created: number; failed: string[]; notifyFailed: boolean };
type GenerateOptions = { origin: CandidateOrigin; plan?: boolean; confirmedBy?: string };

const errorText = (err: unknown) => (err as Error)?.message ?? String(err);

/** 감사 details 에 남길 확정 정보 — 누가 어느 연결을 확정해 후보가 생겼나(계기. 연결이 나중에 지워지거나 다시 확정돼도 남게) */
function traceOf(confirmedBy: string | undefined, linkIds: string[] | undefined) {
  if (!confirmedBy && !linkIds?.length) return undefined;
  return { ...(confirmedBy ? { confirmedBy } : {}), ...(linkIds?.length ? { confirmedLinkIds: linkIds } : {}) };
}

/**
 * 나중에 확정한 연결로 개정 후보 만들기 (T-149).
 *
 * - 확정 시점 — 연결이 확정되면(만들기·확정으로 바꾸기) 법령 관계 서비스가 `afterLinksConfirmed` 를 부른다. 연결 id 목록을 받으므로
 *   여러 건 확정(T-166, 아직 없음)을 만들 때도 이 함수를 한 번 부르면 같은 규칙에 알림 1건이다.
 * - 배포 때 한 번 — 그 전에 놓친 것(㉠·㉡)을 `catchupTargets` 로 찾고 `generate` 로 만든다(명령 `amendment-catchup.cli.ts`).
 *
 * 둘 다 `generateForEvent` 를 조문 목록으로 걸러 부른다 — 영향 판정·기준 본문·중복 막기·감사 기록은 자동 생성과 같다.
 * 알림만 다르다: 변경마다 보내지 않고 회사에 하나로 묶어 개정 후보 목록(/amendments)으로 보낸다.
 */
@Injectable()
export class AmendmentCatchupService {
  private readonly log = new Logger(AmendmentCatchupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly amendments: AmendmentsService,
  ) {}

  /**
   * 법령 관계 서비스가 연결을 확정한 뒤 부른다 — 확정은 이미 저장됐으므로 후보를 못 만들어도 확정을 되돌리지 않는다(요청은 성공).
   * 실패는 서버 로그와 함께 받는 사람에게 알림으로 남긴다 — 법령 화면의 '개정 후보 만들기'로 다시 만든다(처리 전 변경은 다음 동기화도 만든다)
   */
  async afterLinksConfirmed(tenantId: string, linkIds: string[], confirmedBy: string): Promise<void> {
    const where = `tenant ${tenantId}, links ${linkIds.join(',')}`;
    let failure: { failed: number; lawIds: string[] };
    try {
      const r = await this.forConfirmedLinks(tenantId, linkIds, { confirmedBy });
      if (r.notifyFailed) this.log.error(`연결 확정 뒤 개정 후보 알림을 쓰지 못했다(후보 ${r.created}건은 만들었다) — ${where}`);
      if (!r.failed.length) return;
      this.log.error(`연결 확정 뒤 개정 후보 일부 실패 — ${where}, events ${r.failed.join(',')}`);
      failure = { failed: r.failed.length, lawIds: r.failedLawIds };
    } catch (err) {
      this.log.error(`연결 확정 뒤 개정 후보 생성 실패 — ${where}: ${errorText(err)}`);
      failure = { failed: 0, lawIds: [] };
    }
    try {
      await notifyFailure(this.prisma, tenantId, failure);
    } catch (err) {
      this.log.error(`개정 후보 실패 알림도 쓰지 못했다 — ${where}: ${errorText(err)}`);
    }
  }

  /**
   * 연결이 확정된 뒤 — 그 연결의 조항과 아래 조항의 변경 가운데 창 안의 것(inConfirmWindow)으로 그 연결의 조문 후보만 만든다.
   * 연결 저장(트랜잭션)이 끝난 뒤에 부른다 — 후보 생성은 변경마다 자기 트랜잭션을 연다. 회사 경계는 ourLinks 로 건다
   */
  async forConfirmedLinks(
    tenantId: string,
    linkIds: string[],
    opts: { confirmedBy?: string; today?: Date } = {},
  ): Promise<GenerateSummary & { failedLawIds: string[] }> {
    const today = opts.today ?? todayDateOnly();
    const links = linkIds.length
      ? await this.prisma.lawLink.findMany({
          where: ourLinks(tenantId, { id: { in: linkIds }, confirmState: 'confirmed' }),
          select: { id: true, articleId: true, lawArticle: { select: { lawId: true, nodeKey: true } } },
        })
      : [];
    if (!links.length) return { events: 0, articles: 0, created: 0, failed: [], notifyFailed: false, failedLawIds: [] };
    const events = await this.prisma.lawChangeEvent.findMany({
      where: {
        lawArticleId: { not: null },
        lawEffectiveDate: { gte: windowStart(today) },
        OR: links.map((l) => linkReachWhere(l.lawArticle.lawId, l.lawArticle.nodeKey)),
      },
      select: { id: true, lawId: true, nodeKey: true, lawEffectiveDate: true },
      orderBy: { detectedAt: 'asc' },
    });
    const work = events
      .filter((e) => inConfirmWindow(e, today))
      .map((e) => {
        const reaching = links.filter((l) => linkReachesEvent(l.lawArticle, e));
        return { eventId: e.id, articleIds: [...new Set(reaching.map((l) => l.articleId))], linkIds: reaching.map((l) => l.id) };
      });
    const r = await this.generate(tenantId, work, { origin: 'link_confirm', confirmedBy: opts.confirmedBy });
    // 실패한 변경의 법령들 — 실패 알림이 하나면 그 법령 화면, 여럿(여러 건 확정)이면 법령 목록으로 보내고 이름을 적는다
    const lawOf = new Map(events.map((e) => [e.id, e.lawId]));
    return { ...r, failedLawIds: [...new Set(r.failed.flatMap((id) => lawOf.get(id) ?? []))] };
  }

  /**
   * 회사 하나의 (변경, 조문) 묶음을 만든다 — 이미 후보가 있는 조문은 건너뛰고(onlyNew), 알림 없이 만든 뒤 회사에 하나로 알린다.
   * plan 이면 쓰지 않고 만들 조문만 센다(일괄 처리 --plan — 실행과 같은 길이라 수가 어긋나지 않는다).
   * 변경 하나가 실패해도 나머지는 만들고, 알림을 못 써도 멈추지 않는다 — 실패한 변경 id 와 알림 실패를 돌려준다(부른 쪽이 알린다)
   */
  async generate(tenantId: string, work: CatchupWork[], opts: GenerateOptions): Promise<GenerateSummary> {
    let events = 0;
    let created = 0;
    const articles = new Set<string>();
    const failed: string[] = [];
    for (const w of work) {
      if (!w.articleIds.length) continue;
      try {
        const r = await this.amendments.generateForEvent(tenantId, w.eventId, {
          userId: null,
          onlyNew: true,
          articleIds: w.articleIds,
          origin: opts.origin,
          plan: opts.plan ?? false,
          trace: traceOf(opts.confirmedBy, w.linkIds),
        });
        const made = opts.plan ? (r.planned ?? []) : r.created.map((c) => c.articleId);
        if (!made.length) continue;
        events++;
        created += made.length;
        for (const a of made) articles.add(a);
      } catch (err) {
        failed.push(w.eventId);
        this.log.warn(`개정 후보 생성 실패(${opts.origin}) — event ${w.eventId}, tenant ${tenantId}: ${errorText(err)}`);
      }
    }
    let notifyFailed = false;
    if (!opts.plan && created) {
      try {
        await notifyBundle(this.prisma, tenantId, { events, articles: articles.size, created, origin: opts.origin });
      } catch (err) {
        notifyFailed = true;
        this.log.error(`개정 후보 알림 실패(${opts.origin}) — 후보 ${created}건은 만들었다 · tenant ${tenantId}: ${errorText(err)}`);
      }
    }
    return { events, articles: articles.size, created, failed, notifyFailed };
  }

  /**
   * 배포 때 한 번 — 처리할 때 놓친 후보의 대상(대장 T-149). 이미 처리된 창 안의 변경(inCatchupWindow)마다, 회사의 조문에 닿는 가장
   * 가까운 연결이 ㉠·㉡(catchupReason)이고 이 변경의 후보가 아직 없는(상태 무관) 조문. 회사 경계를 넘는 시스템 조회다 — 연결은
   * 회사마다 ourLinks 로 다시 걸고(T-41), 결과에는 id 와 까닭만 담는다
   */
  async catchupTargets(runDay: Date, onlyTenant?: string): Promise<CatchupTarget[]> {
    const rows = await this.prisma.lawChangeEvent.findMany({
      where: { amendmentsProcessedAt: { not: null }, lawArticleId: { not: null }, lawEffectiveDate: { gte: windowStart(runDay) } },
      select: { id: true, lawId: true, lawArticleId: true, nodeKey: true, lawEffectiveDate: true, detectedAt: true, amendmentsProcessedAt: true },
      orderBy: { detectedAt: 'asc' },
    });
    const events = rows.flatMap((e) => (e.amendmentsProcessedAt && inCatchupWindow(e, runDay) ? [{ ...e, processedAt: e.amendmentsProcessedAt }] : []));
    if (!events.length) return [];
    const reach = await reachOfEvents(this.prisma, events);
    const lawArticleIds = [...new Set([...reach.values()].flat())];
    const tenants = onlyTenant
      ? [onlyTenant]
      : (
          await this.prisma.lawLink.findMany({
            where: { lawArticleId: { in: lawArticleIds }, confirmState: 'confirmed' },
            select: { tenantId: true },
            distinct: ['tenantId'],
            orderBy: { tenantId: 'asc' },
          })
        ).map((t) => t.tenantId);
    const targets: CatchupTarget[] = [];
    for (const tenantId of tenants) {
      // 자동 생성의 영향 판정(impactedArticles)과 같은 연결·같은 순서 — 조문마다 고르는 가장 가까운 연결이 같다
      const links = await this.prisma.lawLink.findMany({
        where: ourLinks(tenantId, { lawArticleId: { in: lawArticleIds }, confirmState: 'confirmed' }),
        select: { articleId: true, lawArticleId: true, confirmedAt: true, createdAt: true, lawArticle: { select: { nodeKey: true } } },
        orderBy: { createdAt: 'asc' },
      });
      for (const e of events) {
        const reached = new Set(reach.get(e.id));
        const closest = closestPerArticle(links.filter((l) => reached.has(l.lawArticleId)).map((l) => ({ ...l, nodeKey: l.lawArticle.nodeKey })));
        const reasons: Record<string, CatchupReason> = {};
        for (const l of closest) {
          const why = catchupReason({ viaParent: l.lawArticleId !== e.lawArticleId, confirmedAt: l.confirmedAt, createdAt: l.createdAt }, e.processedAt);
          if (why) reasons[l.articleId] = why;
        }
        for (const had of await articlesWithCandidates(this.prisma, tenantId, e.id, Object.keys(reasons))) delete reasons[had];
        const articleIds = Object.keys(reasons);
        if (articleIds.length) targets.push({ tenantId, eventId: e.id, articleIds, reasons });
      }
    }
    return targets;
  }

  /** 잘못된 행 — 연결의 회사 ≠ 조문의 회사. 어느 회사 화면에도 안 보이고 API 로 지울 수도 없지만(404) 추적 해제를 막는다 */
  async invalidLinkIds(onlyTenant?: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT ll.id FROM law_links ll
        JOIN articles a ON a.id = ll.article_id JOIN chapters c ON c.id = a.chapter_id JOIN policies p ON p.id = c.policy_id
       WHERE p.tenant_id <> ll.tenant_id ${onlyTenant ? Prisma.sql`AND ll.tenant_id = ${onlyTenant}` : Prisma.empty}
       ORDER BY ll.id`;
    return rows.map((r) => r.id);
  }

  /** 확정 시각이 빈 확정 연결(잘못된 행 제외) — DB 에 직접 넣은 행뿐이다. 일괄 처리는 생성 시각을 확정 시각으로 본다 */
  async confirmedWithoutTime(onlyTenant?: string): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM law_links ll
        JOIN articles a ON a.id = ll.article_id JOIN chapters c ON c.id = a.chapter_id JOIN policies p ON p.id = c.policy_id
       WHERE p.tenant_id = ll.tenant_id AND ll.confirm_state = 'confirmed' AND ll.confirmed_at IS NULL
         ${onlyTenant ? Prisma.sql`AND ll.tenant_id = ${onlyTenant}` : Prisma.empty}`;
    return n;
  }
}
