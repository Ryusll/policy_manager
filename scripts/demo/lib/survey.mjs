// 시연 데이터 채우기(T-216) — 대상 서버를 읽기만 한다(--plan 과 실행이 같은 조사를 쓴다). 쓰는 호출은 없다.
import { normalizeLawName, reaches } from './law-match.mjs';
import { SOURCE_PREFIX, citesOf, sourceNameOf } from './demo-policies.mjs';

/** 법령 변경 목록은 한 번에 100건까지(서버 상한) — 넘으면 더 오래된 변경은 보지 못했다고 알린다 */
export const EVENTS_LIMIT = 100;
/** 가져오기 이력은 최근 30건만 온다(서버 기본값 — 목록 경로가 건수를 받지 않는다) — 꽉 차 있으면 표시가 그 밖으로 밀렸을 수 있다 */
export const LOG_WINDOW = 30;

const norm = (v) => String(v ?? '').trim();
/**
 * 시연 문서와 내용이 같은가 — 제목·설명·부서·분류(이 스크립트가 넣은 그대로인가).
 * 서버는 부서·분류를 규정의 metadata 에 둔다(가져오기·화면 수정 모두) — 목록 응답 맨 위에는 없다.
 */
export function sameAsDemo(policy, doc) {
  const meta = policy?.metadata ?? {};
  return (
    norm(policy?.title) === norm(doc?.title) &&
    norm(policy?.description) === norm(doc?.description) &&
    norm(meta.department) === norm(doc?.department) &&
    norm(meta.category) === norm(doc?.category)
  );
}

/**
 * 이 스크립트가 넣은 시연 규정인가 — 가져오기 이력에 이 스크립트의 표시가 있고 내용이 시연 문서와 같을 때만 그렇다. 지우기·연결은
 * 되돌릴 수 없어, 확인하지 못한 규정은 건드리지 않는다(T-216 2차 검토 — 내용만 같으면 남의 규정도 지울 수 있었다):
 * 표시가 있어도 내용이 다르면(누가 고쳤거나 표시만 붙였으면) 아니고, 표시가 없으면 아니다. 이력이 꽉 차 있으면 표시가 밀려났을
 * 수 있어 '확인할 수 없음'으로 따로 알린다 — 시연 규정이 맞으면 화면에서 지운 뒤 다시 실행한다.
 * @returns {{ ours: boolean, why: null | 'contentDiffers' | 'noMarker' | 'cannotVerify' }}
 */
export function judgeOurs({ marked, same, logsFull }) {
  if (!marked) return { ours: false, why: logsFull ? 'cannotVerify' : 'noMarker' };
  if (!same) return { ours: false, why: 'contentDiffers' };
  return { ours: true, why: null };
}
const SEARCH_PAGES = 3;

const versionLabel = (v) => (v ? [v.lawType, v.promulgationNo].filter(Boolean).join(' ') + (v.revisionType ? `(${v.revisionType})` : '') : null);

export const pickEvent = (e) => ({
  id: e.id,
  nodeKey: e.nodeKey,
  label: e.label,
  changeType: e.changeType,
  lawArticleId: e.lawArticleId ?? null,
  lawEffectiveDate: e.lawEffectiveDate ?? null,
  promulgatedDate: e.promulgatedDate ?? null,
  version: versionLabel(e.version),
});

/** 법제처에서 이름이 같은 현행 법령 하나 — 없으면 null */
export async function findOnLawGoKr(api, name) {
  const want = normalizeLawName(name);
  for (let page = 1; page <= SEARCH_PAGES; page++) {
    const r = await api.get(`/lawgokr/search?q=${encodeURIComponent(name)}&display=100&page=${page}`);
    // 현행 판만 등록한다 — 연혁·시행 예정 판을 기준으로 삼지 않는다
    const pick = (r?.items ?? []).find((i) => normalizeLawName(i.title) === want && i.status === '현행');
    if (pick) return { mst: String(pick.mst), title: pick.title, effectiveDate: pick.effectiveDate ?? null };
    if (!r?.items?.length || page * 100 >= (r.total ?? 0)) return null;
  }
  return null;
}

/** 규정 상세 → 조문 행(조·항·호) */
export function flattenRows(policy) {
  return (policy?.chapters ?? []).flatMap((ch) =>
    (ch.articles ?? []).map((a) => ({
      id: a.id,
      number: a.number,
      branchNumber: a.branchNumber ?? null,
      clauseNumber: a.clauseNumber ?? null,
      itemNumber: a.itemNumber ?? null,
    })),
  );
}

