import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BASE, api, createTenant, login, waitForApi } from './helpers';
import { brief, expect409, sleepTrigger, sql, waitForBlockedBy, waitForSleep } from './race';

/**
 * 가져오기 확정은 한 번에 저장된다 (T-135, PAT-03).
 *
 * 예전 확정은 규정·장·절·조문·버전·부칙을 하나씩 저장했다(서버 파싱 가져오기는 서비스 함수로, 규정 목록의 텍스트 가져오기는 브라우저가
 * API 를 차례로 불러서). 막고 싶은 사고:
 * 1. **반쪽 규정** — 중간(버전·감사 기록·원문 사용 표시)에서 실패하면 규정만 있고 조문이 빠진 채 남고, 다시 확정하면 코드 중복으로 막혔다.
 * 2. **같은 원문으로 규정 둘** — 확정을 동시에 두 번 누르면(코드가 다르면) 둘 다 만들어졌다. 재파싱 반영(T-110)과도 원문을 함께 썼다.
 * 3. **바뀐 미리보기와 어긋난 규정** — 읽어 둔 트리로 만드는 사이 미리보기를 고치면 고친 내용이 사라졌다.
 * 4. **플랜 상한 넘김** — 잠그지 않고 센 규정 수로 마지막 한 자리를 두 요청이 함께 가져갔다(새 규정·일괄 등록도 같다).
 * 5. **첨부 없는 규정** — 원문 PDF 를 옮기다 실패하면 오류를 삼키고 첨부 없이 등록했다.
 */

const FIXTURE = join(__dirname, '..', 'fixtures', 'regulation-sample.pdf');
const FILE_NAME = '확정 시험.pdf';
const USED = '이 원문은 이미 다른 반영이나 새 규정 등록에 썼습니다';

/** API 쪽 파일 시스템 — 도커에선 api 컨테이너 안(/app/uploads), 격리 환경에선 그 API 의 UPLOAD_ROOT */
const apiShell = (cmd: string) => execSync(`docker compose exec -T api sh -c '${cmd}'`, { encoding: 'utf8' }).trim();
const tenantDir = (tenantId: string) => `"\${UPLOAD_ROOT:-/app/uploads}/${tenantId}"`;
/** 회사 업로드 폴더의 규정 첨부 폴더들(원문 보관 폴더는 빼고) */
const policyDirs = (tenantId: string) =>
  apiShell(`ls -1 ${tenantDir(tenantId)} 2>/dev/null || true`)
    .split('\n')
    .filter((n) => n && n !== 'regulation-parse')
    .sort();
const sourceKept = (tenantId: string, sid: string) =>
  apiShell(`test -f ${tenantDir(tenantId)}/regulation-parse/${sid}.pdf && echo yes || echo no`) === 'yes';

/** 조건에 맞는 행에서 실패하는 시험용 트리거 — 지우는 함수를 돌려준다 */
function failTrigger(name: string, table: string, event: 'INSERT' | 'UPDATE', condition: string) {
  const fn = `t135_${name}`;
  sql(`
    CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF ${condition} THEN RAISE EXCEPTION 'T-135 시험: % 실패', TG_TABLE_NAME; END IF;
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS ${fn} ON ${table};
    CREATE TRIGGER ${fn} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();
  `);
  return () => sql(`DROP TRIGGER IF EXISTS ${fn} ON ${table}; DROP FUNCTION IF EXISTS ${fn}();`);
}

