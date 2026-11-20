// 시연 데이터 채우기(T-216) — 조사 결과로 무엇을 할지 정한다(쓰지 않는 순수 함수). --plan 은 이것을 글(plan-text.mjs)로 보이고 끝난다.
// 후보 수는 실행과 같은 규칙(rules.mjs)으로, 실행 때의 서버 영향 판정을 미리 세어 낸다 — 남아 있는 시연 규정은 서버의 지금 판정(화면에서
// 더 건 연결 포함)에 이번에 확정되는 연결을 더한다. 이번에 잇는 조문에는 시행 본문이 있다고 보고 세므로(서버는 없으면 건너뛴다)
// 실행 결과가 계획보다 적을 수 있다 — 그래서 '새로 최대'다.
import { inConfirmWindow, normalizeLawName, reaches } from './law-match.mjs';
import { rowLabel } from './demo-policies.mjs';
import { generateAction, lawsReached, lawsWithoutCandidates } from './rules.mjs';
import { rowOfCite } from './survey.mjs';

/**
 * @param demo 시연 규정 문서들
 * @param s survey() 결과
 * @param {{ today: string, reset: boolean }} o
 */
export function buildPlan(demo, s, { today, reset }) {
  const conflicts = s.existing.filter((e) => !e.ours).map((e) => e.code);
  const conflictWhy = Object.fromEntries(s.existing.filter((e) => !e.ours).map((e) => [e.code, e.why]));
  const ours = s.existing.filter((e) => e.ours);
  const toDelete = reset ? ours.map((p) => ({ id: p.id, code: p.code })) : [];
  const kept = reset ? [] : ours;
  // 앞 실행이 넣은 뒤 날짜를 채우다 멈춘 규정 — 비어 있는 칸만 채운다(계획에 보인다)
  const dateFills = kept
    .map((k) => ({ id: k.id, code: k.code, fields: ['revisionDate', 'effectiveDate'].filter((f) => !k[f]) }))
    .filter((d) => d.fields.length);
  const toImport = demo.map((d) => d.code).filter((code) => !conflicts.includes(code) && !kept.some((k) => k.code === code));
  const slotsNeeded = toImport.length - toDelete.length;
  const slotShort = typeof s.slots?.remaining === 'number' && slotsNeeded > s.slots.remaining ? { needed: slotsNeeded, remaining: s.slots.remaining, plan: s.slots.plan } : null;

  const lawsToRegister = s.lawState.filter((l) => !l.registered && l.search).map((l) => ({ name: l.name, mst: l.search.mst }));
  const lawsMissing = s.lawState.filter((l) => !l.registered && !l.search).map((l) => l.name);
  const lawOf = new Map(s.lawState.map((l) => [l.norm, l]));

  // 인용마다: 연결할 법령 조항(등록된 법령에서 찾음), 이미 있는 연결, 닿는 변경
  // 연결 셈은 실행과 같다(7차 #4) — 새로(만듦)·이미 있음(확정)·추천을 확정·반려(잇지 않음, 아래 '!' 줄)·법령 등록 뒤
  const links = { toCreate: 0, existing: 0, toConfirm: 0, waitRegister: 0, unresolved: [], rejected: [], missingRows: [] };
  const lines = new Map(); // 판 묶음(법령·판·시행일) → 줄
  // auto: 이번에 확정되는 연결로 바로 생김(그 조문에만, T-149), manual: '개정 후보 만들기', blocked: 다른 규정에도 닿아 만들기를 하지 않음
  // (orphanBlocked: 그 가운데 예전 시연 규정에 막힌 것), partial: 다른 시연 조문에 이미 후보가 있어 만들기를 하지 않음 — 실행과 같은
  // rules.generateAction 으로 변경마다 가른다
  const candidates = { auto: 0, manual: 0, existing: 0, blocked: 0, orphanBlocked: 0, orphanReset: false, partial: 0 };
  const perEvent = new Map(); // 변경 id → { law, ev, inWindow, rows: Map(조문 행 → { label, has, anyNew, rowId }) }
  for (const cite of s.cites) {
    if (conflicts.includes(cite.code)) continue;
    const keptPolicy = kept.find((k) => k.code === cite.code);
    const row = keptPolicy ? rowOfCite(keptPolicy.rows ?? [], cite) : null;
    if (keptPolicy && !row) {
      // 남아 있는 시연 규정에서 그 행을 찾지 못함(화면에서 조문을 지우거나 번호를 바꿨다) — 실행도 잇지 않고 건너뛴다. 법령 등록을
      // 기다리는 인용이어도 같다(6차 #6·7차 #3)
      links.missingRows.push(`${rowLabel(cite)} → ${cite.law} ${cite.label}`);
      continue;
    }
    const law = lawOf.get(normalizeLawName(cite.law));
    if (!law?.registered) {
      if (law?.search) links.waitRegister++;
      continue;
    }
    const lawArticle = law.articles.find((a) => a.nodeKey === cite.nodeKey);
    if (!lawArticle) {
      links.unresolved.push(`${rowLabel(cite)} → ${cite.law} ${cite.label}`);
      continue;
    }
    const existingLink = row ? keptPolicy.links.find((l) => l.articleId === row.id && l.lawArticleId === lawArticle.id) : null;
    if (existingLink?.confirmState === 'rejected') {
      links.rejected.push(`${rowLabel(cite)} → ${cite.law} ${cite.label}`); // 사람이 반려한 연결 — 잇지 않는다(실행도 건너뛴다)
      continue;
    }
    if (!existingLink) links.toCreate++;
    else if (existingLink.confirmState === 'suggested') links.toConfirm++;
    else links.existing++;
    // 이번에 확정되는 연결(새 연결·추천 확정) — 창 안 변경의 후보를 그 조문에만 바로 만든다(T-149, 그 조문에 이 변경의 후보가 없을 때)
    const linksNow = !existingLink || existingLink.confirmState === 'suggested';
    for (const ev of law.events) {
      if (!ev.lawArticleId || !reaches(cite.nodeKey, ev.nodeKey)) continue;
      const inWindow = inConfirmWindow(ev.lawEffectiveDate, today);
      const e = perEvent.get(ev.id) ?? { law, ev, inWindow, rows: new Map() };
      // 이 변경의 후보가 그 조문에 이미 있는가(상태 무관). 서버 판정은 조문마다 한 줄이라 한 조문의 인용 둘(상하위 조항)이 같은 변경에
      // 닿아도 한 번 센다(6차 #1). 그 조문이 지금 판정에 들어 있는지는 서버가 준 조문 id 로 가른다(7차 #2)
      const has = Boolean(row && keptPolicy.candidates.some((c) => c.eventId === ev.id && c.articleId === row.id));
      const rowKey = `${cite.code}|${cite.number}|${cite.branchNumber ?? ''}|${cite.clauseNumber ?? ''}`;
      const prev = e.rows.get(rowKey);
      e.rows.set(rowKey, { label: rowLabel(cite), has: has || Boolean(prev?.has), anyNew: linksNow || Boolean(prev?.anyNew), rowId: row?.id ?? null });
      perEvent.set(ev.id, e);
    }
  }
  for (const { law, ev, inWindow, rows: rowMap } of perEvent.values()) {
    const rows = [...rowMap.values()];
    const key = `${law.name}|${ev.version ?? ''}|${ev.lawEffectiveDate ?? ''}|${ev.promulgatedDate ?? ''}`;
    const line = lines.get(key) ?? { law: law.name, version: ev.version, lawEffectiveDate: ev.lawEffectiveDate, promulgatedDate: ev.promulgatedDate, inWindow, events: new Set(), rows: new Set(), newCandidates: 0, blocked: 0, orphanBlocked: 0, partial: 0 };
    line.events.add(ev.id);
    for (const r of rows) line.rows.add(r.label);
    // 실행 때의 영향 판정 = 남아 있는 시연 규정의 지금 판정(서버 — 이미 확정된 연결 전부, 시행 본문 없는 조문은 빠진다) + 이번에
    // 확정되는 연결(창 안이면 바로 후보, 아니면 후보 없는 조문). --reset 이면 남는 시연 규정이 없다. 조사는 인용에 닿는 변경마다
    // 판정을 받아 두므로 빠질 수 없다 — 빠졌으면 어림하지 않고 멈춘다
    const now = s.reachByEvent?.[ev.id];
    if (!now) throw new Error('조사에 없는 법령 변경이 계획에 들어왔습니다 — 이 출력을 개발팀에 알리세요');
    const stays = reset ? { covered: 0, uncovered: 0 } : now;
    const inNow = new Set(reset ? [] : (now.articleIds ?? []));
    const uncoveredNow = new Set(reset ? [] : (now.uncoveredIds ?? []));
    // fresh: 지금 판정 밖이고 이번에 잇는 조문. 이미 판정에 든 조문(화면에서 더 건 확정 연결)은 stays 에 들어 있어 다시 세지 않는다(7차 #2)
    // — 그 조문에 이번에 시연 연결을 확정하면 창 안이고 후보가 없을 때 바로 생긴다(relinked)
    const fresh = rows.filter((r) => r.anyNew && !inNow.has(r.rowId));
    const freshHas = fresh.filter((r) => r.has).length; // 연결은 새것이지만 이 변경의 후보는 이미 있는 조문
    const relinked = inWindow ? rows.filter((r) => r.anyNew && uncoveredNow.has(r.rowId)).length : 0;
    const freshAuto = inWindow ? fresh.length - freshHas : 0;
    const auto = freshAuto + relinked;
    const uncovered = stays.uncovered - relinked + fresh.length - freshHas - freshAuto;
    const action = generateAction({ others: now.others, orphans: now.orphans ?? 0, covered: stays.covered + freshHas + auto, uncovered, unbased: 0 });
    candidates.existing += stays.covered + freshHas;
    candidates.auto += auto;
    line.newCandidates += auto;
    if (action === 'generate') {
      line.newCandidates += uncovered;
      candidates.manual += uncovered;
    } else if (action === 'others' && !now.others) {
      // 예전 시연 규정에만 막힘 — 그 규정을 화면에서 지우면 풀린다. 다른 규정에도 닿으면 지워도 막혀 '다른 규정'으로 센다(8차 #1·#2)
      line.orphanBlocked += uncovered;
      candidates.orphanBlocked += uncovered;
      // 일부 시연 조문에 이미 이 변경의 후보가 있으면 지운 뒤에도 '일부 조문에만'으로 막힌다 — 지운 뒤 --reset(9차 #4)
      if (stays.covered + freshHas + auto > 0) candidates.orphanReset = true;
    } else if (action === 'others') {
      line.blocked += uncovered;
      candidates.blocked += uncovered;
    } else if (action === 'partial') {
      line.partial += uncovered;
      candidates.partial += uncovered;
    }
    lines.set(key, line);
  }

  const eventLines = [...lines.values()]
    .map((l) => ({ ...l, events: l.events.size, rows: [...l.rows] }))
    .sort((a, b) => String(b.lawEffectiveDate ?? '').localeCompare(String(a.lawEffectiveDate ?? '')) || a.law.localeCompare(b.law));
  const hasReview = kept.some((p) => p.candidates.some((c) => c.reviewState === 'review'));
  const pendingNow = kept.reduce((n, p) => n + p.candidates.filter((c) => c.reviewState === 'draft' || c.reviewState === 'review').length, 0);
  const candidatesNow = kept.reduce((n, p) => n + p.candidates.length, 0);
  // 후보가 있거나 이번에 생길 인용 법령을 빼고 까닭별로 — 실행 결과와 같은 함수·같은 입력(인용 전부, 5차 #1). 법령 id 로, 없으면 이름으로
  const keptCandidates = kept.flatMap((p) => p.candidates);
  const candLawIds = new Set(keptCandidates.map((c) => c.lawId).filter(Boolean));
  const candLawNames = new Set(keptCandidates.map((c) => normalizeLawName(c.lawName ?? '')).filter(Boolean));
  const newLaws = new Set(eventLines.filter((l) => l.newCandidates > 0).map((l) => normalizeLawName(l.law)));
  const lawGroups = lawsWithoutCandidates(s.lawState, {
    hasCandidate: (l) => Boolean(l.registered && candLawIds.has(l.registered.id)) || candLawNames.has(l.norm) || newLaws.has(l.norm),
    reached: lawsReached(s.cites, (norm) => lawOf.get(norm)?.events),
    registeredNow: new Set(lawsToRegister.map((l) => normalizeLawName(l.name))),
  });
  return {
    reset,
    conflicts,
    conflictWhy,
    orphans: s.orphans ?? [],
    lawGroups,
    toDelete,
    toImport,
    kept: kept.map((k) => k.code),
    dateFills,
    slots: s.slots,
    slotShort,
    lawgokr: s.lawgokr,
    lawsToRegister,
    lawsMissing,
    links,
    eventLines,
    candidates,
    pendingNow,
    candidatesNow,
    willRequestReview: !hasReview,
    cappedLaws: s.lawState.filter((l) => l.eventsCapped).map((l) => l.name),
  };
}
