import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';

/**
 * 법제처 개정 정보 저장·표시 (T-152) — 가짜 법제처(캐시 심기)로 돈다.
 *
 * 법제처 본문의 제개정이유·개정문은 판 행(law_versions)에, 법령명약칭은 법령 행(laws)에 남긴다. 등록·판 반영은 본문을 쥔 채 바로 쓰고,
 * 이미 등록된 법령(빈 칸)은 주기 동기화가('개정 없음'이든 판을 반영했든) 이벤트 없이 채운다. 법령 변경의 펼친 한 건과 개정 후보 상세가 '법제처 개정 이유'를 싣는다.
 *
 * 막고 싶은 사고:
 * 1. 법제처가 준 이유를 버린다(등록·판 반영·이미 등록된 법령) — 또는 주지 않은 값을 빈 문자열로 남긴다
 * 2. 채우는 동기화가 이벤트·판을 새로 만들거나, 한 번 읽은 판을 매번 다시 부른다
 * 3. 다른 판 본문의 이유를 이 판의 근거로 남긴다, 조회 실패가 동기화를 깨뜨린다
 * 4. 목록 100행마다 큰 글을 싣는다, 다른 회사 후보로 이유가 새어 나간다
 */
function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function cli(args: string): { code: number; out: string } {
  try {
    return { code: 0, out: execSync(`docker compose exec -T api node dist/laws/law-sync.cli.js ${args}`, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** 한국 날짜 YYYYMMDD — 시행일이 창 안(T-149)이라 연결을 확정하면 후보가 생긴다 */
const ymd = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
const art = (no: string, title: string, body: string) => ({ no, title, body });

describe('T-152 법제처 개정 정보 저장·표시 (가짜 법제처)', () => {
  let pf: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let lawId = '';
  const law = new FakeLaw('개정정보시험법');
  const A: FakeVersion = {
    mst: law.mst(1),
    promulgated: '20260110',
    promulgationNo: '121',
    effective: '20260201',
    shortTitle: '개정정보약칭',
    reason: ['[일부개정]', '◇ A 개정 이유', '<b>굵게</b> 그대로'],
    amendment: ['국회에서 의결된 A 일부개정법률을 공포한다.'],
    articles: [art('1', '목적', '처음 본문')],
  };
  const B: FakeVersion = {
    mst: law.mst(2),
    promulgated: '20260310',
    promulgationNo: '122',
    effective: ymd(40),
    shortTitle: '개정정보약칭',
    reason: ['[일부개정]', '◇ B 개정 이유'],
    amendment: ['국회에서 의결된 B 일부개정법률을 공포한다.'],
    articles: [art('1', '목적', '두 번째 본문')],
  };
  // 법제처가 이유·개정문을 주지 않은 판
  const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '123', effective: ymd(50), shortTitle: '개정정보약칭', articles: [art('1', '목적', '세 번째 본문')] };

  const row = (mst: string) =>
    sql(
      `SELECT coalesce(promulgation_no,'-') || '|' || coalesce(revision_type,'-') || '|' || coalesce(revision_reason,'<null>') || '|' || coalesce(amendment_text,'<null>') || '|' || (revision_info_at IS NOT NULL) FROM law_versions WHERE law_id='${lawId}' AND mst='${mst}';`,
    );
  const counts = () => sql(`SELECT (SELECT count(*) FROM law_change_events WHERE law_id='${lawId}') || '|' || (SELECT count(*) FROM law_versions WHERE law_id='${lawId}');`);
  const shortTitle = () => sql(`SELECT coalesce(short_title, '<null>') FROM laws WHERE id='${lawId}';`);
  const blank = (where?: string) =>
    sql(`UPDATE law_versions SET revision_reason=NULL, amendment_text=NULL, revision_info_at=NULL WHERE law_id='${lawId}'${where ? ` AND ${where}` : ''};`);
  const runOne = async () => {
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: pf.token, json: { lawId } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results).toHaveLength(1);
    return res.body.results[0];
  };

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('revinfo-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${pf.user.id}';`);
    t2 = await createTenant('revinfo-2');
    requireRedis();
    law.seedAll([A]);
    const reg = await api('/laws', { method: 'POST', token: pf.token, json: { mst: A.mst } });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    lawId = reg.body.id;
  }, 90_000);

  afterAll(() => {
    if (lawId) {
      sql(`
        DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
        UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
        DELETE FROM laws WHERE id='${lawId}';
      `);
    }
    law.cleanup();
  });

  it('등록하면 기준판에 공포번호·제개정구분·제개정이유·개정문이, 법령 행에 약칭이 남는다 — 법령 조회·목록 응답에도 약칭', async () => {
    expect(row(A.mst)).toBe('121|일부개정|[일부개정]\n◇ A 개정 이유\n<b>굵게</b> 그대로|국회에서 의결된 A 일부개정법률을 공포한다.|true');
    expect(shortTitle()).toBe('개정정보약칭');
    expect((await api(`/laws/${lawId}`, { token: pf.token })).body.shortTitle).toBe('개정정보약칭');
    const list = (await api('/laws', { token: pf.token })).body as Array<{ id: string; shortTitle: string | null }>;
    expect(list.find((l) => l.id === lawId)?.shortTitle).toBe('개정정보약칭');
  });

  it('동기화로 반영한 판에 이유·개정문이 남고, 이유를 주지 않은 판은 null 로 두되 읽은 시각은 찍는다 — 판을 반영하는 동기화도 빈 판을 채운다', async () => {
    blank(`mst='${A.mst}'`); // 배포 전에 등록된 법령의 빈 기준판 — 판을 반영하는 동기화에서도 채워야 한다(개정이 잦은 법령)
    law.seedAll([A, B, C], C);
    const r = await runOne();
    expect(r.outcome, JSON.stringify(r)).toBe('updated');
    expect(row(B.mst)).toBe('122|일부개정|[일부개정]\n◇ B 개정 이유|국회에서 의결된 B 일부개정법률을 공포한다.|true');
    expect(row(C.mst)).toBe('123|일부개정|<null>|<null>|true');
    expect(row(A.mst)).toBe('121|일부개정|[일부개정]\n◇ A 개정 이유\n<b>굵게</b> 그대로|국회에서 의결된 A 일부개정법률을 공포한다.|true');
    expect(r.note ?? '').not.toContain('개정 정보');
  }, 120_000);

  it("빈 개정 정보는 '개정 없음' 동기화가 이벤트·판 없이 채우고, 한 번 읽은 판은 다시 부르지 않는다", async () => {
    const before = counts();
    blank();
    sql(`UPDATE laws SET short_title=NULL WHERE id='${lawId}';`);
    const r = await runOne();
    expect(r.outcome).toBe('unchanged');
    expect(r.note ?? '').not.toContain('개정 정보');
    expect(row(A.mst)).toContain('◇ A 개정 이유');
    expect(row(B.mst)).toContain('◇ B 개정 이유');
    expect(row(C.mst)).toBe('123|일부개정|<null>|<null>|true');
    expect(shortTitle()).toBe('개정정보약칭');
    expect(counts()).toBe(before);
    // 다시 읽지 않는다 — 본문을 모두 망가뜨려 둬도 채우기 실패가 없고(부르지 않았다), 일부러 바꿔 둔 글이 그대로 남는다
    sql(`UPDATE law_versions SET revision_reason='바꾼 글' WHERE law_id='${lawId}' AND mst='${B.mst}';`);
    for (const v of [A, B, C]) law.seedBrokenBody(v.mst);
    const again = await runOne();
    expect(again.outcome).toBe('unchanged');
    expect(again.note ?? '').not.toContain('개정 정보');
    expect(row(B.mst)).toContain('|바꾼 글|');
    for (const v of [A, B, C]) law.seedBody(v);
    blank(`mst='${B.mst}'`);
    await runOne();
    expect(row(B.mst)).toContain('◇ B 개정 이유');
  }, 180_000);

  it('본문 조회가 실패해도 결과는 개정 없음이고 확인 오류도 없다 — note 로 알리고 다음 동기화가 다시 채운다', async () => {
    blank(`mst='${C.mst}'`);
    law.seedBrokenBody(C.mst);
    const r = await runOne();
    expect(r.outcome).toBe('unchanged');
    expect(r.note).toContain('법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도)');
    expect(sql(`SELECT coalesce(last_check_error, 'null') FROM laws WHERE id='${lawId}';`)).toBe('null');
    expect(row(C.mst)).toBe('123|일부개정|<null>|<null>|false');
    // 읽지 못한 판에는 실패 시각이 남는다 — 다음 채우기에서 실패한 적 없는 판 뒤로 간다
    expect(sql(`SELECT revision_info_tried_at IS NOT NULL FROM law_versions WHERE law_id='${lawId}' AND mst='${C.mst}';`)).toBe('t');
    // 실패한 적 없는 B 를 공포 순으로 더 최근인 C 보다 먼저 시도한다(note 의 MST 순서 — 실제 정렬 확인)
    blank(`mst='${B.mst}'`);
    law.seedBrokenBody(B.mst);
    const order = (await runOne()).note ?? '';
    expect(order.indexOf(`MST ${B.mst}`), order).toBeGreaterThan(-1);
    expect(order.indexOf(`MST ${B.mst}`), order).toBeLessThan(order.indexOf(`MST ${C.mst}`));
    law.seedBody(B);
    law.seedBody(C);
    expect((await runOne()).note ?? '').not.toContain('개정 정보');
    expect(row(C.mst)).toBe('123|일부개정|<null>|<null>|true');
    expect(row(B.mst)).toContain('◇ B 개정 이유');
  }, 180_000);

  it('본문이 다른 판의 것(공포일이 다름)이면 채우지 않고 note 로 알린다(거부)', async () => {
    blank(`mst='${B.mst}'`);
    law.seedBody({ ...B, promulgated: '20260311' });
    const r = await runOne();
    expect(r.note).toContain(`판과 달라 개정 정보를 채우지 않았습니다(MST ${B.mst})`);
    expect(row(B.mst)).toBe('122|일부개정|<null>|<null>|false');
    law.seedBody(B);
    await runOne();
    expect(row(B.mst)).toContain('◇ B 개정 이유');
  }, 180_000);

  it('법령 변경 목록은 판 표기·제개정구분만, 펼친 한 건(영향)은 개정 이유까지 싣는다 — 판 기록이 없는 옛 변경은 null', async () => {
    const list = await api(`/law-changes?lawId=${lawId}`, { token: pf.token });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const items = list.body as Array<{ id: string; version: { promulgationNo: string } | null }>;
    const evB = items.find((e) => e.version?.promulgationNo === '122')!;
    expect(evB.version).toEqual({ lawType: '법률', promulgationNo: '122', revisionType: '일부개정' });
    expect(evB).not.toHaveProperty('revisionReason'); // 목록에는 큰 글을 싣지 않는다
    expect((await api(`/law-changes/${evB.id}/impact`, { token: pf.token })).body.event.revisionReason).toBe('[일부개정]\n◇ B 개정 이유');
    const evC = items.find((e) => e.version?.promulgationNo === '123')!;
    expect((await api(`/law-changes/${evC.id}/impact`, { token: pf.token })).body.event.revisionReason).toBeNull();

    // 판 기록이 없는 옛 변경(T-151 전) — 판 표기도 이유도 없다
    const oldId = randomUUID();
    const la = sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND node_key='1//';`);
    sql(`INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, received_via, amendments_processed_at)
         VALUES ('${oldId}', '${lawId}', '${la}', '1//', 'modified', '옛 문구', '새 문구', 'poll', now());`);
    const again = (await api(`/law-changes?lawId=${lawId}`, { token: pf.token })).body as Array<{ id: string; version: unknown }>;
    expect(again.find((e) => e.id === oldId)?.version).toBeNull();
    const oldImpact = await api(`/law-changes/${oldId}/impact`, { token: pf.token });
    expect(oldImpact.body.event).toMatchObject({ version: null, revisionReason: null });
  });

  it('개정 후보 상세는 그 변경의 판 표기·제개정구분·개정 이유를 싣고, 다른 회사에는 404', async () => {
    const { article } = await createPolicyWithArticle(pf.token, `REV-${Date.now().toString(36)}`, '취업규칙');
    sql(`
      DELETE FROM article_versions WHERE article_id='${article.id}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
        VALUES ('${randomUUID()}', '${article.id}', 1, '이 규정의 목적은 처음 본문이다.', 'published', '2020-01-01', now());
    `);
    const la = sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND node_key='1//';`);
    // 연결을 확정하면 창 안 변경으로 후보가 생긴다(T-149)
    const link = await api('/law-links', { method: 'POST', token: pf.token, json: { lawArticleId: la, articleId: article.id, relationType: 'citation' } });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const evB = sql(`SELECT e.id FROM law_change_events e JOIN law_versions v ON v.id = e.law_version_id WHERE e.law_id='${lawId}' AND v.mst='${B.mst}' LIMIT 1;`);
    const candId = sql(`SELECT id FROM amendment_candidates WHERE tenant_id='${pf.user.tenantId}' AND change_event_id='${evB}';`);
    expect(candId).not.toBe('');
    const d = await api(`/amendments/${candId}`, { token: pf.token });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.event.version).toEqual({ lawType: '법률', promulgationNo: '122', revisionType: '일부개정' });
    expect(d.body.event.revisionReason).toBe('[일부개정]\n◇ B 개정 이유');
    expect((await api(`/amendments/${candId}`, { token: t2.token })).status).toBe(404);
  });

  it('계획(--plan)은 개정 정보도 쓰지 않는다', () => {
    blank(`mst='${A.mst}'`);
    const out = cli(`--plan --law ${lawId}`);
    expect(out.code, out.out).toBe(0);
    expect(row(A.mst)).toBe('121|일부개정|<null>|<null>|false');
  });
});