let seq = 0;
const node = (articleNumber: string, articleTitle: string, content: string, children: any[] = []) => ({
  id: `n${(seq += 1)}`,
  articleNumber,
  articleTitle,
  content,
  parentId: null,
  depth: 0,
  pageNumber: null,
  sortOrder: seq,
  children,
});
const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq += 1)}`;

/** 원문 PDF 를 올려 미리보기가 준비된 세션 — roots 를 주면 미리보기를 그 트리로 고친다 */
async function session(token: string, roots?: any[]) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(FIXTURE)], { type: 'application/pdf' }), FILE_NAME);
  const res = await fetch(`${BASE}/regulation-parse/upload`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  let s = await res.json();
  for (let i = 0; i < 30 && s.status === 'processing'; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    s = (await api(`/regulation-parse/${s.id}`, { token })).body;
  }
  expect(s.status).toBe('ready');
  if (roots) expect((await api(`/regulation-parse/${s.id}/tree`, { method: 'PATCH', token, json: { roots } })).status).toBe(200);
  return s.id as string;
}
const commit = (token: string, sid: string, code: string) =>
  api(`/regulation-parse/${sid}/commit`, { method: 'POST', token, json: { code, title: `확정 시험 ${code}`, effectiveDate: '2024-01-01' } });
const sessionState = (sid: string) => sql(`SELECT status || ',' || coalesce(committed_policy_id, '-') FROM regulation_parse_sessions WHERE id='${sid}';`);
const policiesWithCode = (tenantId: string, code: string) => sql(`SELECT count(*) FROM policies WHERE tenant_id='${tenantId}' AND code='${code}';`);
const fileNames = async (token: string, policyId: string) => (await api(`/policies/${policyId}/files`, { token })).body.map((f: any) => f.originalName);

async function tenant(tag: string, plan: 'starter' | 'enterprise') {
  const t = await createTenant(tag);
  sql(`UPDATE tenants SET plan='${plan}' WHERE slug='${t.slug}';`);
  return { ...t, id: sql(`SELECT id FROM tenants WHERE slug='${t.slug}';`) };
}

describe('T-135 가져오기 확정 — 한 번에 저장', () => {
  let t: Awaited<ReturnType<typeof tenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await tenant('commit-atomic', 'enterprise');
  }, 60_000);

  it('확정하면 규정·장·조문·첫 버전·감사 기록·원문 첨부가 함께 생긴다 — 첫 버전엔 만든 사람도 남는다', async () => {
    const sid = await session(t.token);
    const res = await commit(t.token, sid, uniq('AT'));
    expect(res.status, brief(res)).toBe(201);
    const policyId = res.body.policyId as string;
    expect(res.body.articleCount).toBe(5);

    expect(sessionState(sid)).toBe(`committed,${policyId}`);
    expect(sql(`SELECT count(*) FROM articles a JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id='${policyId}';`)).toBe('5');
    // 본문이 빈 조 제목 행(제2조)에는 버전이 없다 — 나머지 넷은 바로 발행
    const userId = t.user.id as string;
    expect(
      sql(`
        SELECT count(*) || ',' || bool_and(v.status = 'published' AND v.version_num = 1 AND v.created_by = '${userId}' AND v.approved_by = '${userId}'
          AND v.published_at = v.approved_at AND v.effective_date = '2024-01-01' AND v.change_note = 'PDF 파싱 커밋 자동 게시')
        FROM article_versions v JOIN articles a ON a.id = v.article_id JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id='${policyId}';`),
    ).toBe('4,true');
    // 감사 기록은 같은 트랜잭션에서 — 어느 원문으로 만든 것인지 세션 id 를 남긴다
    expect(
      sql(`SELECT string_agg(action || ':' || n, ',' ORDER BY action) FROM (SELECT action, count(*) n FROM audit_logs WHERE details->>'sessionId' = '${sid}' GROUP BY action) x;`),
    ).toBe('chapter.create:1,policy.create:1,policy.file.upload:1');
    expect(await fileNames(t.token, policyId)).toEqual([FILE_NAME]);
    expect(sourceKept(t.id, sid)).toBe(false);
    // 쓴 원문으로 다시 확정하면 409(재파싱 반영과 같은 안내)
    expect409(await commit(t.token, sid, uniq('AT')), USED);
  });

  describe('저장 도중 실패하면 아무것도 남지 않고, 그대로 다시 확정하면 된다', () => {
    const cases: [string, string, 'INSERT' | 'UPDATE', (sid: string, code: string) => string][] = [
      [
        'version',
        'article_versions',
        'INSERT',
        (_sid, code) =>
          `NEW.article_id IN (SELECT a.id FROM articles a JOIN chapters c ON c.id = a.chapter_id JOIN policies p ON p.id = c.policy_id WHERE p.code = '${code}')`,
      ],
      ['audit', 'audit_logs', 'INSERT', (sid) => `NEW.action = 'policy.file.upload' AND NEW.details->>'sessionId' = '${sid}'`],
      ['session', 'regulation_parse_sessions', 'UPDATE', (sid) => `NEW.id = '${sid}' AND NEW.status = 'committed'`],
    ];
    it.each(cases)('%s 단계에서 실패', async (name, table, event, condition) => {
      const sid = await session(t.token);
      const code = uniq('AF');
      const dirsBefore = policyDirs(t.id);
      const drop = failTrigger(name, table, event, condition(sid, code));
      try {
        const res = await commit(t.token, sid, code);
        expect(res.status, brief(res)).toBe(500);
      } finally {
        drop();
      }
      expect(policiesWithCode(t.id, code)).toBe('0');
      expect(sql(`SELECT count(*) FROM audit_logs WHERE details->>'sessionId' = '${sid}';`)).toBe('0');
      expect(sessionState(sid)).toBe('ready,-');
      // 미리 복사해 둔 첨부는 지우고, 원본은 남긴다
      expect(policyDirs(t.id)).toEqual(dirsBefore);
      expect(sourceKept(t.id, sid)).toBe(true);

      const again = await commit(t.token, sid, code);
      expect(again.status, brief(again)).toBe(201);
      expect(await fileNames(t.token, again.body.policyId)).toEqual([FILE_NAME]);
      expect(sourceKept(t.id, sid)).toBe(false);
    });
  });

  it('같은 원문을 동시에 두 번 확정해도(코드가 달라도) 규정은 하나 — 뒤는 기다렸다가 409', async () => {
    const sid = await session(t.token);
    const [codeA, codeB] = [uniq('AD'), uniq('AD')];
    const dirsBefore = policyDirs(t.id);
    const drop = sleepTrigger('commit2', 'policies', 'BEFORE', 'INSERT', `NEW.code = '${codeA}'`, 2);
    try {
      const first = commit(t.token, sid, codeA);
      await waitForSleep('commit2');
      const second = commit(t.token, sid, codeB);
      await waitForBlockedBy('commit2');
      const [a, b] = await Promise.all([first, second]);
      expect(a.status, brief(a)).toBe(201);
      expect409(b, USED);
      expect(sessionState(sid)).toBe(`committed,${a.body.policyId}`);
      expect(policyDirs(t.id)).toEqual([...dirsBefore, a.body.policyId].sort());
      expect(await fileNames(t.token, a.body.policyId)).toEqual([FILE_NAME]);
    } finally {
      drop();
    }
    expect(policiesWithCode(t.id, codeB)).toBe('0');
  });

  describe('확정과 재파싱 반영이 같은 원문을 다투면 하나만 된다', () => {
    /** 조문 셋인 규정과, 둘째를 바꾼 원문의 열린 검토(바뀐 조문은 "개정"으로 정해 둔다) */
    async function openReview() {
      const roots = [node('L1', '목적', '이 규정은 확정 시험을 위한다.'), node('L2', '대상', '이 규정은 모든 직원에게 적용한다.'), node('L3', '경과', '이 조는 그대로 둔다.')];
      const base = await commit(t.token, await session(t.token, roots), uniq('AR'));
      expect(base.status, brief(base)).toBe(201);
      const policyId = base.body.policyId as string;
      const sid = await session(t.token, [roots[0], node('L2', '대상', '이 규정은 모든 직원과 파견 근로자에게 적용한다.'), roots[2]]);
      const compared = await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: t.token, json: { policyId } });
      expect(compared.status, brief(compared)).toBe(201);
      const changed = compared.body.items.find((i: any) => i.kind === 'changed');
      const decided = await api(`/reparse-reviews/${compared.body.id}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: changed.id, decision: 'amend' }] } });
      expect(decided.status, brief(decided)).toBe(200);
      return { policyId, sid, reviewId: compared.body.id as string, changedArticle: changed.articleId as string };
    }
    const apply = (reviewId: string) => api(`/reparse-reviews/${reviewId}/apply`, { method: 'POST', token: t.token });

    it('반영이 먼저면 확정은 기다렸다가 409 — 원문은 반영에 쓰였고 새 규정은 없다', async () => {
      const r = await openReview();
      const code = uniq('AA');
      const dirsBefore = policyDirs(t.id);
      const drop = sleepTrigger('apply_first', 'article_versions', 'BEFORE', 'INSERT', `NEW.reparse_item_id IS NOT NULL AND NEW.article_id = '${r.changedArticle}'`, 2);
      try {
        const applying = apply(r.reviewId);
        await waitForSleep('apply_first');
        const committing = commit(t.token, r.sid, code);
        await waitForBlockedBy('apply_first');
        const [a, c] = await Promise.all([applying, committing]);
        expect(a.status, brief(a)).toBe(201);
        expect409(c, USED);
      } finally {
        drop();
      }
      expect(sessionState(r.sid)).toBe(`committed,${r.policyId}`);
      expect(policiesWithCode(t.id, code)).toBe('0');
      expect(policyDirs(t.id)).toEqual(dirsBefore);
    });

    it('확정이 먼저면 반영은 기다렸다가 409 — 검토는 열린 채, 묶음 초안도 없다', async () => {
      const r = await openReview();
      const code = uniq('AC');
      const drop = sleepTrigger('commit_first', 'policies', 'BEFORE', 'INSERT', `NEW.code = '${code}'`, 2);
      try {
        const committing = commit(t.token, r.sid, code);
        await waitForSleep('commit_first');
        const applying = apply(r.reviewId);
        await waitForBlockedBy('commit_first');
        const [c, a] = await Promise.all([committing, applying]);
        expect(c.status, brief(c)).toBe(201);
        expect409(a, USED);
        expect(sessionState(r.sid)).toBe(`committed,${c.body.policyId}`);
      } finally {
        drop();
      }
      expect(sql(`SELECT status FROM reparse_reviews WHERE id='${r.reviewId}';`)).toBe('open');
      expect(sql(`SELECT count(*) FROM article_versions v JOIN reparse_review_items i ON i.id = v.reparse_item_id WHERE i.review_id='${r.reviewId}';`)).toBe('0');
    });
  });

  describe('확정하는 사이 원문 미리보기를 고치면', () => {
    const edited = [node('L1', '목적', '확정 중에 고친 본문')];

    it('확정이 먼저면 고치기는 기다렸다가 409 — 확정은 읽은 트리 그대로', async () => {
      const sid = await session(t.token);
      const code = uniq('AE');
      const drop = sleepTrigger('commit_tree', 'policies', 'BEFORE', 'INSERT', `NEW.code = '${code}'`, 2);
      try {
        const committing = commit(t.token, sid, code);
        await waitForSleep('commit_tree');
        const patching = api(`/regulation-parse/${sid}/tree`, { method: 'PATCH', token: t.token, json: { roots: edited } });
        await waitForBlockedBy('commit_tree');
        const [c, p] = await Promise.all([committing, patching]);
        expect(c.status, brief(c)).toBe(201);
        expect(c.body.articleCount).toBe(5);
        expect409(p, '원문을 다시 가져오세요');
      } finally {
        drop();
      }
      expect(sql(`SELECT parse_tree::text LIKE '%확정 중에 고친 본문%' FROM regulation_parse_sessions WHERE id='${sid}';`)).toBe('f');
    });

    it('고치기가 먼저면 확정은 기다렸다가 409 — 읽어 둔 옛 트리로 만들지 않는다', async () => {
      const sid = await session(t.token);
      const code = uniq('AT');
      const dirsBefore = policyDirs(t.id);
      const drop = sleepTrigger('tree_first', 'regulation_parse_sessions', 'BEFORE', 'UPDATE', `NEW.id = '${sid}' AND NEW.parse_tree::text LIKE '%확정 중에 고친 본문%'`, 2);
      try {
        const patching = api(`/regulation-parse/${sid}/tree`, { method: 'PATCH', token: t.token, json: { roots: edited } });
        await waitForSleep('tree_first');
        const committing = commit(t.token, sid, code);
        await waitForBlockedBy('tree_first');
        const [p, c] = await Promise.all([patching, committing]);
        expect(p.status, brief(p)).toBe(200);
        expect409(c, '원문 미리보기가 바뀌었습니다');
      } finally {
        drop();
      }
      expect(policiesWithCode(t.id, code)).toBe('0');
      expect(sessionState(sid)).toBe('ready,-');
      expect(policyDirs(t.id)).toEqual(dirsBefore);
      expect(sourceKept(t.id, sid)).toBe(true);
      // 고친 트리로 다시 확정하면 된다
      const again = await commit(t.token, sid, code);
      expect(again.status, brief(again)).toBe(201);
      expect(again.body.articleCount).toBe(1);
    });
  });

  describe('마지막 한 자리(플랜 상한)는 한 요청만 가져간다 — 새 규정·일괄 등록·가져오기 확정이 같은 줄에 선다', () => {
    /** 규정 넷이 있는 starter 회사(상한 5건)와 확정할 원문 */
    async function fourPolicies(tag: string) {
      const s = await tenant(tag, 'starter');
      for (let i = 1; i <= 4; i += 1) {
        const created = await api('/policies', { method: 'POST', token: s.token, json: { code: `P${i}`, title: `규정 ${i}` } });
        expect(created.status, brief(created)).toBe(201);
      }
      return { s, sid: await session(s.token) };
    }
    const count = (tenantId: string) => sql(`SELECT count(*) FROM policies WHERE tenant_id='${tenantId}';`);

    it('확정이 먼저면 새 규정 만들기는 기다렸다가 403', async () => {
      const { s, sid } = await fourPolicies('slot-commit');
      const code = uniq('SC');
      const drop = sleepTrigger('slot_commit', 'policies', 'BEFORE', 'INSERT', `NEW.code = '${code}'`, 2);
      try {
        const committing = commit(s.token, sid, code);
        await waitForSleep('slot_commit');
        const creating = api('/policies', { method: 'POST', token: s.token, json: { code: 'P5', title: '규정 5' } });
        await waitForBlockedBy('slot_commit');
        const [c, p] = await Promise.all([committing, creating]);
        expect(c.status, brief(c)).toBe(201);
        expect(p.status, brief(p)).toBe(403);
        expect(String(p.body.message)).toContain('최대 5건');
      } finally {
        drop();
      }
      expect(count(s.id)).toBe('5');
    });

    for (const first of ['create', 'import'] as const) {
      it(`${first === 'create' ? '새 규정 만들기가' : '일괄 등록이'} 먼저면 확정은 기다렸다가 403 — 복사해 둔 원문 PDF 도 지운다`, async () => {
        const { s, sid } = await fourPolicies(`slot-${first}`);
        const code = uniq('SF');
        const drop = sleepTrigger(`slot_${first}`, 'policies', 'BEFORE', 'INSERT', `NEW.code = '${code}'`, 2);
        try {
          const creating =
            first === 'create'
              ? api('/policies', { method: 'POST', token: s.token, json: { code, title: '먼저 온 규정' } })
              : api('/admin/import/policies', {
                  method: 'POST',
                  token: s.token,
                  json: { policies: [{ code, title: '먼저 온 일괄 규정', articles: [{ number: 1, title: '목적', content: '본문' }] }] },
                });
          await waitForSleep(`slot_${first}`);
          const committing = commit(s.token, sid, uniq('SL'));
          await waitForBlockedBy(`slot_${first}`);
          const [p, c] = await Promise.all([creating, committing]);
          expect(p.status, brief(p)).toBe(201);
          expect(c.status, brief(c)).toBe(403);
          expect(String(c.body.message)).toContain('최대 5건');
        } finally {
          drop();
        }
        expect(count(s.id)).toBe('5');
        expect(sessionState(sid)).toBe('ready,-');
        expect(policyDirs(s.id)).toEqual([]);
        expect(sourceKept(s.id, sid)).toBe(true);
      });
    }

    it('같은 코드로 새 규정을 동시에 만들면 하나만 — 뒤는 기다렸다가 409(500 이 아니다)', async () => {
      const code = uniq('SD');
      const drop = sleepTrigger('same_code', 'policies', 'BEFORE', 'INSERT', `NEW.code = '${code}'`, 2);
      try {
        const first = api('/policies', { method: 'POST', token: t.token, json: { code, title: '먼저' } });
        await waitForSleep('same_code');
        const second = api('/policies', { method: 'POST', token: t.token, json: { code, title: '나중' } });
        await waitForBlockedBy('same_code');
        const [a, b] = await Promise.all([first, second]);
        expect(a.status, brief(a)).toBe(201);
        expect409(b, '규정 코드가 이미 있습니다');
      } finally {
        drop();
      }
      expect(policiesWithCode(t.id, code)).toBe('1');
    });
  });

  it('원문 PDF 를 첨부 자리로 옮기지 못하면 등록하지 않는다 — 원본을 되살리면 다시 확정된다', async () => {
    const sid = await session(t.token);
    const code = uniq('AP');
    const src = `${tenantDir(t.id)}/regulation-parse/${sid}.pdf`;
    const dirsBefore = policyDirs(t.id);
    // 원본 자리에 폴더를 두면 있는 것으로 보이지만 복사는 실패한다(root 로 돌아도)
    apiShell(`mv ${src} ${src}.bak && mkdir ${src}`);
    try {
      const res = await commit(t.token, sid, code);
      expect(res.status, brief(res)).toBe(500);
      expect(String(res.body.message)).toContain('원문 PDF를 첨부하지 못해 등록하지 않았습니다');
    } finally {
      apiShell(`rmdir ${src} && mv ${src}.bak ${src}`);
    }
    expect(policiesWithCode(t.id, code)).toBe('0');
    expect(sessionState(sid)).toBe('ready,-');
    expect(policyDirs(t.id)).toEqual(dirsBefore);

    const again = await commit(t.token, sid, code);
    expect(again.status, brief(again)).toBe(201);
    expect(await fileNames(t.token, again.body.policyId)).toEqual([FILE_NAME]);
  });

  it('큰 문서(조문 1,600행)도 나눠 넣어 한 번에 등록한다 — 빠지는 행이 없다', async () => {
    const sid = await session(t.token);
    const roots = Array.from({ length: 400 }, (_, i) =>
      node(`L${i + 1}`, `조${i + 1}`, '', [1, 2, 3].map((k) => node(`C${k}`, '', `제${i + 1}조 제${k}항 본문이다.`))),
    );
    // 요청 본문 한도(100kb)를 넘는 트리라 DB 에 바로 넣는다
    sql(`UPDATE regulation_parse_sessions SET parse_tree = '${JSON.stringify({ roots })}'::jsonb WHERE id='${sid}';`);
    const started = Date.now();
    const res = await commit(t.token, sid, uniq('AB'));
    expect(res.status, brief(res)).toBe(201);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(res.body.articleCount).toBe(1600);
    const policyId = res.body.policyId as string;
    expect(sql(`SELECT count(*) FROM articles a JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id='${policyId}';`)).toBe('1600');
    expect(
      sql(`SELECT count(*) FROM article_versions v JOIN articles a ON a.id = v.article_id JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id='${policyId}' AND v.status = 'published';`),
    ).toBe('1200');
  }, 60_000);
});

