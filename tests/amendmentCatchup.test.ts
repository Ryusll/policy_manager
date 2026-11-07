import { describe, it, expect, vi } from 'vitest';
import { todayDateOnly, parseDateOnly } from '../apps/api/src/common/date-only';
import {
  CATCHUP_MAX_PER_TENANT,
  CATCHUP_MAX_TOTAL,
  CATCHUP_WINDOW_DAYS,
  T148_DEPLOYED_AT,
  bundleNotice,
  catchupReason,
  deleteInvalidLinksSql,
  failureNotice,
  inCatchupWindow,
  inConfirmWindow,
  isPreFeature,
  overCap,
  windowStart,
} from '../apps/api/src/amendments/amendment-catchup-rules';
import { linkReachWhere, linkReachesEvent } from '../apps/api/src/law-changes/law-link-reach';
import { ourLinks } from '../apps/api/src/law-links/our-links';
import { AmendmentCatchupService } from '../apps/api/src/amendments/amendment-catchup.service';
import { LawLinksService } from '../apps/api/src/law-links/law-links.service';
import type { AmendmentsService } from '../apps/api/src/amendments/amendments.service';
import type { PrismaService } from '../apps/api/src/common/prisma/prisma.service';

/**
 * 나중에 확정한 연결로 개정 후보 만들기 (T-149) — 규칙(창·㉠㉡·상한·SQL·알림 문구)과 두 경로가 그 규칙을 부르는 모양.
 * 실제 DB 를 거치는 확인은 통합 시험(law-link-confirm-candidates·amendment-catchup)이 한다.
 */
const d = (s: string) => parseDateOnly(s)!;
const at = (iso: string) => new Date(iso);
const TODAY = d('2026-11-06');
const ev = (lawEffectiveDate: string | null, o: { detectedAt?: string; processedAt?: string | null } = {}) => ({
  lawEffectiveDate: lawEffectiveDate ? d(lawEffectiveDate) : null,
  detectedAt: at(o.detectedAt ?? '2026-11-01T03:16:00.000Z'),
  amendmentsProcessedAt: o.processedAt === undefined ? at('2026-11-01T03:17:00.000Z') : o.processedAt === null ? null : at(o.processedAt),
});

