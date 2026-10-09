import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 개정 후보에 변수 값 넣기 (T-109 ②, 특허 청구항 5, 도 9 단계 930~950·도 12).
 *
 * 막고 싶은 사고:
 * 1. 영향 조문이 아닌 조문까지 값이 바뀐다 / 다른 날의 값·다른 변수의 값이 들어간다
 * 2. 값을 정할 수 없는데(값 없음) 아무 값이나 넣는다, 법령 개정과 같은 자리를 둘 다 고쳐 문장이 깨진다
 * 3. 예정일과 다른 날로 승인해 그 날 맞지 않는 값이 발행된다 / 값을 고친 사이 승인이 옛 값으로 통과한다
 * 4. 발행된 새 버전의 연결이 옛 문구를 가리킨다
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"과 같은 날 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'IntegrationTest!234';
const LAW_BEFORE = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
const LAW_AFTER = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.';
const TEXT = '직원에게는 매년 15일의 연차휴가를 주고, 운영팀이 관리한다.';
const B_TEXT = '연차휴가는 본부장이 승인하고 15일 단위로 나누어 쓴다.';
const C_TEXT = '직원에게는 매년 15일의 연차휴가를 준다.';
const D_TEXT = '운영팀이 휴가 기록을 보관한다.';

type Key = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';

