import { inConfirmWindow } from '../apps/api/src/amendments/amendment-catchup-rules';
import { linkReachesEvent } from '../apps/api/src/law-changes/law-link-reach';

/**
 * T-216 시연 데이터 채우기 시험용 가짜 공개 API — 스크립트가 부르는 경로만, 서버와 같은 규칙으로(닿는 판정·창은 서버 함수).
 * 연결을 만들면 창 안 변경으로 그 조문에 후보를 바로 만들고(T-149), '개정 후보 만들기'는 서버처럼 같은 (변경, 조문, 기준 판, 예정
 * 시행일)이면 다시 만들지 않는다 — 기준일·예정 시행일을 주지 않으면 법령 시행일과 오늘 중 늦은 날이라, 시행일이 지난 변경은 날이 바뀌면
 * 새 후보가 생긴다(3차 검토). versions — 그 조문의 발행 수(승인하면 늘어 기준 판이 바뀐다).
 */
export type FakeRow = { id: string; number: number; branchNumber: number | null; clauseNumber: number | null; itemNumber: number | null; content: string; versions?: number };
/** detectedAt — 서버처럼 감지 시각 내림차순으로 준다(없으면 같은 시각). noChange — '개정 후보 만들기'가 실질 변경 없음으로 끝난다(시행 본문 없음은 본문 없는 행으로) */
export type FakeEvent = { id: string; nodeKey: string; label: string; lawEffectiveDate: string | null; promulgatedDate: string | null; lawArticleId: string | null; detectedAt?: string; noChange?: boolean };
export type FakeLaw = { id: string; lawName: string; articles: { id: string; nodeKey: string; label: string }[]; events: FakeEvent[] };
export type FakeState = {
  password: string;
  tenant: string;
  user: { role: string; tenantName: string; mustChangePassword: boolean };
  configured: boolean;
  max: number;
  today: string;
  /** 부서·분류는 서버처럼 metadata 에 둔다(목록 응답 맨 위에는 없다) */
  policies: { id: string; code: string; title: string; rows: FakeRow[]; description?: string; metadata?: { department?: string; category?: string }; revisionDate?: string; effectiveDate?: string }[];
  importLogs: { policyId: string | null; sourceName: string | null }[];
  laws: FakeLaw[];
  // storedName — 등록한 뒤 목록에 실리는 이름이 검색 이름과 다를 때(5차 #7)
  registerable: Record<string, { lawName: string; status?: string; storedName?: string; articles: { nodeKey: string; label: string }[] }>;
  /** 법제처 검색이 500건을 넘어 서버가 줄 세우지 않을 때처럼 가나다(키) 순 그대로 준다 — 쪽 넘김 시험 */
  searchUnranked?: boolean;
  /** 후보 목록의 event.lawName 을 바꿔 준다(법령 id → 이름) — 이름이 아니라 id 로 가르는지 보는 시험 */
  listLawName?: Record<string, string>;
  links: { id: string; lawArticleId: string; articleId: string; confirmState: string }[];
  candidates: { id: string; articleId: string; eventId: string; policyId: string; reviewState: string; revision: number; lockVersion: number; createdAt: string; baseVersion?: number; asOf?: string; planned?: string }[];
  calls: { method: string; path: string; body: unknown; redirect?: string }[];
  /** 경로 앞부분이 맞는 첫 요청에 한 번 돌려줄 응답(429·401·403 시험) */
  once: { method: string; path: string; status: number; body: unknown; headers?: Record<string, string>; text?: string }[];
};

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export function fakeState(over: Partial<FakeState> = {}): FakeState {
  return {
    password: 'pw-secret-123',
    tenant: 'demo-co',
    user: { role: 'admin', tenantName: '시연 회사', mustChangePassword: false },
    configured: true,
    max: 50,
    today: '2026-11-19',
    policies: [],
    importLogs: [],
    laws: [],
    registerable: {},
    links: [],
    candidates: [],
    calls: [],
    once: [],
    ...over,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function lawArticleById(st: FakeState, id: string) {
  for (const law of st.laws) {
    const a = law.articles.find((x) => x.id === id);
    if (a) return { law, a };
  }
  return null;
}
function policyOfRow(st: FakeState, rowId: string) {
  return st.policies.find((p) => p.rows.some((r) => r.id === rowId));
}

/** 서버처럼 기준일 — 법령 시행일과 오늘 중 늦은 날(예정 시행일도 따로 주지 않으면 같다) */
const refDate = (st: FakeState, ev: FakeEvent) => (ev.lawEffectiveDate && ev.lawEffectiveDate > st.today ? ev.lawEffectiveDate : st.today);

/** 그 변경이 닿는 확정 연결의 조문 — 그 고객사의 모든 규정(서버의 영향 판정·'개정 후보 만들기'와 같다), 서버처럼 조문마다 하나(6차 #1) */
function reached(st: FakeState, ev: FakeEvent, law: FakeLaw, onlyArticle?: string) {
  const seen = new Set<string>();
  return st.links
    .filter((l) => l.confirmState === 'confirmed' && (!onlyArticle || l.articleId === onlyArticle))
    .flatMap((link) => {
      const la = lawArticleById(st, link.lawArticleId);
      if (!la || la.law.id !== law.id || !linkReachesEvent({ lawId: law.id, nodeKey: la.a.nodeKey }, { lawId: law.id, nodeKey: ev.nodeKey })) return [];
      const policy = policyOfRow(st, link.articleId);
      const row = policy?.rows.find((r) => r.id === link.articleId);
      if (!policy || !row || seen.has(row.id)) return [];
      seen.add(row.id);
      return [{ policy, row }];
    });
}

/** 변경 하나로 후보 만들기 — 닿는 조문마다(본문 없는 조 머리 행은 건너뛴다), 같은 (변경, 조문, 기준 판, 예정 시행일)은 하나 */
function generate(st: FakeState, ev: FakeEvent, law: FakeLaw, onlyArticle?: string, dates: { asOf?: string; planned?: string } = {}) {
  const created: string[] = [];
  const existing: string[] = [];
  const skipped: string[] = [];
  if (ev.noChange) return { created, existing, skipped, noSubstantiveChange: true };
  const asOf = dates.asOf ?? refDate(st, ev);
  const planned = dates.planned ?? asOf;
  for (const { policy, row } of reached(st, ev, law, onlyArticle)) {
    if (!row.content) {
      skipped.push(row.id); // 서버처럼 시행 본문이 없으면 건너뜀(not_in_force)으로 돌려준다(8차 #6) — 그 밖의 건너뜀은 서버에 없다(9차 #7)
      continue;
    }
    const base = row.versions ?? 1;
    if (st.candidates.some((c) => c.eventId === ev.id && c.articleId === row.id && c.baseVersion === base && c.planned === planned)) existing.push(row.id);
    else {
      const createdAt = `2026-11-19T00:00:${String(st.candidates.length).padStart(2, '0')}Z`;
      st.candidates.push({ id: nextId('cand'), articleId: row.id, eventId: ev.id, policyId: policy.id, reviewState: 'draft', revision: 1, lockVersion: 0, createdAt, baseVersion: base, asOf, planned });
      created.push(row.id);
    }
  }
  return { created, existing, skipped, noSubstantiveChange: false };
}
/** 연결 확정 때 자동 생성(amendment-catchup, T-149)처럼 — 새로 확정한 그 연결이 닿는 창 안 변경만, 그 조문에 이 변경의 후보가 있으면 건너뛴다(onlyNew) */
function autoForLink(st: FakeState, link: { lawArticleId: string; articleId: string }) {
  const la = lawArticleById(st, link.lawArticleId);
  if (!la) return;
  for (const ev of la.law.events) {
    if (!ev.lawArticleId || !linkReachesEvent({ lawId: la.law.id, nodeKey: la.a.nodeKey }, { lawId: la.law.id, nodeKey: ev.nodeKey })) continue;
    if (!inConfirmWindow({ lawEffectiveDate: ev.lawEffectiveDate ? new Date(`${ev.lawEffectiveDate}T00:00:00Z`) : null }, new Date(`${st.today}T00:00:00Z`))) continue;
    if (!st.candidates.some((c) => c.eventId === ev.id && c.articleId === link.articleId)) generate(st, ev, la.law, link.articleId);
  }
}

export function fakeFetch(st: FakeState): typeof fetch {
  return ((input: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    Promise.resolve(handle(st, input, init))) as unknown as typeof fetch;
}

function handle(st: FakeState, input: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Response {
  {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    st.calls.push({ method, path: path + url.search, body, redirect: (init as { redirect?: string }).redirect });
    const once = st.once.findIndex((o) => o.method === method && path.startsWith(o.path));
    if (once >= 0) {
      const o = st.once.splice(once, 1)[0];
      if (o.text !== undefined) return new Response(o.text, { status: o.status, headers: { 'content-type': 'text/html' } });
      return json(o.status, o.body, o.headers);
    }
    const q = url.searchParams;
    if (method === 'POST' && path === '/auth/login') {
      // 서버와 같은 본문 — 고객사 없음·계정 틀림(auth.service)
      if (body.tenantSlug !== st.tenant) return json(401, { statusCode: 401, message: 'Tenant not found', error: 'Unauthorized' });
      if (body.password !== st.password) return json(401, { statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' });
      return json(200, { accessToken: 'tok-access-SECRET', refreshToken: 'tok-refresh-SECRET', user: st.user });
    }
    if (method === 'POST' && path === '/auth/refresh') return json(200, { accessToken: 'tok-access-2', refreshToken: 'tok-refresh-2' });
    if (path === '/lawgokr/status') return json(200, { configured: st.configured });
    if (path === '/policies/slots') return json(200, { plan: 'pro', used: st.policies.length, max: st.max, remaining: st.max - st.policies.length });
    if (method === 'GET' && path === '/policies') {
      return json(200, st.policies.map((p) => ({ id: p.id, code: p.code, title: p.title, description: p.description ?? null, metadata: p.metadata ?? {}, revisionDate: p.revisionDate ?? null, effectiveDate: p.effectiveDate ?? null })));
    }
    // 서버처럼 최근 30건만
    if (path === '/policies/import-logs') return json(200, st.importLogs.slice(0, 30));
    if (method === 'GET' && path === '/laws') return json(200, st.laws.map((l) => ({ id: l.id, lawName: l.lawName })));
    let m = path.match(/^\/laws\/([^/]+)\/articles$/);
    if (m) return json(200, st.laws.find((l) => l.id === m![1])?.articles ?? []);
    if (path === '/law-changes') {
      // 서버처럼 감지 시각 내림차순(같으면 nodeKey), limit 기본 50·상한 100(넘으면 400)
      const limit = q.has('limit') ? Number(q.get('limit')) : 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json(400, { message: ['limit must not be greater than 100'] });
      const law = st.laws.find((l) => l.id === q.get('lawId'));
      const rows = [...(law?.events ?? [])].sort((a, b) => String(b.detectedAt ?? '').localeCompare(String(a.detectedAt ?? '')) || a.nodeKey.localeCompare(b.nodeKey));
      return json(200, rows.slice(0, limit).map((e) => ({ ...e, lawId: law!.id, lawName: law!.lawName, version: { lawType: '법률', promulgationNo: '제1호', revisionType: '일부개정' } })));
    }
    const im = path.match(/^\/law-changes\/([^/]+)\/impact$/);
    if (im && method === 'GET') {
      // 서버의 영향 판정 — 그 변경이 닿는 확정 연결의 조문(모든 규정)과 조문마다 이미 있는 후보
      const eventId = im[1];
      const law = st.laws.find((l) => l.events.some((e) => e.id === eventId));
      const ev = law?.events.find((e) => e.id === eventId);
      if (!law || !ev) return json(404, { message: '변경 없음' });
      const impacted = ev.lawArticleId
        ? reached(st, ev, law).map(({ policy, row }) => ({
            policy: { id: policy.id, code: policy.code },
            article: { id: row.id },
            baseVersion: row.content ? { id: `${row.id}-v${row.versions ?? 1}` } : null,
            candidate: st.candidates.find((c) => c.eventId === ev.id && c.articleId === row.id) ?? null,
          }))
        : [];
      return json(200, { asOf: refDate(st, ev), impacted });
    }
    if (path === '/lawgokr/search') {
      // 법제처처럼 부분 일치로 찾고, 서버처럼 이름이 같은 것을 앞에(searchUnranked 면 키 순 그대로), display·page 로 자른다
      const want = q.get('q') ?? '';
      const display = Math.min(100, Math.max(1, Number(q.get('display') ?? 20)));
      const page = Math.max(1, Number(q.get('page') ?? 1));
      let all = Object.entries(st.registerable).filter(([, v]) => v.lawName.includes(want)).map(([mst, v]) => ({ mst, title: v.lawName, status: v.status ?? '현행' }));
      if (!st.searchUnranked) all = [...all.filter((i) => i.title === want), ...all.filter((i) => i.title !== want)];
      return json(200, { total: all.length, page, display, items: all.slice((page - 1) * display, page * display) });
    }
    if (method === 'POST' && path === '/laws') {
      const reg = st.registerable[body.mst];
      const law = { id: nextId('law'), lawName: reg.storedName ?? reg.lawName, articles: reg.articles.map((a) => ({ ...a, id: nextId('la') })), events: [] };
      st.laws.push(law);
      return json(200, { id: law.id });
    }
    m = path.match(/^\/policies\/([^/]+)$/);
    if (m && method === 'GET') {
      const p = st.policies.find((x) => x.id === m![1]);
      return p ? json(200, { id: p.id, chapters: [{ articles: p.rows }] }) : json(404, { message: '없음' });
    }
    if (m && method === 'PUT') {
      const p = st.policies.find((x) => x.id === m![1]);
      if (!p) return json(404, { message: '없음' });
      // 서버처럼 보낸 칸만 바꾼다(빠진 칸은 그대로)
      for (const k of ['revisionDate', 'effectiveDate'] as const) if (k in body) p[k] = body[k];
      return json(200, { id: p.id });
    }
    if (m && method === 'DELETE') {
      const p = st.policies.find((x) => x.id === m![1]);
      if (!p) return json(404, { message: '없음' });
      const rowIds = new Set(p.rows.map((r) => r.id));
      st.policies = st.policies.filter((x) => x !== p);
      st.links = st.links.filter((l) => !rowIds.has(l.articleId));
      st.candidates = st.candidates.filter((c) => !rowIds.has(c.articleId));
      // 서버처럼 가져오기 이력은 남고 규정 id 만 빈다(onDelete SetNull)
      for (const l of st.importLogs) if (l.policyId === p.id) l.policyId = null;
      return json(204, undefined);
    }
    if (method === 'POST' && path === '/policies/import') {
      if (st.policies.some((p) => p.code === body.code)) return json(409, { message: `규정 코드가 이미 있습니다: ${body.code}` });
      if (st.policies.length >= st.max) return json(403, { code: 'POLICY_LIMIT_REACHED', message: '상한' });
      const rows: FakeRow[] = body.chapters.flatMap((ch: { articles: Partial<FakeRow>[] }) =>
        ch.articles.map((a) => ({ id: nextId('row'), number: a.number!, branchNumber: a.branchNumber ?? null, clauseNumber: a.clauseNumber ?? null, itemNumber: a.itemNumber ?? null, content: a.content ?? '' })),
      );
      // 서버 가져오기처럼 부서·분류는 다듬어 metadata 에(있는 것만)
      const dept = body.department?.trim();
      const cat = body.category?.trim();
      const metadata = { ...(dept ? { department: dept } : {}), ...(cat ? { category: cat } : {}) };
      const p = { id: nextId('pol'), code: body.code, title: body.title, description: body.description, metadata, rows };
      st.policies.push(p);
      st.importLogs.unshift({ policyId: p.id, sourceName: body.log?.sourceName ?? null });
      return json(200, { id: p.id, articleCount: rows.length, published: rows.filter((r) => r.content).length });
    }
    if (method === 'GET' && path === '/law-links') return json(200, st.links.filter((l) => l.articleId === q.get('articleId')));
    if (method === 'POST' && path === '/law-links') {
      if (st.links.some((l) => l.articleId === body.articleId && l.lawArticleId === body.lawArticleId)) return json(409, { message: '이미 연결된 조합입니다.' });
      const link = { id: nextId('link'), lawArticleId: body.lawArticleId, articleId: body.articleId, confirmState: 'confirmed' };
      st.links.push(link);
      autoForLink(st, link);
      return json(201, link);
    }
    m = path.match(/^\/law-links\/([^/]+)$/);
    if (m && method === 'PATCH') {
      const link = st.links.find((l) => l.id === m![1])!;
      const becomesConfirmed = body.confirmState === 'confirmed' && link.confirmState !== 'confirmed';
      link.confirmState = body.confirmState;
      if (becomesConfirmed) autoForLink(st, link); // 서버처럼 확정이 아니던 연결이 확정으로 바뀔 때만(8차 #5·9차 #6)
      return json(200, link);
    }
    if (method === 'POST' && path === '/amendments/generate') {
      const law = st.laws.find((l) => l.events.some((e) => e.id === body.changeEventId))!;
      const ev = law.events.find((e) => e.id === body.changeEventId)!;
      const r = generate(st, ev, law, undefined, { asOf: body.asOf, planned: body.plannedEffectiveDate });
      return json(200, {
        changeEventId: ev.id,
        created: r.created.map((articleId) => ({ articleId })),
        existing: r.existing.map((articleId) => ({ articleId })),
        skipped: r.skipped.map((articleId) => ({ articleId, label: '시험 조문', reason: 'not_in_force' })),
        noSubstantiveChange: r.noSubstantiveChange,
        unresolvable: [],
      });
    }
    if (method === 'GET' && path === '/amendments') {
      // 서버처럼 만든 시각 내림차순, limit 기본 30·상한 100(넘으면 400), page 로 자르고 total 은 전체 수
      const limit = q.has('limit') ? Number(q.get('limit')) : 30;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json(400, { message: ['limit must not be greater than 100'] });
      const page = Math.max(1, Number(q.get('page') ?? 1));
      const all = st.candidates
        .filter((c) => c.policyId === q.get('policyId'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map((c) => {
          const law = st.laws.find((l) => l.events.some((e) => e.id === c.eventId));
          return { id: c.id, reviewState: c.reviewState, createdAt: c.createdAt, asOf: c.asOf ?? null, plannedEffectiveDate: c.planned ?? null, article: { id: c.articleId }, event: { id: c.eventId, lawId: law?.id, lawName: (law && st.listLawName?.[law.id]) ?? law?.lawName } };
        });
      return json(200, { rows: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit });
    }
    m = path.match(/^\/amendments\/([^/]+)(\/review)?$/);
    if (m) {
      const id = m[1];
      const c = st.candidates.find((x) => x.id === id)!;
      if (!m[2]) return json(200, { id: c.id, revision: c.revision, lockVersion: c.lockVersion });
      if (body.expectedRevision !== c.revision || body.expectedLockVersion !== c.lockVersion) return json(409, { message: '잠금 어긋남' });
      c.reviewState = 'review';
      c.lockVersion++;
      return json(200, { id: c.id });
    }
    return json(404, { message: `가짜 API 에 없는 경로: ${method} ${path}` });
  }
}