describe('창 — 법령 시행일이 오늘 이후이거나 최근 30일 안 (T-149)', () => {
  it('오늘 − 30일은 들고, − 31일은 빠진다. 미래·오늘은 든다. 시행일이 없으면 빠진다', () => {
    expect(windowStart(TODAY).toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(inConfirmWindow(ev('2026-10-07'), TODAY)).toBe(true);
    expect(inConfirmWindow(ev('2026-10-06'), TODAY)).toBe(false);
    expect(inConfirmWindow(ev('2026-11-06'), TODAY)).toBe(true);
    expect(inConfirmWindow(ev('2027-06-10'), TODAY)).toBe(true);
    expect(inConfirmWindow(ev(null), TODAY)).toBe(false);
  });

  it('오늘은 한국 날짜다 — UTC 15:00 에 하루가 넘어가 창의 첫날도 함께 넘어간다', () => {
    const before = todayDateOnly(at('2026-11-05T14:59:59.000Z'));
    const after = todayDateOnly(at('2026-11-05T15:00:00.000Z'));
    expect(windowStart(before).toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(windowStart(after).toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(inConfirmWindow(ev('2026-10-06'), before)).toBe(true);
    expect(inConfirmWindow(ev('2026-10-06'), after)).toBe(false);
  });

  it('기능 도입 전 이벤트(처리 시각 = 감지 시각)는 일괄 처리만 뺀다 — 확정 시점은 창만 본다(대장 T-149). 아직 처리하지 않은 변경은 확정 시점만 든다', () => {
    const pre = ev('2026-12-01', { detectedAt: '2026-10-05T01:00:00.000Z', processedAt: '2026-10-05T01:00:00.000Z' });
    expect(isPreFeature(pre)).toBe(true);
    expect(inConfirmWindow(pre, TODAY)).toBe(true);
    expect(inCatchupWindow(pre, TODAY)).toBe(false);
    const pending = ev('2026-12-01', { processedAt: null });
    expect(isPreFeature(pending)).toBe(false);
    expect(inConfirmWindow(pending, TODAY)).toBe(true);
    expect(inCatchupWindow(pending, TODAY)).toBe(false);
    // 1ms 라도 다르면 기능 도입 뒤 이벤트다
    expect(isPreFeature(ev('2026-12-01', { detectedAt: '2026-11-01T03:16:00.000Z', processedAt: '2026-11-01T03:16:00.001Z' }))).toBe(false);
    expect(inCatchupWindow(ev('2026-10-06'), TODAY)).toBe(false);
    expect(inCatchupWindow(ev('2026-10-07'), TODAY)).toBe(true);
  });
});

describe('일괄 처리 대상 — ㉠ 위 조항 연결이면서 T-148 전 처리, ㉡ 처리 뒤 확정 (T-149)', () => {
  const T148 = T148_DEPLOYED_AT.toISOString();
  const link = (viaParent: boolean, confirmedAt: string | null, createdAt = '2026-10-01T00:00:00.000Z') => ({
    viaParent,
    confirmedAt: confirmedAt ? at(confirmedAt) : null,
    createdAt: at(createdAt),
  });

  it('T-148 반영 시각은 1차 운영 반영의 새 API 컨테이너 시작이다', () => {
    expect(T148).toBe('2026-10-31T11:12:12.000Z');
  });

  it('㉠ — 위 조항 연결, 확정 ≤ 처리 < T-148 이면 대상(확정 = 처리도 든다)', () => {
    expect(catchupReason(link(true, '2026-10-20T00:00:00.000Z'), at('2026-10-30T00:00:00.000Z'))).toBe('parent_before_t148');
    expect(catchupReason(link(true, '2026-10-30T00:00:00.000Z'), at('2026-10-30T00:00:00.000Z'))).toBe('parent_before_t148');
    expect(catchupReason(link(true, '2026-10-20T00:00:00.000Z'), at('2026-10-31T11:12:11.999Z'))).toBe('parent_before_t148');
  });

  it('㉠ 경계 — 처리 시각이 T-148 시각이거나 그 뒤면 빠진다(T-148 코드가 이미 위 조항 연결을 봤다)', () => {
    expect(catchupReason(link(true, '2026-10-20T00:00:00.000Z'), at(T148))).toBeNull();
    expect(catchupReason(link(true, '2026-10-20T00:00:00.000Z'), at('2026-11-01T03:17:00.000Z'))).toBeNull();
  });

  it('직접 연결이 처리 때 이미 있었으면 빠진다 — 처리 때 까닭이 있어 건너뛴 것(T-148 전이어도)', () => {
    expect(catchupReason(link(false, '2026-10-20T00:00:00.000Z'), at('2026-10-30T00:00:00.000Z'))).toBeNull();
    expect(catchupReason(link(false, '2026-10-30T00:00:00.000Z'), at('2026-10-30T00:00:00.000Z'))).toBeNull();
  });

  it('㉡ — 처리 뒤에 확정했으면 직접·위 조항 모두 대상(T-148 앞뒤 무관)', () => {
    expect(catchupReason(link(false, '2026-11-02T00:00:00.000Z'), at('2026-11-01T03:17:00.000Z'))).toBe('confirmed_after_processing');
    expect(catchupReason(link(true, '2026-11-02T00:00:00.000Z'), at('2026-11-01T03:17:00.000Z'))).toBe('confirmed_after_processing');
    expect(catchupReason(link(true, '2026-10-30T00:00:00.001Z'), at('2026-10-30T00:00:00.000Z'))).toBe('confirmed_after_processing');
  });

  it('확정 시각이 비면 생성 시각으로 본다', () => {
    expect(catchupReason(link(false, null, '2026-11-02T00:00:00.000Z'), at('2026-11-01T03:17:00.000Z'))).toBe('confirmed_after_processing');
    expect(catchupReason(link(false, null, '2026-10-01T00:00:00.000Z'), at('2026-11-01T03:17:00.000Z'))).toBeNull();
    expect(catchupReason(link(true, null, '2026-10-01T00:00:00.000Z'), at('2026-10-30T00:00:00.000Z'))).toBe('parent_before_t148');
  });
});

describe('상한·지울 SQL·알림 문구 (T-149)', () => {
  const caps = { total: 100, perTenant: 20 };
  it('기본값 — 창 30일, 상한 합계 100·한 회사 20(대장 T-149)', () => {
    expect([CATCHUP_WINDOW_DAYS, CATCHUP_MAX_TOTAL, CATCHUP_MAX_PER_TENANT]).toEqual([30, 100, 20]);
  });

  it('합계 100·한 회사 20 은 통과하고 101·21 은 멈춘다', () => {
    expect(overCap(new Map([['a', 20], ['b', 20], ['c', 20], ['d', 20], ['e', 20]]), caps)).toEqual({ total: 100, overTotal: false, overTenants: [], over: false });
    expect(overCap(new Map([['a', 20], ['b', 20], ['c', 20], ['d', 20], ['e', 20], ['f', 1]]), caps)).toMatchObject({ total: 101, overTotal: true, over: true });
    expect(overCap(new Map([['a', 21]]), caps)).toMatchObject({ overTotal: false, overTenants: ['a'], over: true });
    expect(overCap(new Map(), caps)).toMatchObject({ total: 0, over: false });
  });

  it('잘못된 행이 없으면 SQL 도 없고, 있으면 그 id 만 — 돌리는 순간에도 여전히 잘못된 행만 지운다', () => {
    expect(deleteInvalidLinksSql([])).toBeNull();
    const a = '0b7c2a4e-1f3d-4c5b-9a8e-2d6f1c3b4a5e';
    const b = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
    const q = deleteInvalidLinksSql([a, b])!;
    expect(q).toContain(`WHERE ll.id IN ('${a}', '${b}')`);
    expect(q).toContain('p.tenant_id <> ll.tenant_id');
    expect(q.startsWith('DELETE FROM law_links ll USING articles a, chapters c, policies p')).toBe(true);
  });

  it('id 가 uuid 꼴이 아니면 SQL 을 만들지 않는다(거부)', () => {
    expect(() => deleteInvalidLinksSql(["x'); DELETE FROM law_links; --"])).toThrow(/연결 id 형식/);
    expect(() => deleteInvalidLinksSql(['0b7c2a4e-1f3d-4c5b-9a8e-2d6f1c3b4a5e', 'not-a-uuid'])).toThrow(/not-a-uuid/);
  });

  it("알림은 개정 후보 목록으로 — 후보·조문·변경 수와 만든 까닭. '반영'은 승인 뒤의 일로만 쓴다", () => {
    const n = bundleNotice({ events: 2, articles: 1, created: 2, origin: 'link_confirm' });
    expect(n).toMatchObject({ title: '[법령 개정] 개정 후보 2건', link: '/amendments' });
    expect(n.body).toBe(
      '법령 관계를 확정한 조문 1곳에 개정 후보 2건을 만들었습니다(최근 30일 안에 시행됐거나 앞으로 시행될 법령 개정 2건).\n검토하고 승인해야 우리 규정에 반영됩니다.',
    );
    const c = bundleNotice({ events: 1, articles: 3, created: 3, origin: 'catchup' });
    expect(c.body).toContain('그동안 만들지 못한 개정 후보 3건을 우리 조문 3곳에 만들었습니다');
    for (const body of [n.body, c.body]) expect(body.match(/반영/g), body).toHaveLength(1);
  });

  it('후보를 못 만들면 그 법령 화면으로 보내는 알림 — 법령이 여럿이거나 모르면 법령 목록, 본문에 법령 이름', () => {
    const one = failureNotice({ failed: 2, lawId: 'L1', lawNames: ['근로기준법'] });
    expect(one).toMatchObject({ title: '[법령 개정] 개정 후보를 만들지 못했습니다', link: '/laws/L1' });
    expect(one.body).toContain('법령 개정 2건으로는 개정 후보를 만들지 못했습니다(근로기준법).');
    const many = failureNotice({ failed: 4, lawId: null, lawNames: ['가법', '나법', '다법', '라법'] });
    expect(many).toMatchObject({ link: '/laws' });
    expect(many.body).toContain('(가법, 나법, 다법 외 1개)');
    expect(failureNotice({ failed: 0, lawId: null, lawNames: [] })).toMatchObject({ link: '/laws' });
    expect(failureNotice({ failed: 0, lawId: null, lawNames: [] }).body).toContain('법령 관계는 확정했지만 개정 후보를 만들지 못했습니다.');
  });
});

describe('연결이 닿는 변경 — 그 조항과 아래 조항 (T-149)', () => {
  it('조 연결은 그 조의 머리 행·항·호에 닿고, 다른 조(600·60의2)·다른 법령에는 닿지 않는다', () => {
    const jo60 = { lawId: 'L', nodeKey: '60//' };
    for (const k of ['60//', '60/1/', '60/1/3', '60//3']) expect(linkReachesEvent(jo60, { lawId: 'L', nodeKey: k }), k).toBe(true);
    for (const k of ['600//', '60의2//', '6//']) expect(linkReachesEvent(jo60, { lawId: 'L', nodeKey: k }), k).toBe(false);
    expect(linkReachesEvent(jo60, { lawId: 'M', nodeKey: '60/1/' })).toBe(false);
  });

  it('항 연결은 위(조 머리 행)나 옆 항으로 퍼지지 않고, 호 연결은 그 호만', () => {
    const p601 = { lawId: 'L', nodeKey: '60/1/' };
    expect(linkReachesEvent(p601, { lawId: 'L', nodeKey: '60/1/2' })).toBe(true);
    expect(linkReachesEvent(p601, { lawId: 'L', nodeKey: '60//' })).toBe(false);
    expect(linkReachesEvent(p601, { lawId: 'L', nodeKey: '60/10/' })).toBe(false);
    expect(linkReachesEvent({ lawId: 'L', nodeKey: '60/1/2' }, { lawId: 'L', nodeKey: '60/1/2' })).toBe(true);
    expect(linkReachesEvent({ lawId: 'L', nodeKey: '60/1/2' }, { lawId: 'L', nodeKey: '60/1/' })).toBe(false);
  });

  it('조회 조건도 같은 규칙이다 — 이벤트 목록의 "우리 조문에 걸린 변경만"과 같은 함수', () => {
    expect(linkReachWhere('L', '60//')).toEqual({ lawId: 'L', nodeKey: { startsWith: '60/' } });
    expect(linkReachWhere('L', '60/1/')).toEqual({ lawId: 'L', nodeKey: { startsWith: '60/1/' } });
    expect(linkReachWhere('L', '60/1/2')).toEqual({ lawId: 'L', nodeKey: '60/1/2' });
  });
});

describe('연결을 확정할 때만 후보를 만든다 — 법령 관계 수정 (T-149)', () => {
  const setup = (confirmState: 'suggested' | 'confirmed' | 'rejected') => {
    const existing = { id: 'link-1', tenantId: 't1', articleId: 'art-1', confirmState, evidenceText: null, evidenceVersionId: null, evidenceFromBody: false };
    const prisma = {
      lawLink: {
        findFirst: vi.fn(() => Promise.resolve(existing)),
        update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Promise.resolve({ ...existing, ...data, id: where.id })),
      },
    };
    const catchup = { afterLinksConfirmed: vi.fn(() => Promise.resolve()) };
    const svc = new LawLinksService(prisma as unknown as PrismaService, catchup as unknown as AmendmentCatchupService);
    return { svc, prisma, catchup };
  };

  it('추천·반려에서 확정으로 바꿀 때 그 연결로 부른다', async () => {
    for (const from of ['suggested', 'rejected'] as const) {
      const { svc, catchup, prisma } = setup(from);
      await svc.update('t1', 'link-1', 'u1', { confirmState: 'confirmed' });
      expect(catchup.afterLinksConfirmed, from).toHaveBeenCalledWith('t1', ['link-1'], 'u1'); // 확정한 사람을 감사에 남기려고 넘긴다
      // 확정 저장이 먼저다 — 후보는 저장된 확정을 읽는다
      expect(prisma.lawLink.update.mock.invocationCallOrder[0]).toBeLessThan(catchup.afterLinksConfirmed.mock.invocationCallOrder[0]);
    }
  });

  it('이미 확정인 연결의 수정·반려로 바꾸기에서는 부르지 않는다', async () => {
    const confirmed = setup('confirmed');
    await confirmed.svc.update('t1', 'link-1', 'u1', { confirmState: 'confirmed', relationType: 'citation' });
    expect(confirmed.catchup.afterLinksConfirmed).not.toHaveBeenCalled();
    const rejecting = setup('suggested');
    await rejecting.svc.update('t1', 'link-1', 'u1', { confirmState: 'rejected' });
    expect(rejecting.catchup.afterLinksConfirmed).not.toHaveBeenCalled();
  });
});

describe('회사 하나의 묶음을 만든다 — 알림 하나, 실패는 돌려준다 (T-149)', () => {
  const fakePrisma = (users: string[]) => ({
    user: { findMany: vi.fn(() => Promise.resolve(users.map((id) => ({ id })))) },
    userNotification: { createMany: vi.fn(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })) },
  });
  type Opts = { articleIds?: string[]; plan?: boolean; onlyNew?: boolean; origin?: string; notify?: boolean; userId: string | null };
  const fakeAmendments = (made: Record<string, string[]>, fail: string[] = []) => ({
    generateForEvent: vi.fn((_tenantId: string, eventId: string, opts: Opts) => {
      if (fail.includes(eventId)) return Promise.reject(new Error('boom'));
      const ids = made[eventId] ?? [];
      return Promise.resolve(opts.plan ? { created: [], planned: ids } : { created: ids.map((articleId) => ({ id: `c-${eventId}-${articleId}`, articleId })) });
    }),
  });

  it('변경 여럿을 조문 목록으로 걸러 만들고, 회사에 알림 하나(받는 사람마다 한 행)만 보낸다', async () => {
    const prisma = fakePrisma(['admin', 'editor']);
    const amendments = fakeAmendments({ e1: ['a1'], e2: ['a1', 'a2'] });
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, amendments as unknown as AmendmentsService);
    const work = [{ eventId: 'e1', articleIds: ['a1'], linkIds: ['l1'] }, { eventId: 'e2', articleIds: ['a1', 'a2'], linkIds: ['l1', 'l2'] }, { eventId: 'e3', articleIds: [] }];
    const r = await svc.generate('t1', work, { origin: 'link_confirm', confirmedBy: 'u1' });
    expect(r).toEqual({ events: 2, articles: 2, created: 3, failed: [], notifyFailed: false });
    expect(amendments.generateForEvent).toHaveBeenCalledTimes(2); // 조문이 없는 변경은 부르지 않는다
    // 감사 details 에 누가 어느 연결을 확정해 만들었는지 남긴다
    expect(amendments.generateForEvent).toHaveBeenCalledWith('t1', 'e2', {
      userId: null,
      onlyNew: true,
      articleIds: ['a1', 'a2'],
      origin: 'link_confirm',
      plan: false,
      trace: { confirmedBy: 'u1', confirmedLinkIds: ['l1', 'l2'] },
    });
    expect(prisma.userNotification.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.userNotification.createMany.mock.calls[0][0].data as Array<{ userId: string; link: string; kind: string; tenantId: string }>;
    expect(rows.map((x) => x.userId)).toEqual(['admin', 'editor']);
    expect(rows[0]).toMatchObject({ tenantId: 't1', kind: 'law_amendment', link: '/amendments' });
  });

  it('세기만 하면(plan) 알림이 없고 만들 조문을 센다. 만든 것이 없으면 알림도 없다', async () => {
    const prisma = fakePrisma(['admin']);
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, fakeAmendments({ e1: ['a1', 'a2'] }) as unknown as AmendmentsService);
    expect(await svc.generate('t1', [{ eventId: 'e1', articleIds: ['a1', 'a2'] }], { origin: 'catchup', plan: true })).toEqual({ events: 1, articles: 2, created: 2, failed: [], notifyFailed: false });
    expect(await svc.generate('t1', [{ eventId: 'e9', articleIds: ['a1'] }], { origin: 'catchup' })).toEqual({ events: 0, articles: 0, created: 0, failed: [], notifyFailed: false });
    expect(prisma.userNotification.createMany).not.toHaveBeenCalled();
  });

  it('변경 하나가 실패해도 나머지는 만들고 알리며, 실패한 변경을 돌려준다', async () => {
    const prisma = fakePrisma(['admin']);
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, fakeAmendments({ e2: ['a2'] }, ['e1']) as unknown as AmendmentsService);
    const r = await svc.generate('t1', [{ eventId: 'e1', articleIds: ['a1'] }, { eventId: 'e2', articleIds: ['a2'] }], { origin: 'catchup' });
    expect(r).toEqual({ events: 1, articles: 1, created: 1, failed: ['e1'], notifyFailed: false });
    expect(prisma.userNotification.createMany).toHaveBeenCalledTimes(1);
  });

  it('알림을 못 써도 멈추지 않고, 후보는 만들었다는 것과 알림 실패를 함께 돌려준다', async () => {
    const prisma = fakePrisma(['admin']);
    prisma.userNotification.createMany.mockImplementation(() => Promise.reject(new Error('notify down')));
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, fakeAmendments({ e1: ['a1'] }) as unknown as AmendmentsService);
    expect(await svc.generate('t1', [{ eventId: 'e1', articleIds: ['a1'] }], { origin: 'catchup' })).toEqual({
      events: 1,
      articles: 1,
      created: 1,
      failed: [],
      notifyFailed: true,
    });
  });
});