/** 인용이 가리키는 우리 규정 행 — 조에 단 인용은 조 행(항·호 아님), 항에 단 인용은 그 항 행 */
export function rowOfCite(rows, cite) {
  return (
    rows.find(
      (r) =>
        r.number === cite.number &&
        (r.branchNumber ?? null) === (cite.branchNumber ?? null) &&
        (r.clauseNumber ?? null) === (cite.clauseNumber ?? null) &&
        r.itemNumber == null,
    ) ?? null
  );
}

/** 한 규정의 개정 후보 전부(상태 무관) — 쪽 나눔을 따라간다 */
export async function listCandidates(api, policyId) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await api.get(`/amendments?state=all&policyId=${encodeURIComponent(policyId)}&limit=100&page=${page}`);
    const rows = r?.rows ?? [];
    out.push(
      ...rows.map((c) => ({
        id: c.id,
        reviewState: c.reviewState,
        articleId: c.article?.id,
        eventId: c.event?.id,
        lawId: c.event?.lawId ?? null,
        lawName: c.event?.lawName ?? null,
        asOf: c.asOf ?? null,
        plannedEffectiveDate: c.plannedEffectiveDate ?? null,
        createdAt: c.createdAt,
      })),
    );
    if (!rows.length || out.length >= (r?.total ?? 0)) return out;
  }
}

/**
 * 그 변경이 닿는 조문 — 서버의 '개정 후보 만들기'와 같은 판정(GET /law-changes/:id/impact, 그 고객사의 확정 연결 전부, 조문마다 한 줄).
 * others: 이 스크립트 것이 아닌 규정 수(그 규정에도 후보가 생기므로 만들기를 하지 않는다), orphans: 그 가운데 예전 시연 규정(표시는 있지만
 * 지금 문서에 없는 코드 — 화면에서 지우면 풀린다, 7차 #5)의 수, covered: 이 변경의 후보가 이미 있는 시연 조문, uncovered: 시행 본문이
 * 있는데 후보가 없는 시연 조문, unbased: 그날 시행 본문이 없어 후보를 만들 수 없는 시연 조문. coveredIds·articleIds: 시연 조문에 있는
 * 후보 id·판정에 든 시연 조문 id — 실행이 새로 생긴 후보만 세고(7차 #1) 계획이 이미 판정에 든 조문을 두 번 세지 않게(7차 #2)
 */
export async function eventReach(api, eventId, ourPolicyIds, orphanPolicyIds = new Set()) {
  const r = await api.get(`/law-changes/${encodeURIComponent(eventId)}/impact`);
  // 항목 꼴: { policy: { id, code, … }, article: { id, … }, baseVersion: { … } | null, candidate: { id, … } | null } (law-changes.service impact)
  const policyOf = (i) => i?.policy?.id ?? null;
  const items = r?.impacted ?? [];
  const ours = items.filter((i) => ourPolicyIds.has(policyOf(i)));
  const otherIds = new Set(items.filter((i) => !ourPolicyIds.has(policyOf(i))).map(policyOf));
  const orphans = [...otherIds].filter((id) => orphanPolicyIds.has(id)).length;
  return {
    others: otherIds.size - orphans,
    orphans,
    covered: ours.filter((i) => i.candidate).length,
    uncovered: ours.filter((i) => !i.candidate && i.baseVersion).length,
    unbased: ours.filter((i) => !i.candidate && !i.baseVersion).length,
    coveredIds: ours.filter((i) => i.candidate?.id).map((i) => i.candidate.id),
    articleIds: ours.map((i) => i.article?.id).filter(Boolean),
    uncoveredIds: ours.filter((i) => !i.candidate && i.baseVersion).map((i) => i.article?.id).filter(Boolean),
  };
}

/**
 * 조사 — 법제처 연동, 규정 자리, 같은 코드의 규정(이 스크립트가 넣은 것인지), 인용 법령(등록 여부·조항·변경), 이미 넣은 시연 규정의 연결·후보.
 * 이 스크립트가 넣은 규정 = 시연 코드이고, 그 규정을 만든 가져오기 이력의 sourceName 이 `veda-demo-seed:<코드>` 인 것.
 */
