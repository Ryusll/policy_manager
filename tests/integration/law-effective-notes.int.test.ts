import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 조마다 다른 시행일 표기 (T-144, PAT-06 — 특허 도 7 S760 "조항별 시행일 구분 저장").
 *
 * 법제처의 구조화된 조문시행일자는 늘 판 시행일과 같고, 조마다 다른 날은 `[시행일: 2027.1.1]` 글자 표기로만 온다(대부분 조의 일부).
 * 그래서 표기를 날짜·범위와 함께 변경 이벤트에 스냅샷으로 남기고 화면에 알려 주되, **계획용 날짜(영향 분석 기준일·후보의 예정 시행일)는
 * 판 시행일 그대로** 둔다 — 범위를 잘못 읽어 기준일을 옮기면 후보·변수 선택까지 틀어진다.
 *
 * 법제처 없이 돈다 — 법령·조항·이벤트를 DB 에 직접 심는다(저장 쪽은 단위 시험과 실제 응답 확인으로).
 *
 * 막고 싶은 사고:
 * 1. 표기가 있는데 화면·API 에 안 나온다 / 표기 없는 이벤트에 빈 안내가 뜬다
 * 2. 표기를 근거로 계획용 날짜가 옮겨진다
 * 3. 개정 후보를 만든 뒤 표기가 바뀌면 "그때 왜"가 사라진다(근거는 만들 때의 스냅샷이어야 한다)
 */

function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
  }).trim();
}