describe('T-135 텍스트 가져오기 — 한 번에 저장', () => {
  const TYPE = 'application/vnd.policy-import+json';
  const PW = 'Member!2345';
  let t: Awaited<ReturnType<typeof tenant>>;
  let editor: { id: string; token: string };
  let viewerToken: string;

  /** 규정 목록 화면이 나눈 모양 그대로 — 장 표기가 없는 문서(숨김 장), 조 제목 행·항·목·가지 조문 */
  const doc = (code: string, over: Record<string, unknown> = {}) => ({
    code,
    title: ` 텍스트 규정 ${code} `,
    department: ' 인사팀 ',
    category: '',
    chapters: [
      {
        number: 1,
        title: '',
        suppressHeader: true,
        articles: [
          { number: 1, title: '목적', content: '이 규정은 텍스트 가져오기를 시험한다.' },
          { number: 2, title: '적용', content: '' },
          { number: 2, clauseNumber: 1, title: '', content: '이 규정은 모든 직원에게 적용한다.' },
          { number: 2, clauseNumber: 1, itemNumber: 1, title: '', content: '정규직' },
          { number: 3, branchNumber: 2, title: '특례', content: '특례는 두지 않는다.' },
        ],
      },
    ],
    log: { sourceName: 'manual-import', parseProfile: 'korean', articleCount: 3, cleanupOptions: { renumber: true } },
    ...over,
  });
  const importDoc = (token: string, body: unknown) =>
    api('/policies/import', { method: 'POST', token, headers: { 'Content-Type': TYPE }, body: JSON.stringify(body) });
  const rowsOf = (policyId: string) =>
    sql(`
      SELECT string_agg(concat_ws(':', a.number, coalesce(a.branch_number::text, '-'), coalesce(a.clause_number::text, '-'), coalesce(a.item_number::text, '-'),
        a.title, coalesce(v.status::text, 'none')), ',' ORDER BY a.number, a.branch_number NULLS FIRST, a.clause_number NULLS FIRST, a.item_number NULLS FIRST)
      FROM articles a JOIN chapters c ON c.id = a.chapter_id LEFT JOIN article_versions v ON v.article_id = a.id WHERE c.policy_id='${policyId}';`);
  const left = (code: string) =>
    sql(`SELECT (SELECT count(*) FROM policies WHERE tenant_id='${t.id}' AND code='${code}') || ',' ||
      (SELECT count(*) FROM audit_logs WHERE tenant_id='${t.id}' AND details->>'code' = '${code}');`);

  beforeAll(async () => {
    await waitForApi();
    t = await tenant('text-import', 'enterprise');
    const member = async (role: 'editor' | 'viewer') => {
      const email = `${role}-${t.slug}@example.test`;
      const created = await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: role, role } });
      expect(created.status, brief(created)).toBe(201);
      return { id: created.body.id as string, token: (await login(email, PW, t.slug)).body.accessToken as string };
    };
    editor = await member('editor');
    viewerToken = (await member('viewer')).token;
  }, 60_000);

  it('편집자가 가져오면 초안으로만 — 숨김 장·항·목·가지 번호·조 제목 행(버전 없음)·가져오기 이력·감사 기록이 함께', async () => {
    const code = uniq('TX');
    const res = await importDoc(editor.token, doc(code, { effectiveDate: '2024-01-01' }));
    expect(res.status, brief(res)).toBe(201);
    expect([res.body.articleCount, res.body.published]).toEqual([5, 0]);
    const policyId = res.body.id as string;
    expect(rowsOf(policyId)).toBe('1:-:-:-:목적:draft,2:-:-:-:적용:none,2:-:1:-::draft,2:-:1:1::draft,3:2:-:-:특례:draft');
    // 편집자는 시행일을 보내도 시행하지 않는다 — 관리자가 상세 화면에서 한꺼번에 시행
    expect(sql(`SELECT concat_ws('|', p.code, p.title, coalesce(p.effective_date::text, '-'), p.metadata::text) FROM policies p WHERE p.id='${policyId}';`)).toBe(
      `${code}|텍스트 규정 ${code}|-|{"department": "인사팀"}`,
    );
    expect(
      sql(`SELECT count(*) || ',' || bool_and(v.created_by = '${editor.id}' AND v.effective_date IS NULL AND v.approved_at IS NULL)
        FROM article_versions v JOIN articles a ON a.id = v.article_id JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id='${policyId}';`),
    ).toBe('4,true');
    expect(sql(`SELECT concat_ws('|', title, suppress_header) FROM chapters WHERE policy_id='${policyId}';`)).toBe('본문|t');
    expect(sql(`SELECT concat_ws('|', source_name, parse_profile, chapter_count, article_count, status, cleanup_options::text) FROM policy_import_logs WHERE policy_id='${policyId}';`)).toBe(
      'manual-import|korean|1|3|success|{"renumber": true}',
    );
    expect(
      sql(`SELECT string_agg(action, ',' ORDER BY action) FROM audit_logs WHERE details->>'source' = 'text-import' AND (entity_id = '${policyId}' OR details->>'policyId' = '${policyId}');`),
    ).toBe('chapter.create,policy.create');
  });

  it('관리자가 가져오면 시행일로 바로 시행 — 승인·발행 시각·시행 사유, 규정 시행일, 한꺼번에 시행 감사 기록', async () => {
    const code = uniq('TA');
    const res = await importDoc(t.token, doc(code, { effectiveDate: '2023-07-01' }));
    expect(res.status, brief(res)).toBe(201);
    expect(res.body.published).toBe(4);
    const policyId = res.body.id as string;
    const userId = t.user.id as string;
    expect(
      sql(`SELECT count(*) || ',' || bool_and(v.status = 'published' AND v.created_by = '${userId}' AND v.approved_by = '${userId}' AND v.published_at = v.approved_at
          AND v.effective_date = '2023-07-01' AND v.change_note = '기존 규정 가져오기 자동 게시')
        FROM article_versions v JOIN articles a ON a.id = v.article_id JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id='${policyId}';`),
    ).toBe('4,true');
    expect(sql(`SELECT effective_date FROM policies WHERE id='${policyId}';`)).toBe('2023-07-01');
    expect(sql(`SELECT details->>'count' FROM audit_logs WHERE action = 'version.bulk_publish' AND entity_id = '${policyId}';`)).toBe('4');
    // 시점 조회 — 시행일 전날엔 없고 당일부터 보인다
    expect((await api(`/policies/${policyId}/as-of?date=2023-06-30`, { token: t.token })).body.chapters.flatMap((c: any) => c.articles)).toHaveLength(0);
    expect((await api(`/policies/${policyId}/as-of?date=2023-07-01`, { token: t.token })).body.chapters.flatMap((c: any) => c.articles).length).toBeGreaterThan(0);
  });

  it('관리자인데 시행일이 없거나, 바로 시행할 본문에 변수 표식이 남았으면 400 — 아무것도 만들지 않는다', async () => {
    const missing = uniq('TM');
    const noDate = await importDoc(t.token, doc(missing));
    expect(noDate.status, brief(noDate)).toBe(400);
    expect(String(noDate.body.message)).toContain('시행일');
    expect(left(missing)).toBe('0,0');

    const key = `TXT_${(seq += 1)}`;
    expect((await api('/variables', { method: 'POST', token: t.token, json: { key, label: '가져오기 변수' } })).status).toBe(201);
    const marked = uniq('TV');
    const body = doc(marked, { effectiveDate: '2024-01-01' });
    (body.chapters as any)[0].articles[0].content = `휴가는 {{${key}}}일로 한다.`;
    const res = await importDoc(t.token, body);
    expect(res.status, brief(res)).toBe(400);
    expect(String(res.body.message)).toContain('변수 표식');
    expect(left(marked)).toBe('0,0');
  });

  it('열람자는 가져올 수 없다(403)', async () => {
    const code = uniq('TW');
    expect((await importDoc(viewerToken, doc(code))).status).toBe(403);
    expect(left(code)).toBe('0,0');
  });

  describe('저장 도중 실패하면 아무것도 남지 않고, 그대로 다시 가져오면 된다', () => {
    const cases: [string, string, (code: string) => string][] = [
      ['tx_article', 'articles', (code) => `NEW.chapter_id IN (SELECT c.id FROM chapters c JOIN policies p ON p.id = c.policy_id WHERE p.code = '${code}')`],
      ['tx_log', 'policy_import_logs', (code) => `NEW.policy_id IN (SELECT id FROM policies WHERE code = '${code}')`],
      ['tx_audit', 'audit_logs', (code) => `NEW.action = 'version.bulk_publish' AND NEW.entity_id IN (SELECT id FROM policies WHERE code = '${code}')`],
    ];
    it.each(cases)('%s 단계에서 실패', async (name, table, condition) => {
      const code = uniq('TF');
      const body = doc(code, { effectiveDate: '2024-01-01' });
      const drop = failTrigger(name, table, 'INSERT', condition(code));
      try {
        const res = await importDoc(t.token, body);
        expect(res.status, brief(res)).toBe(500);
      } finally {
        drop();
      }
      // 규정과 감사 기록(이력보다 먼저 넣는다)까지 함께 되돌린다
      expect(left(code)).toBe('0,0');
      expect(sql(`SELECT count(*) FROM policy_import_logs l JOIN policies p ON p.id = l.policy_id WHERE p.code = '${code}';`)).toBe('0');
      const again = await importDoc(t.token, body);
      expect(again.status, brief(again)).toBe(201);
      expect(again.body.published).toBe(4);
    });
  });

  it('긴 원문(JSON 기본 한도 100kb 를 넘는 문서)도 한 요청으로 — 전용 형식이면 받는다', async () => {
    const code = uniq('TL');
    const articles = Array.from({ length: 600 }, (_, i) => ({ number: i + 1, title: `조${i + 1}`, content: `${'가'.repeat(300)} ${i + 1}` }));
    const body = doc(code, { effectiveDate: '2024-01-01', chapters: [{ number: 1, title: '총칙', suppressHeader: false, articles }] });
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(500_000);
    const res = await importDoc(t.token, body);
    expect(res.status, brief(res)).toBe(201);
    expect([res.body.articleCount, res.body.published]).toEqual([600, 600]);
  }, 60_000);

  it('마지막 한 자리 — 텍스트 가져오기가 먼저면 새 규정 만들기는 기다렸다가 403', async () => {
    const s = await tenant('text-slot', 'starter');
    for (let i = 1; i <= 4; i += 1) expect((await api('/policies', { method: 'POST', token: s.token, json: { code: `P${i}`, title: `규정 ${i}` } })).status).toBe(201);
    const code = uniq('TS');
    const drop = sleepTrigger('text_slot', 'policies', 'BEFORE', 'INSERT', `NEW.code = '${code}'`, 2);
    try {
      const importing = importDoc(s.token, doc(code, { effectiveDate: '2024-01-01' }));
      await waitForSleep('text_slot');
      const creating = api('/policies', { method: 'POST', token: s.token, json: { code: 'P5', title: '규정 5' } });
      await waitForBlockedBy('text_slot');
      const [i, c] = await Promise.all([importing, creating]);
      expect(i.status, brief(i)).toBe(201);
      expect(c.status, brief(c)).toBe(403);
    } finally {
      drop();
    }
    expect(sql(`SELECT count(*) FROM policies WHERE tenant_id='${s.id}';`)).toBe('5');
  });
});