export async function survey(api, demo) {
  const lawgokr = await api.get('/lawgokr/status');
  const slots = await api.get('/policies/slots');
  const policies = await api.get('/policies');
  const logs = await api.get('/policies/import-logs');
  const laws = await api.get('/laws');

  const markOf = new Map((logs ?? []).filter((l) => l.policyId && String(l.sourceName ?? '').startsWith(`${SOURCE_PREFIX}:`)).map((l) => [l.policyId, l.sourceName]));
  const logsFull = (logs ?? []).length >= LOG_WINDOW;
  const existing = (policies ?? []).flatMap((p) => {
    const doc = demo.find((d) => d.code === p.code);
    if (!doc) return [];
    const judged = judgeOurs({ marked: markOf.get(p.id) === sourceNameOf(p.code), same: sameAsDemo(p, doc), logsFull });
    return [{ id: p.id, code: p.code, title: p.title, ...judged, revisionDate: p.revisionDate ?? null, effectiveDate: p.effectiveDate ?? null }];
  });
  // 이 스크립트의 표시가 있지만 지금 시연 문서에 없는 코드의 규정(문서에서 빼거나 코드를 바꾼 뒤) — 내용을 대조할 문서가 없어 지우지
  // 않고 계획에 보인다. 이 스크립트 것으로 확인하지 못한 규정이라 만들기를 막지만, 막힌 까닭은 따로 센다(6차 #5·7차 #5)
  const orphanPolicies = (policies ?? []).filter((p) => markOf.has(p.id) && !demo.some((d) => d.code === p.code));
  const orphans = orphanPolicies.map((p) => p.code);
  const orphanIds = new Set(orphanPolicies.map((p) => p.id));

  const cites = demo.flatMap(citesOf);
  const lawNames = new Map();
  for (const c of cites) if (!lawNames.has(normalizeLawName(c.law))) lawNames.set(normalizeLawName(c.law), c.law);
  const lawState = [];
  for (const [norm, name] of lawNames) {
    const reg = (laws ?? []).find((l) => normalizeLawName(l.lawName) === norm);
    if (reg) {
      const articles = await api.get(`/laws/${reg.id}/articles`);
      const events = await api.get(`/law-changes?lawId=${encodeURIComponent(reg.id)}&limit=${EVENTS_LIMIT}`);
      lawState.push({
        norm,
        name,
        registered: { id: reg.id, lawName: reg.lawName },
        articles: (articles ?? []).map((a) => ({ id: a.id, nodeKey: a.nodeKey, label: a.label })),
        events: (events ?? []).map(pickEvent),
        eventsCapped: (events ?? []).length >= EVENTS_LIMIT,
      });
    } else {
      lawState.push({ norm, name, registered: null, search: lawgokr?.configured ? await findOnLawGoKr(api, name) : null });
    }
  }

  for (const p of existing.filter((e) => e.ours)) {
    p.rows = flattenRows(await api.get(`/policies/${p.id}`));
    p.links = [];
    for (const cite of cites.filter((c) => c.code === p.code)) {
      const row = rowOfCite(p.rows, cite);
      if (!row || p.links.some((l) => l.articleId === row.id)) continue;
      const links = await api.get(`/law-links?articleId=${encodeURIComponent(row.id)}`);
      p.links.push(...(links ?? []).map((l) => ({ articleId: row.id, lawArticleId: l.lawArticleId, confirmState: l.confirmState })));
    }
    p.candidates = await listCandidates(api, p.id);
  }

  // 시연 조문이 인용한 조항에 닿는 변경마다 서버의 지금 영향 판정 — 이 스크립트 것이 아닌 규정에도 닿는지(그러면 '개정 후보 만들기'를
  // 하지 않는다), 남아 있는 시연 조문 가운데 후보가 있는·없는 조문(화면에서 더 건 연결 포함). 계획이 실행과 같은 입력으로 센다(5차 #6)
  const ourIds = new Set(existing.filter((e) => e.ours).map((e) => e.id));
  const reachByEvent = {};
  for (const l of lawState.filter((x) => x.registered)) {
    for (const ev of l.events) {
      if (!ev.lawArticleId || !cites.some((c) => normalizeLawName(c.law) === l.norm && reaches(c.nodeKey, ev.nodeKey))) continue;
      reachByEvent[ev.id] = await eventReach(api, ev.id, ourIds, orphanIds);
    }
  }

  return { lawgokr: { configured: Boolean(lawgokr?.configured) }, slots, existing, orphans, orphanIds, lawState, cites, reachByEvent };
}