describe('T-109 ② 개정 후보에 변수 값 넣기', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const ev = randomUUID();
  const E = day(30);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let editorToken = '';
  let policyId = '';
  const art = {} as Record<Key, string>;
  const ver = {} as Record<Key, string>;
  const cand = {} as Record<Key, string>;
  const varId: Record<string, string> = {};
  const valId: Record<string, string> = {};

  const post = (path: string, json?: Record<string, unknown>, token = t1.token) => api(path, { method: 'POST', token, json: json ?? {} });
  const content = (id: string) => sql(`SELECT content FROM article_versions WHERE id='${id}';`);
  const lockOf = async (id: string) => {
    const b = (await api(`/amendments/${id}`, { token: t1.token })).body;
    return { expectedRevision: b.revision, expectedLockVersion: b.lockVersion };
  };
  const review = async (id: string) => {
    const r = await post(`/amendments/${id}/review`, await lockOf(id), editorToken);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  const approve = async (id: string, effectiveDate: string) =>
    post(`/amendments/${id}/approve`, { effectiveDate, changeNote: '법령 개정 반영', ...(await lockOf(id)) });
  const detail = async (id: string) => (await api(`/amendments/${id}`, { token: t1.token })).body;
  /** 변수 하나와 값들 — [값, 시작, 종료] */
  const variable = async (key: string, label: string, values: Array<[string, string | null, string | null]>) => {
    const r = await post('/variables', { key, label });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    varId[key] = r.body.id;
    for (const [v, from, to] of values) {
      const added = await post(`/variables/${varId[key]}/values`, { value: v, validFrom: from, validTo: to });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      valId[`${key}:${v}`] = added.body.values.find((x: any) => x.value === v && (x.validFrom ?? null) === from).id;
    }
  };
  const bind = async (k: Key, key: string, text: string) => {
    const at = content(ver[k]).indexOf(text);
    const r = await post(`/versions/${ver[k]}/variable-bindings`, { variableId: varId[key], start: at, end: at + text.length, text });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('amvar');
    const email = `editor-${t1.slug}@example.test`;
    await api('/users', { method: 'POST', token: t1.token, json: { email, password: PW, name: '편집자', role: 'editor' } });
    editorToken = (await login(email, PW, t1.slug)).body.accessToken;

    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900209', '990209', '변수반영시험법', '${E}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '${LAW_AFTER}', 'v1:p2', 1, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '60/1/', 'modified', '${LAW_BEFORE}', '${LAW_AFTER}', 'v1:p1', 'v1:p2', '${E}', 'poll', now());
    `);
    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `AVR-${Date.now().toString(36)}`, '취업규칙');
    policyId = policy.id;
    art.a = article.id;
    const keys: Key[] = ['b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (const [i, k] of keys.entries()) {
      art[k] = (await post(`/policies/${policyId}/chapters/${chapter.id}/articles`, { number: i + 2, title: `조문 ${k}`, content: '본문' })).body.id;
    }
    const texts: Record<Key, string> = { a: TEXT, b: B_TEXT, c: C_TEXT, d: D_TEXT, e: TEXT, f: TEXT, g: TEXT, h: TEXT };
    for (const k of ['a', ...keys] as Key[]) ver[k] = randomUUID();
    sql(`
      DELETE FROM article_versions WHERE article_id IN (${(['a', ...keys] as Key[]).map((k) => `'${art[k]}'`).join(',')});
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ${(['a', ...keys] as Key[]).map((k) => `('${ver[k]}', '${art[k]}', 1, '${texts[k]}', 'published', '2020-01-01', now())`).join(',\n        ')};
    `);
    // 변수 — 예정 시행일(법령 시행일 E)에 맞는 값이 각자 다르게
    await variable('DEPT_A', '담당 부서', [['운영팀', null, day(20)], ['관리팀', day(20), null]]);
    await variable('HEAD', '승인권자', []);
    await variable('DAYS', '휴가 일수', [['18일', null, null]]);
    await variable('DEPT_E', '관리 부서', [['운영팀', null, day(20)], ['관리팀', day(20), day(60)], ['지원팀', day(60), null]]);
    await variable('DEPT_F', '보관 부서', [['관리팀', null, null]]);
    await variable('DEPT_G', '담당 팀', [['관리팀', null, null]]);
    await variable('DEPT_H', '주관 팀', [['관리팀', null, null]]);
    await bind('a', 'DEPT_A', '운영팀');
    await bind('b', 'HEAD', '본부장');
    await bind('c', 'DAYS', '15일');
    await bind('d', 'DEPT_A', '운영팀');
    await bind('e', 'DEPT_E', '운영팀');
    await bind('f', 'DEPT_F', '운영팀');
    await bind('g', 'DEPT_G', '운영팀');
    await bind('h', 'DEPT_H', '운영팀');
    // d 는 연결만 있고 이 법령 변경의 영향 조문이 아니다
    for (const k of ['a', 'b', 'c', 'e', 'f', 'g', 'h'] as Key[]) {
      const r = await post('/law-links', { lawArticleId: lawArt, articleId: art[k], relationType: 'delegation', evidenceText: '연차휴가 일수' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const g = await post('/amendments/generate', { changeEventId: ev });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    expect(g.body.plannedEffectiveDate).toBe(E);
    for (const c of g.body.created) {
      const k = (Object.keys(art) as Key[]).find((x) => art[x] === c.articleId)!;
      cand[k] = c.id;
    }
  });

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  describe('후보를 만들 때', () => {
    it('영향 조문이면서 연결된 자리에 예정 시행일의 값을 넣고, 변수 근거를 법령 근거와 따로 남긴다', async () => {
      const d = await detail(cand.a);
      expect(d.candidateContent).toBe('직원에게는 매년 20일의 연차휴가를 주고, 관리팀이 관리한다.');
      expect(d.plannedEffectiveDate).toBe(E);
      const v = d.rationale.variables;
      expect(v).toEqual([
        expect.objectContaining({
          key: 'DEPT_A',
          status: 'applied',
          valueId: valId['DEPT_A:관리팀'],
          value: '관리팀',
          validFrom: day(20),
          validTo: null,
          scope: 'tenant',
          base: expect.objectContaining({ text: '운영팀' }),
          candidate: expect.objectContaining({ text: '관리팀' }),
        }),
      ]);
      const change = d.diff.changes.find((c: any) => c.candidate.text === '관리팀');
      expect(change).toMatchObject({ variableRefs: [0], rationaleRefs: [] });
      expect(d.diff.unexplained).toBe(0);
      expect(d.generationMeta).toMatchObject({ engine: 'rule/2', variables: { plannedEffectiveDate: E, applied: 1, held: 0, conflict: 0 } });
      const audit = sql(`SELECT details FROM audit_logs WHERE action='amendment.generate' AND entity_id='${ev}' AND tenant_id=(SELECT id FROM tenants WHERE slug='${t1.slug}');`);
      expect(JSON.parse(audit).candidates.find((c: any) => c.id === cand.a).variables).toEqual([
        expect.objectContaining({ key: 'DEPT_A', status: 'applied', value: '관리팀' }),
      ]);
    });

    it('연결돼 있어도 영향 조문이 아니면 바꾸지 않는다', () => {
      expect(cand.d).toBeUndefined();
      expect(content(ver.d)).toBe(D_TEXT);
    });

    it('그 날 값이 없으면 넣지 않고 "변수 값 미정"으로 — 법령 개정은 그대로 반영', async () => {
      const d = await detail(cand.b);
      expect(d.candidateContent).toBe('연차휴가는 본부장이 승인하고 20일 단위로 나누어 쓴다.');
      expect(d.rationale.variables).toEqual([expect.objectContaining({ key: 'HEAD', status: 'held', reason: 'none', valueId: null })]);
      expect(d.reviewFlags).toContain('variable_unresolved');
    });

    it('법령 개정과 같은 자리면 원문을 두고 양쪽 제안을 남긴다', async () => {
      const d = await detail(cand.c);
      expect(d.candidateContent).toBe(C_TEXT);
      expect(d.rationale.variables).toEqual([expect.objectContaining({ key: 'DAYS', status: 'conflict', reason: 'law_conflict' })]);
      expect(d.rationale.conflicts).toEqual([
        expect.objectContaining({
          proposals: expect.arrayContaining([
            expect.objectContaining({ ruleId: 'VALUE_CHANGE', replacement: '20일' }),
            expect.objectContaining({ ruleId: 'variable_value', replacement: '18일' }),
          ]),
        }),
      ]);
      expect(d.reviewFlags).toEqual(expect.arrayContaining(['variable_conflict', 'manual_draft_required']));
    });

    it('예정 시행일을 달리 주면 그 날의 값으로 다른 후보를 만든다(같은 기준 본문이어도)', async () => {
      const r = await post('/amendments/generate', { changeEventId: ev, plannedEffectiveDate: day(10) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const early = r.body.created.find((c: any) => c.articleId === art.a);
      expect(early).toBeTruthy();
      const d = await detail(early.id);
      expect(d.plannedEffectiveDate).toBe(day(10));
      expect(d.candidateContent).toBe('직원에게는 매년 20일의 연차휴가를 주고, 운영팀이 관리한다.');
      expect(d.rationale.variables[0]).toMatchObject({ status: 'unchanged', valueId: valId['DEPT_A:운영팀'] });
      // 같은 날로 다시 만들면 있던 후보를 돌려준다
      const again = await post('/amendments/generate', { changeEventId: ev, plannedEffectiveDate: day(10) });
      expect(again.body.existing.map((c: any) => c.id)).toContain(early.id);
    });
  });

  describe('승인할 때', () => {
    it('예정일과 다른 날로 승인하면 그 날 값이 다를 때 409 — 그 날로 다시 만들어 승인하면 새 값으로 발행되고 연결이 따라간다', async () => {
      await review(cand.e);
      const late = day(61);
      const blocked = await approve(cand.e, late);
      expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
      expect(blocked.body.reason).toBe('variable_changed');
      expect(blocked.body.message).toContain('관리 부서 "관리팀" → "지원팀"');
      const re = await post(`/amendments/${cand.e}/regenerate`, { asOf: late });
      expect(re.status, JSON.stringify(re.body)).toBe(200);
      expect(re.body.created).toBe(true);
      const fresh = re.body.candidateId;
      expect((await detail(fresh)).candidateContent).toBe('직원에게는 매년 20일의 연차휴가를 주고, 지원팀이 관리한다.');
      await review(fresh);
      const ok = await approve(fresh, late);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const v2 = ok.body.resultVersion.id;
      expect(content(v2)).toBe('직원에게는 매년 20일의 연차휴가를 주고, 지원팀이 관리한다.');
      const at = TEXT.indexOf('운영팀');
      expect(
        sql(`SELECT origin || ':' || state || ':' || start || '-' || "end" || ':' || text || ':' || (value_id = '${valId['DEPT_E:지원팀']}') FROM variable_bindings WHERE version_id='${v2}';`),
      ).toBe(`inherited:active:${at}-${at + 3}:지원팀:true`);
      const audit = JSON.parse(sql(`SELECT details FROM audit_logs WHERE action='amendment.approve' AND entity_id='${fresh}';`));
      expect(audit.plannedEffectiveDate).toBe(late);
      expect(audit.variables).toEqual([expect.objectContaining({ key: 'DEPT_E', status: 'applied', value: '지원팀', validFrom: day(60), scope: 'tenant' })]);
    });

    it('변수 반영 전에 만든 후보(rule/1)는 넣을 값이 생기면 승인하지 않는다', async () => {
      const lawOnly = '직원에게는 매년 20일의 연차휴가를 주고, 운영팀이 관리한다.';
      sql(`UPDATE amendment_candidates SET variant='rule/1', rationale = rationale - 'variables', candidate_content='${lawOnly}', variable_fingerprint='' WHERE id='${cand.f}';
           UPDATE amendment_revisions SET content='${lawOnly}', content_hash=encode(sha256(convert_to('${lawOnly}','UTF8')),'hex') WHERE candidate_id='${cand.f}';`);
      await review(cand.f);
      const r = await approve(cand.f, E);
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.reason).toBe('variable_changed');
      expect(r.body.message).toContain('보관 부서 "운영팀" → "관리팀"');
    });

    it('후보를 만든 뒤 값이 바뀌면 낡은 후보로 보인다(목록·상세)', async () => {
      expect((await detail(cand.g)).staleReason).toBeNull();
      expect((await api(`/variables/${varId.DEPT_G}/values/${valId['DEPT_G:관리팀']}`, { method: 'PUT', token: t1.token, json: { validTo: day(10) } })).status).toBe(200);
      expect((await post(`/variables/${varId.DEPT_G}/values`, { value: '총무팀', validFrom: day(10) })).status).toBe(201);
      expect(await detail(cand.g)).toMatchObject({ isCurrentBase: false, staleReason: 'variable_changed' });
      const list = (await api(`/amendments?state=all&changeEventId=${ev}`, { token: t1.token })).body;
      expect(list.rows.find((x: any) => x.id === cand.g)).toMatchObject({ staleReason: 'variable_changed', plannedEffectiveDate: E });
      // 같은 예정일로 다시 만들어도 값이 달라졌으니 새 후보다(변수 입력 지문) — 낡은 후보를 돌려주지 않는다
      const re = await post(`/amendments/${cand.g}/regenerate`);
      expect(re.status, JSON.stringify(re.body)).toBe(200);
      expect(re.body).toMatchObject({ created: true, unchanged: false });
      const fresh = await detail(re.body.candidateId);
      expect(fresh).toMatchObject({ plannedEffectiveDate: E, candidateContent: '직원에게는 매년 20일의 연차휴가를 주고, 총무팀이 관리한다.' });
    });

    it('승인이 값을 다시 보는 동안 값이 바뀌면 바뀐 값으로 판단한다(변수 잠금)', async () => {
      await review(cand.h);
      const valueId = valId['DEPT_H:관리팀'];
      const fn = `it_slow_value_${valueId.slice(0, 8)}`;
      sql(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
             BEGIN IF NEW.id = '${valueId}' THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
           CREATE TRIGGER ${fn} BEFORE UPDATE ON variable_values FOR EACH ROW EXECUTE FUNCTION ${fn}();`);
      let edited: Awaited<ReturnType<typeof api>>;
      let approved: Awaited<ReturnType<typeof api>>;
      try {
        const body = { effectiveDate: E, changeNote: '법령 개정 반영', ...(await lockOf(cand.h)) };
        const editing = api(`/variables/${varId.DEPT_H}/values/${valueId}`, { method: 'PUT', token: t1.token, json: { validTo: day(10) } });
        await new Promise((resolve) => setTimeout(resolve, 400));
        [edited, approved] = await Promise.all([editing, post(`/amendments/${cand.h}/approve`, body)]);
      } finally {
        sql(`DROP TRIGGER IF EXISTS ${fn} ON variable_values; DROP FUNCTION IF EXISTS ${fn}();`);
      }
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(approved.status, JSON.stringify(approved.body)).toBe(409);
      expect(approved.body.reason).toBe('variable_changed');
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${art.h}';`)).toBe('1');
    });

    it('후보를 손질해도 변수가 넣은 자리는 변수 근거로 남는다', async () => {
      const d = await detail(cand.a);
      const edited = d.candidateContent.replace('관리한다', '관리하여야 한다');
      const r = await api(`/amendments/${cand.a}`, { method: 'PATCH', token: editorToken, json: { candidateContent: edited, note: '문장 다듬기', ...(await lockOf(cand.a)) } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const after = await detail(cand.a);
      expect(after.diff.changes.find((c: any) => c.candidate.text.includes('관리팀'))).toMatchObject({ variableRefs: [0] });
    });
  });
});
