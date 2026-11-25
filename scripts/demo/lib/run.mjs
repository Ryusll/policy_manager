// 시연 데이터 채우기(T-216) — 계획대로 쓴다. 공개 API 만 부르고(DB 직접 쓰기 없음, ADR-0029), 다시 돌려도 중복이 생기지 않는다:
// 같은 코드의 시연 규정은 다시 넣지 않고, 같은 연결은 409(이미 연결)로 건너뛰고, '개정 후보 만들기'는 닿는 시연 조문에 이 변경의 후보가
// 하나도 없고 시연 규정이 아닌 규정에도 닿지 않을 때만 부른다(rules.generateAction — 서버의 중복 판정에는 예정 시행일·발행 이력·공통
// 기준값 지문이 들어 있어 기대지 않는다).
import { ApiError } from './api.mjs';
import { rowLabel, toImportBody } from './demo-policies.mjs';
import { normalizeLawName, reaches } from './law-match.mjs';
import { generateAction, lawsReached, lawsWithoutCandidates } from './rules.mjs';
import { eventReach, flattenRows, listCandidates, rowOfCite } from './survey.mjs';

/** 연결 종류 — 시연 조문은 법령이 정한 사용자 의무를 사내 기준으로 옮긴 것이다(화면 표기 '의무') */
export const RELATION_TYPE = 'obligation';
/** 검토 요청 사유 — 본문이 기준 본문과 같은 후보는 사유가 있어야 검토로 보낼 수 있다 */
export const REVIEW_REASON = '법령 개정 내용을 사내 규정에 반영할지 검토가 필요합니다.';

/** 인용한 우리 행의 글 — 연결의 근거 문구로 싣는다(본문에 있는 글이라 근거의 출처 판이 남는다, T-177) */
export function citeText(demo, cite) {
  const doc = demo.find((d) => d.code === cite.code);
  for (const ch of doc?.chapters ?? []) {
    const a = ch.articles.find((x) => x.number === cite.number && (x.branchNumber ?? null) === (cite.branchNumber ?? null));
    if (!a) continue;
    if (cite.clauseNumber == null) return a.content ?? '';
    const c = a.clauses?.[cite.clauseNumber - 1];
    return typeof c === 'string' ? c : (c?.text ?? '');
  }
  return '';
}