/** 한국 날짜 — 서버의 "오늘"과 같은 날 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.';
const NOTE = {
  date: '2027-01-01',
  scope: 'partial',
  scopeText: '제60조제1항 중 "15일"의 개정부분',
  source: '조문참고자료',
  raw: '[시행일: 2027.1.1]',
};
const json = (v: unknown) => `$j$${JSON.stringify(v)}$j$::jsonb`;

describe('T-144 조별 시행일 표기', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const artClause = randomUUID(); // 제60조제1항 — 표기가 붙은 조의 항
  const artPlain = randomUUID(); // 제61조 — 표기 없음
  const evClause = randomUUID(); // 항 이벤트: 상위 조의 표기를 들고 있다(inherited)
  const evPlain = randomUUID();
  const evGone = randomUUID(); // 사라진 조항: 변경 전 표기만
  const evOld = randomUUID(); // T-144 이전에 만든 이벤트 — effective_info 칸 자체가 없다
  const evRemoved = randomUUID(); // 이번 개정으로 표기가 없어진 이벤트(같은 읽기 규칙)
  const lawEffective = day(30);

  let t: Awaited<ReturnType<typeof createTenant>>;
  let articleId = '';
  let candidateId = '';

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('effnotes');
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900143', '990143', '표기시험법', '${lawEffective}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, effective_date, effective_notes, sort_order, updated_at) VALUES
        ('${artClause}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '${LAW_AFTER}', 'v1:c', '${lawEffective}', ${json([NOTE])}, 1, now()),
        ('${artPlain}', '${lawId}', '61//', 61, NULL, '제61조', '제61조(휴가) 본문', 'v1:p', '${lawEffective}', '[]'::jsonb, 2, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, law_effective_date, received_via, effective_info) VALUES
        ('${evClause}', '${lawId}', '${artClause}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', '${lawEffective}', 'poll',
          ${json({ mst: '900143', inherited: true, before: null, after: [NOTE] })}),
        ('${evPlain}', '${lawId}', '${artPlain}', '61//', 'modified', '옛 문구', '바뀐 문구', '${lawEffective}', 'poll', NULL),
        ('${evGone}', '${lawId}', NULL, '62//', 'deleted', '제62조 옛 본문', NULL, '${lawEffective}', 'poll',
          ${json({ mst: '900143', inherited: false, before: [NOTE], after: null })}),
        ('${evOld}', '${lawId}', '${artPlain}', '61//', 'modified', '더 옛 문구', '옛 문구', '${lawEffective}', 'poll', NULL),
        ('${evRemoved}', '${lawId}', '${artPlain}', '61//', 'modified', '아주 옛 문구', '더 옛 문구', '${lawEffective}', 'poll',
          ${json({ mst: '900143', inherited: false, before: [NOTE], after: [], rules: 1, beforeRules: 1 })});
    `);

    // 회사 규정 — 제1 조문이 되는 시행본(법령 시행일 전부터 시행 중)과 확정된 연결
    const { policy, article } = await createPolicyWithArticle(t.token, `EFF-${Date.now().toString(36)}`, '취업규칙');
    articleId = article.id;
    sql(`
      DELETE FROM article_versions WHERE article_id = '${articleId}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
        VALUES ('${randomUUID()}', '${articleId}', 1, '직원에게는 매년 15일의 연차휴가를 준다.', 'published', '2020-01-01', now());
    `);
    expect(policy.id).toBeTruthy();
    const link = await api('/law-links', { method: 'POST', token: t.token, json: { lawArticleId: artClause, articleId, relationType: 'delegation', evidenceText: '연차휴가 일수' } });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
  }, 90_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  it('이벤트 목록 — 표기가 있으면 날짜·범위와 함께, 없으면(표기 없음·T-144 이전) null. 계획용 시행일은 그대로', async () => {
    const list = (await api(`/law-changes?lawId=${lawId}`, { token: t.token })).body as any[];
    const by = (id: string) => list.find((e) => e.id === id);
    expect(by(evClause).effectiveNotes).toEqual({ notes: [NOTE], inherited: true });
    expect(by(evGone).effectiveNotes).toEqual({ notes: [NOTE], inherited: false, articleGone: true }); // 사라진 조항은 변경 전 표기를 보인다
    expect(by(evPlain).effectiveNotes).toBeNull();
    expect(by(evOld).effectiveNotes).toBeNull();
    // 이번 개정으로 표기가 없어졌으면 null 이 아니라 변경 전 표기를 함께(같은 읽기 규칙일 때만)
    expect(by(evRemoved).effectiveNotes).toEqual({ notes: [], inherited: false, previous: [NOTE] });
    // 표기의 날짜(2027-01-01)로 계획용 날짜가 옮겨지지 않는다
    for (const id of [evClause, evPlain, evGone, evOld, evRemoved]) expect(by(id).lawEffectiveDate).toBe(lawEffective);
  });

  it('영향 분석 — 이벤트에 표기가 실리고, 기준일은 판 시행일 그대로(표기의 날짜가 아니다)', async () => {
    const res = await api(`/law-changes/${evClause}/impact`, { token: t.token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.event.effectiveNotes).toEqual({ notes: [NOTE], inherited: true });
    expect(res.body.asOf).toBe(lawEffective);
    expect(res.body.impacted.map((i: any) => i.article.id)).toEqual([articleId]);
  });

  it('개정 후보 — 예정 시행일은 판 시행일 그대로, 상세와 근거 스냅샷에 표기가 남는다(이후에 칸이 바뀌어도 근거는 그대로)', async () => {
    const gen = await api('/amendments/generate', { method: 'POST', token: t.token, json: { changeEventId: evClause } });
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.plannedEffectiveDate).toBe(lawEffective);
    candidateId = gen.body.created[0].id;

    const detail = (await api(`/amendments/${candidateId}`, { token: t.token })).body;
    expect(detail.plannedEffectiveDate).toBe(lawEffective);
    expect(detail.event.effectiveNotes).toEqual({ notes: [NOTE], inherited: true });
    expect(detail.rationale.law.effectiveNotes).toEqual({ notes: [NOTE], inherited: true });

    // 만든 뒤 이벤트의 표기가 바뀌어도 후보의 근거는 만들 때의 스냅샷이다
    sql(`UPDATE law_change_events SET effective_info = NULL WHERE id = '${evClause}';`);
    const after = (await api(`/amendments/${candidateId}`, { token: t.token })).body;
    expect(after.rationale.law.effectiveNotes).toEqual({ notes: [NOTE], inherited: true });
    expect(after.event.effectiveNotes).toBeNull();
  });

  it('법령 조항 목록에도 조항의 "지금" 표기가 실린다 — 법령 상세 화면이 조마다 보인다(없으면 [])', async () => {
    const res = await api(`/laws/${lawId}/articles`, { token: t.token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const by = (id: string) => res.body.find((a: any) => a.id === id);
    expect(by(artClause).effectiveNotes).toEqual([NOTE]);
    expect(by(artPlain).effectiveNotes).toEqual([]);
    expect(by(artClause).effectiveDate.slice(0, 10)).toBe(lawEffective); // 계획용 날짜는 그대로
  });

  it('토큰이 없으면 401 — 표기도 내부 정보다(기존 권한 그대로)', async () => {
    expect((await api(`/law-changes?lawId=${lawId}`)).status).toBe(401);
  });
});

/**
 * 실제 DB·법제처로 저장·맞추기를 한 번 지난다(인증값이 있을 때만 — T-104 시험과 같은 방식). 위 시험은 행을 SQL 로 심어
 * 저장 경로(saveArticles·collectEffectiveNotes)를 지나지 않는다. 여기서 막고 싶은 사고:
 * - T-144 이전에 등록한 법령(표기 null·읽기 판 null)이 주기 동기화로 채워지지 않는다 / 채우면서 이벤트를 만든다
 * - 읽기 판이 같은데 매 주기 다시 읽는다 / 판이 다르면(규칙 변경) 다시 읽지 않는다
 */