describe('확정 시점 경로가 고르는 변경과 조문 (T-149)', () => {
  it('우리 회사 확정 연결만 읽고(ourLinks), 창 안 변경마다 그 변경에 닿는 연결의 조문·연결만 넘긴다 — 기능 도입 전 변경도 창 안이면 든다', async () => {
    const links = [
      { id: 'l1', articleId: 'a-jo', lawArticle: { lawId: 'L', nodeKey: '60//' } },
      { id: 'l2', articleId: 'a-p2', lawArticle: { lawId: 'L', nodeKey: '60/2/' } },
    ];
    const events = [
      { id: 'e601', lawId: 'L', nodeKey: '60/1/', lawEffectiveDate: d('2026-12-01'), detectedAt: at('2026-11-01T00:00:00Z'), amendmentsProcessedAt: at('2026-11-01T00:00:01Z') },
      { id: 'e602', lawId: 'L', nodeKey: '60/2/', lawEffectiveDate: d('2026-10-07'), detectedAt: at('2026-11-01T00:00:00Z'), amendmentsProcessedAt: null },
      { id: 'ePre', lawId: 'L', nodeKey: '60/1/', lawEffectiveDate: d('2026-12-01'), detectedAt: at('2026-10-05T00:00:00Z'), amendmentsProcessedAt: at('2026-10-05T00:00:00Z') },
    ];
    const prisma = {
      lawLink: { findMany: vi.fn(() => Promise.resolve(links)) },
      lawChangeEvent: { findMany: vi.fn(() => Promise.resolve(events)) },
    };
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, {} as AmendmentsService);
    const generate = vi.spyOn(svc, 'generate').mockResolvedValue({ events: 0, articles: 0, created: 0, failed: [], notifyFailed: false });
    await svc.forConfirmedLinks('t1', ['l1', 'l2'], { today: TODAY, confirmedBy: 'u1' });

    expect(prisma.lawLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: ourLinks('t1', { id: { in: ['l1', 'l2'] }, confirmState: 'confirmed' }) }),
    );
    expect(prisma.lawChangeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lawArticleId: { not: null }, lawEffectiveDate: { gte: windowStart(TODAY) }, OR: [linkReachWhere('L', '60//'), linkReachWhere('L', '60/2/')] },
      }),
    );
    expect(generate).toHaveBeenCalledWith(
      't1',
      [
        { eventId: 'e601', articleIds: ['a-jo'], linkIds: ['l1'] },
        { eventId: 'e602', articleIds: ['a-jo', 'a-p2'], linkIds: ['l1', 'l2'] },
        { eventId: 'ePre', articleIds: ['a-jo'], linkIds: ['l1'] },
      ],
      { origin: 'link_confirm', confirmedBy: 'u1' },
    );
  });

  it('실패한 변경의 법령을 모아 돌려준다 — 실패 알림이 하나면 그 법령 화면, 여럿(여러 건 확정)이면 목록으로 보낸다', async () => {
    const links = [
      { id: 'l1', articleId: 'a1', lawArticle: { lawId: 'L', nodeKey: '60//' } },
      { id: 'l2', articleId: 'a2', lawArticle: { lawId: 'M', nodeKey: '3//' } },
    ];
    const events = [
      { id: 'eL', lawId: 'L', nodeKey: '60/1/', lawEffectiveDate: d('2026-12-01') },
      { id: 'eM', lawId: 'M', nodeKey: '3/1/', lawEffectiveDate: d('2026-12-01') },
    ];
    const prisma = { lawLink: { findMany: vi.fn(() => Promise.resolve(links)) }, lawChangeEvent: { findMany: vi.fn(() => Promise.resolve(events)) } };
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, {} as AmendmentsService);
    const gen = vi.spyOn(svc, 'generate');
    gen.mockResolvedValueOnce({ events: 0, articles: 0, created: 0, failed: ['eL'], notifyFailed: false });
    expect((await svc.forConfirmedLinks('t1', ['l1', 'l2'], { today: TODAY })).failedLawIds).toEqual(['L']);
    gen.mockResolvedValueOnce({ events: 0, articles: 0, created: 0, failed: ['eL', 'eM'], notifyFailed: false });
    expect((await svc.forConfirmedLinks('t1', ['l1', 'l2'], { today: TODAY })).failedLawIds).toEqual(['L', 'M']);
  });

  it('연결이 우리 회사 확정 연결이 아니면(다른 회사·잘못된 행·추천) 아무것도 읽지 않는다', async () => {
    const prisma = { lawLink: { findMany: vi.fn(() => Promise.resolve([])) }, lawChangeEvent: { findMany: vi.fn() } };
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, {} as AmendmentsService);
    expect(await svc.forConfirmedLinks('t1', ['x'], { today: TODAY })).toEqual({ events: 0, articles: 0, created: 0, failed: [], notifyFailed: false, failedLawIds: [] });
    expect(prisma.lawChangeEvent.findMany).not.toHaveBeenCalled();
  });
});