const byCreated = (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

/** 이미 있는 연결이 추천(suggested)이면 확정한다 — 확정이 아니면 개정 후보가 생기지 않는다. 사람이 반려한 연결은 건드리지 않는다 */
async function ensureConfirmed(api, rowId, lawArticleId) {
  const links = await api.get(`/law-links?articleId=${encodeURIComponent(rowId)}`);
  const link = (links ?? []).find((l) => l.lawArticleId === lawArticleId);
  if (!link) return 'missing';
  if (link.confirmState === 'confirmed') return 'existing';
  if (link.confirmState === 'rejected') return 'rejected';
  await api.patch(`/law-links/${link.id}`, { confirmState: 'confirmed' });
  return 'confirmed';
}

/**
 * @param progress 지운 수를 적는다 — 실패했을 때 다시 실행 안내(--reset 으로 다시 / --reset 없이)를 가른다
 * @returns 실행 결과(건수) — 출력은 formatResult
 */
export async function execute(api, demo, s, plan, { log = () => {}, progress = { deleted: 0 } } = {}) {
  const r = {
    deleted: 0,
    imported: 0,
    lawsRegistered: [],
    links: { created: 0, existing: 0, confirmed: 0, skipped: [] },
    // blocked·orphanOnly·partial — 변경마다 한 줄(글), …Rows — 만들지 않은 후보(조문) 수(계획과 같은 단위, 8차 #3)
    candidates: { created: 0, linked: 0, existing: 0, skipped: 0, noChange: 0, events: 0, blocked: [], blockedRows: 0, orphanOnly: [], orphanRows: 0, orphanReset: false, partial: [], partialRows: 0 },
    reviewRequested: false,
    pending: 0,
    inReview: 0,
    pendingByLaw: {},
    candidatesTotal: 0,
    lawsWithoutCandidates: { registeredNow: [], lostAfterRegister: [], reachedNone: [], noEvents: [], notRegistered: [] },
    datesFilled: 0,
  };

  for (const p of plan.toDelete) {
    await api.del(`/policies/${p.id}`);
    r.deleted++;
    progress.deleted++;
    log(`지움: ${p.code}`);
  }

  const policies = new Map(); // 코드 → { id, rows }
  for (const p of s.existing.filter((e) => e.ours && plan.kept.includes(e.code))) policies.set(p.code, { id: p.id, rows: p.rows ?? [] });
  // 앞 실행이 넣은 뒤 날짜를 채우다 멈춘 규정 — 계획에 보인 대로 비어 있는 칸만 채운다(채워진 칸은 덮지 않는다 — 서버는 보낸 칸만 바꾼다)
  for (const d of plan.dateFills ?? []) {
    const doc = demo.find((x) => x.code === d.code);
    await api.put(`/policies/${d.id}`, Object.fromEntries(d.fields.map((f) => [f, doc.effectiveDate])));
    r.datesFilled++;
  }
  for (const code of plan.toImport) {
    const doc = demo.find((d) => d.code === code);
    const made = await api.post('/policies/import', toImportBody(doc));
    // 규정의 개정일·시행일(머리 카드·대시보드 '최근 개정') — 가져오기는 조문 판의 시행일만 정한다
    await api.put(`/policies/${made.id}`, { revisionDate: doc.effectiveDate, effectiveDate: doc.effectiveDate });
    policies.set(code, { id: made.id, rows: flattenRows(await api.get(`/policies/${made.id}`)) });
    r.imported++;
    log(`넣음: ${code} ${doc.title} (조문 ${made.articleCount ?? '?'}개, 발행 ${made.published ?? '?'}개)`);
  }

  const lawArticles = new Map(s.lawState.filter((l) => l.registered).map((l) => [l.norm, l.articles]));
  const lawEvents = new Map(s.lawState.filter((l) => l.registered).map((l) => [l.norm, l.events]));
  for (const l of plan.lawsToRegister) {
    await api.post('/laws', { mst: l.mst });
    // 응답 꼴에 기대지 않고 목록에서 다시 찾는다
    const found = ((await api.get('/laws')) ?? []).find((x) => normalizeLawName(x.lawName) === normalizeLawName(l.name));
    r.lawsRegistered.push({ name: l.name, ok: Boolean(found) });
    if (!found) continue;
    const arts = (await api.get(`/laws/${found.id}/articles`)) ?? [];
    lawArticles.set(normalizeLawName(l.name), arts.map((a) => ({ id: a.id, nodeKey: a.nodeKey, label: a.label })));
    lawEvents.set(normalizeLawName(l.name), []); // 현행 판이 기준이라 변경이 없다 — 동기화 뒤 다시 실행
    log(`법령 등록: ${l.name}`);
  }

  const linked = [];
  for (const cite of s.cites) {
    const policy = policies.get(cite.code);
    if (!policy) continue;
    const row = rowOfCite(policy.rows, cite);
    const norm = normalizeLawName(cite.law);
    const lawArticle = (lawArticles.get(norm) ?? []).find((a) => a.nodeKey === cite.nodeKey);
    if (!row || !lawArticle) {
      r.links.skipped.push(`${rowLabel(cite)} → ${cite.law} ${cite.label}${row ? ' (법령에 그 조항이 없거나 법령이 등록되지 않음)' : ' (규정에서 그 행을 찾지 못함)'}`);
      continue;
    }
    try {
      await api.post('/law-links', { lawArticleId: lawArticle.id, articleId: row.id, relationType: RELATION_TYPE, evidenceText: citeText(demo, cite).slice(0, 2000) });
      r.links.created++;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;
      const state = await ensureConfirmed(api, row.id, lawArticle.id);
      if (state === 'existing') r.links.existing++;
      else if (state === 'confirmed') r.links.confirmed++;
      else {
        r.links.skipped.push(`${rowLabel(cite)} → ${cite.law} ${cite.label} (${state === 'rejected' ? '반려된 연결 — 그대로 둔다' : err.message})`);
        continue;
      }
    }
    linked.push({ cite, norm });
  }

  // 연결한 조항에 닿는 변경마다 서버의 영향 판정을 보고 '개정 후보 만들기'를 부를지 정한다(generateAction) — 창 안 변경은
  // 연결을 확정할 때 그 조문에 이미 생겨 대개 '다 있음'이다
  const eventLaw = new Map(); // 변경 id → { law, label, norm }
  for (const { cite, norm } of linked) {
    for (const ev of lawEvents.get(norm) ?? []) if (ev.lawArticleId && reaches(cite.nodeKey, ev.nodeKey)) eventLaw.set(ev.id, { law: cite.law, label: ev.label, norm });
  }
  const ourIds = new Set([...policies.values()].map((p) => p.id));
  // 조사 때 시연 규정에 있던 후보 — 실행 뒤 그 밖의 후보만 이번 연결 확정으로 바로 생긴 것(T-149)으로 센다(6차 #2). 판정에 늘어난
  // 조문 수로 세면, 연결을 지웠다 다시 잇는 조문은 옛 후보를 들고 판정에 다시 들어올 뿐인데도 '새로'가 됐다(7차 #1). --reset 이면
  // 그때의 시연 규정은 후보와 함께 지웠다
  const seenBefore = new Set(plan.reset ? [] : s.existing.filter((e) => e.ours).flatMap((p) => (p.candidates ?? []).map((c) => c.id)));
  for (const [id, ev] of eventLaw) {
    r.candidates.events++;
    const reach = await eventReach(api, id, ourIds, s.orphanIds ?? new Set());
    const action = generateAction(reach);
    const linkedNow = reach.coveredIds.filter((cid) => !seenBefore.has(cid)).length;
    r.candidates.linked += linkedNow;
    r.candidates.existing += reach.covered - linkedNow;
    // 예전 시연 규정에만 막혔으면 그 규정을 화면에서 지우면 풀린다 — 다른 규정에도 닿으면 지워도 막혀 '다른 규정'으로 알린다(8차 #1·#2)
    if (action === 'others' && reach.others === 0) {
      r.candidates.orphanOnly.push(`${ev.law} ${ev.label}(예전 시연 규정 ${reach.orphans}개)`);
      r.candidates.orphanRows += reach.uncovered;
      // 일부 시연 조문에 이미 이 변경의 후보가 있으면 지운 뒤에도 '일부 조문에만'으로 막힌다 — 지운 뒤 --reset(9차 #4)
      if (reach.covered > 0) r.candidates.orphanReset = true;
    } else if (action === 'others') {
      r.candidates.blocked.push(`${ev.law} ${ev.label}(다른 규정 ${reach.others}개${reach.orphans ? ` · 예전 시연 규정 ${reach.orphans}개` : ''})`);
      r.candidates.blockedRows += reach.uncovered;
    }
    if (action === 'partial') {
      r.candidates.partial.push(`${ev.law} ${ev.label}(후보 없는 시연 조문 ${reach.uncovered}개)`);
      r.candidates.partialRows += reach.uncovered;
    }
    // 시행 본문이 없어 후보를 만들 수 없는 시연 조문 — 만들기를 부르면 서버가 건너뜀으로 세고, 부르지 않을 때는 여기서 센다(5차 #8)
    if (action !== 'generate') {
      r.candidates.skipped += reach.unbased;
      continue;
    }
    const g = await api.post('/amendments/generate', { changeEventId: id });
    r.candidates.created += g?.created?.length ?? 0;
    r.candidates.skipped += g?.skipped?.length ?? 0;
    if (g?.noSubstantiveChange) r.candidates.noChange++;
  }

  const all = [];
  for (const { id } of policies.values()) all.push(...(await listCandidates(api, id)));
  if (!all.some((c) => c.reviewState === 'review')) {
    const draft = all.filter((c) => c.reviewState === 'draft').sort(byCreated)[0];
    if (draft) {
      const d = await api.get(`/amendments/${draft.id}`);
      await api.post(`/amendments/${draft.id}/review`, { expectedRevision: d.revision, expectedLockVersion: d.lockVersion, reason: REVIEW_REASON });
      draft.reviewState = 'review';
      r.reviewRequested = true;
    }
  }
  const pending = all.filter((c) => c.reviewState === 'draft' || c.reviewState === 'review');
  r.pending = pending.length;
  r.inReview = pending.filter((c) => c.reviewState === 'review').length;
  for (const c of pending) r.pendingByLaw[c.lawName ?? '?'] = (r.pendingByLaw[c.lawName ?? '?'] ?? 0) + 1;
  r.candidatesTotal = all.length;
  // 후보가 하나도 없는 인용 법령을 까닭별로 — 계획과 같은 함수(rules.lawsWithoutCandidates)다. 법령 id 로 가르고, id 가 없으면 이름으로.
  // 닿는 변경은 잇지 못한 인용(반려된 연결·법령에 없는 조항)까지 인용 전부로 보고, 등록했지만 목록에서 못 찾은 법령은 따로 둔다(5차 #7)
  const lawIds = new Set(all.map((c) => c.lawId).filter(Boolean));
  const lawNames = new Set(all.map((c) => normalizeLawName(c.lawName ?? '')).filter(Boolean));
  const registered = (ok) => new Set(r.lawsRegistered.filter((l) => l.ok === ok).map((l) => normalizeLawName(l.name)));
  r.lawsWithoutCandidates = lawsWithoutCandidates(s.lawState, {
    hasCandidate: (l) => Boolean(l.registered && lawIds.has(l.registered.id)) || lawNames.has(l.norm),
    reached: lawsReached(s.cites, (norm) => lawEvents.get(norm)),
    registeredNow: registered(true),
    lostAfterRegister: registered(false),
  });
  return r;
}