describe('T-144 조별 시행일 표기 — 실제 법제처로 저장·동기화 (인증값이 있을 때만)', () => {
  let platform: Awaited<ReturnType<typeof createTenant>>;
  let ready = false;
  let lawId = '';
  let createdByTest = false;
  const count = (where: string) => Number(sql(`SELECT count(*) FROM law_articles WHERE law_id='${lawId}' AND ${where};`));
  const events = () => Number(sql(`SELECT count(*) FROM law_change_events WHERE law_id='${lawId}';`));
  const version = () => sql(`SELECT coalesce(effective_notes_version::text, 'null') FROM laws WHERE id='${lawId}';`);

  /** 이 법령만 맨 앞에 세워 limit 1 로 돌린다 */
  const runOne = async () => {
    sql(`UPDATE laws SET last_checked_at = NULL WHERE id='${lawId}';`);
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: platform.token, json: { limit: 1 } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results[0].lawId).toBe(lawId);
    return res.body.results[0];
  };

  beforeAll(async () => {
    await waitForApi();
    platform = await createTenant('effnotes-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    const status = await api('/lawgokr/status', { token: platform.token });
    ready = status.status === 200 && status.body?.configured === true;
    if (!ready) return;
    const found = await api('/lawgokr/search?q=%EA%B7%BC%EB%A1%9C%EA%B8%B0%EC%A4%80%EB%B2%95&display=1', { token: platform.token });
    const mst = found.body.items[0].mst;
    const before = await api('/laws', { token: platform.token });
    createdByTest = !before.body.some((l: any) => l.externalId === mst);
    const reg = await api('/laws', { method: 'POST', token: platform.token, json: { mst } });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    lawId = reg.body.id;
  }, 120_000);

  afterAll(async () => {
    if (!lawId) return;
    if (createdByTest) await api(`/laws/${lawId}`, { method: 'DELETE', token: platform.token });
    // 원래 있던 법령이면 이 시험이 바꿔 둔 표기가 남지 않게 읽기 판을 비운다 — 다음 동기화가 다시 읽는다(이벤트 없음)
    else sql(`UPDATE laws SET effective_notes_version = NULL WHERE id='${lawId}';`);
  });

  it('등록하면 모든 조항이 "읽음"(null 없음)이고 법령에 지금 읽기 판이 남는다', ({ skip }) => {
    if (!ready) return skip();
    expect(count('effective_notes IS NULL')).toBe(0);
    expect(count(`jsonb_typeof(effective_notes) <> 'array'`)).toBe(0);
    expect(version()).toBe('1');
  });

  it('T-144 이전 등록(표기·판 null)은 주기 동기화가 이벤트 없이 채우고, 판이 같으면 다시 읽지 않으며, 판이 다르면 다시 읽는다', async ({ skip }) => {
    if (!ready) return skip();
    const total = count('true');
    const eventsBefore = events();
    sql(`UPDATE law_articles SET effective_notes = NULL WHERE law_id='${lawId}'; UPDATE laws SET effective_notes_version = NULL WHERE id='${lawId}';`);

    const first = await runOne();
    expect(first).toMatchObject({ outcome: 'unchanged' });
    expect(first.note ?? '').not.toContain('조별 시행일');
    expect(count('effective_notes IS NOT NULL')).toBe(total);
    expect(version()).toBe('1');
    expect(events()).toBe(eventsBefore);

    // 판이 같으면 다시 읽지 않는다 — 일부러 바꿔 둔 값이 그대로 남는다
    const key = sql(`SELECT node_key FROM law_articles WHERE law_id='${lawId}' AND deleted_at IS NULL ORDER BY sort_order LIMIT 1;`);
    const tampered = `[{"date":"2020-01-01","scope":"unknown","scopeText":"","source":"조문내용","raw":"x"}]`;
    sql(`UPDATE law_articles SET effective_notes = $j$${tampered}$j$::jsonb WHERE law_id='${lawId}' AND node_key='${key}';`);
    await runOne();
    expect(sql(`SELECT effective_notes->0->>'date' FROM law_articles WHERE law_id='${lawId}' AND node_key='${key}';`)).toBe('2020-01-01');

    // 읽기 규칙이 바뀐 것처럼 판을 옛 번호로 — 다시 읽어 바뀐 조항만 고친다(여전히 이벤트 없음)
    sql(`UPDATE laws SET effective_notes_version = 0 WHERE id='${lawId}';`);
    await runOne();
    expect(sql(`SELECT coalesce(effective_notes->0->>'date', 'none') FROM law_articles WHERE law_id='${lawId}' AND node_key='${key}';`)).not.toBe('2020-01-01');
    expect(version()).toBe('1');
    expect(events()).toBe(eventsBefore);
  }, 180_000);

  it('법제처 가져오기(사내 규정 세션)의 트리에는 표기를 싣지 않는다 — 트리 고치기로 넣어도 떼어 낸다', async ({ skip }) => {
    if (!ready) return skip();
    // 표기가 있는 법령(소득세법 — 조의 일부가 늦게 시행되는 조가 있다). 법령 트리(매퍼 결과)에는 실린다
    const found = await api(`/lawgokr/search?q=${encodeURIComponent('소득세법')}&display=5`, { token: platform.token });
    const mst = found.body.items.find((i: any) => i.title === '소득세법')?.mst;
    const lawTree = await api(`/lawgokr/laws/${mst}`, { token: platform.token });
    expect(lawTree.status, JSON.stringify(lawTree.body).slice(0, 200)).toBe(200);
    // 법제처 데이터가 바뀌어 표기가 없어지면 이 확인은 의미가 없다 — 그때는 건너뛴다
    if (!JSON.stringify(lawTree.body).includes('effectiveNotes')) return skip();

    const session = await api('/regulation-parse/from-lawgokr', { method: 'POST', token: platform.token, json: { mst } });
    expect(session.status, JSON.stringify(session.body).slice(0, 200)).toBe(201);
    expect(JSON.stringify(session.body.parseTree)).not.toContain('effectiveNotes');

    const roots = session.body.parseTree.roots;
    // 소득세법 트리 전체는 트리 고치기의 본문 한도(100kb)를 넘는다 — 떼어 내는지만 보므로 맨 앞 노드와 그 첫 자식만으로 고친다.
    // 두 깊이 모두에 넣는다(장·조 어느 깊이든 떼어야 한다)
    const [first] = roots;
    const child = first.children?.[0];
    const injected = [{ ...first, effectiveNotes: [NOTE], children: child ? [{ ...child, children: undefined, effectiveNotes: [NOTE] }] : undefined }];
    const patched = await api(`/regulation-parse/${session.body.id}/tree`, { method: 'PATCH', token: platform.token, json: { roots: injected } });
    expect(patched.status, JSON.stringify(patched.body).slice(0, 200)).toBe(200);
    expect(JSON.stringify(patched.body.parseTree)).not.toContain('effectiveNotes');
  }, 120_000);
});