describe('확정 뒤 후보를 못 만들면 — 확정은 그대로, 실패는 받는 사람에게 알린다 (T-149)', () => {
  const setup = () => {
    const prisma = {
      user: { findMany: vi.fn(() => Promise.resolve([{ id: 'admin' }])) },
      userNotification: { createMany: vi.fn(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })) },
      law: { findMany: vi.fn(() => Promise.resolve([{ lawName: '확정시험법' }])) },
    };
    const svc = new AmendmentCatchupService(prisma as unknown as PrismaService, {} as AmendmentsService);
    const rows = () => prisma.userNotification.createMany.mock.calls.flatMap((c) => c[0].data as Array<{ title: string; link: string; body: string }>);
    return { svc, prisma, rows };
  };
  const ok = { events: 1, articles: 1, created: 1, failed: [], notifyFailed: false, failedLawIds: [] };

  it('다 만들었으면 실패 알림이 없고, 확정한 사람을 넘긴다', async () => {
    const { svc, rows } = setup();
    const spy = vi.spyOn(svc, 'forConfirmedLinks').mockResolvedValue(ok);
    await svc.afterLinksConfirmed('t1', ['l1'], 'u1');
    expect(spy).toHaveBeenCalledWith('t1', ['l1'], { confirmedBy: 'u1' });
    expect(rows()).toEqual([]);
  });

  it('일부 변경을 못 만들면 그 법령 화면으로 보내는 실패 알림을 남긴다', async () => {
    const { svc, rows } = setup();
    vi.spyOn(svc, 'forConfirmedLinks').mockResolvedValue({ ...ok, failed: ['e1', 'e2'], failedLawIds: ['L1'] });
    await svc.afterLinksConfirmed('t1', ['l1'], 'u1');
    expect(rows()).toEqual([expect.objectContaining({ title: '[법령 개정] 개정 후보를 만들지 못했습니다', link: '/laws/L1' })]);
    expect(rows()[0].body).toContain('법령 개정 2건으로는 개정 후보를 만들지 못했습니다(확정시험법).');
  });

  it('여러 법령의 변경을 못 만들면(여러 건 확정) 법령 목록으로 보내고 본문에 법령 이름을 적는다', async () => {
    const { svc, prisma, rows } = setup();
    prisma.law.findMany.mockImplementation(() => Promise.resolve([{ lawName: '가시험법' }, { lawName: '나시험법' }]));
    vi.spyOn(svc, 'forConfirmedLinks').mockResolvedValue({ ...ok, failed: ['e1', 'e2'], failedLawIds: ['L1', 'L2'] });
    await svc.afterLinksConfirmed('t1', ['l1', 'l2'], 'u1');
    expect(rows()).toEqual([expect.objectContaining({ link: '/laws' })]);
    expect(rows()[0].body).toContain('(가시험법, 나시험법)');
  });

  it('통째로 실패해도 요청을 깨지 않고 실패 알림을 남기며, 실패 알림마저 못 써도 던지지 않는다', async () => {
    const { svc, prisma, rows } = setup();
    vi.spyOn(svc, 'forConfirmedLinks').mockRejectedValue(new Error('db down'));
    await expect(svc.afterLinksConfirmed('t1', ['l1'], 'u1')).resolves.toBeUndefined();
    expect(rows()).toEqual([expect.objectContaining({ link: '/laws' })]);
    prisma.userNotification.createMany.mockImplementation(() => Promise.reject(new Error('still down')));
    await expect(svc.afterLinksConfirmed('t1', ['l1'], 'u1')).resolves.toBeUndefined();
  });
});
