import { looseText, normalizeText, positionLabel } from './reparse-match';
import type { StructureProposal, StructureSnapshot } from '../common/article-structure';

/**
 * 재파싱 반영 계획 — DB 없는 계산 (T-110 ②, 특허 청구항 2·도 6 S650~S652).
 *
 * 반영은 **검토 대상 만들기**다. 지금 계층·본문은 바꾸지 않는다:
 * - 기존 조문의 개정·이동·조 제목 변경 → 그 조문의 초안(본문 + 제안 계층). 이동만이면 본문은 비교 대상 버전 그대로
 * - 장·절의 번호·제목이 바뀌면 그 장·절의 시행 중인 조문은 모두 계층이 바뀐다 → 이미 초안이 없는 조문에 계층만 바꾸는 초안
 *   (새 계층은 승인한 시행일부터 — 그래야 그 전 날짜의 조회가 옛 장 번호로 나온다)
 * - 새 조문·새 장·절은 **행을 만들지 않고** 계획에만 둔다(승인 때 만든다) — 승인 전 행이 화면·조회에 새지 않는다
 * - 새 조문으로 돌린 짝의 기존 조문은 원문에 없음(삭제 여부 미결)으로 남는다
 * - 원문에 없음의 폐지 결정은 승인 때(시행일이 오늘 이전이면 그 날로)
 * 변경할 조문에 묶음이 아닌 초안·검토 중 버전이 남아 있으면 반영하지 않는다(그 항목을 보류로 두거나 먼저 정리).
 */

type Place = { number: number; branch: number | null; clause: number | null; item: number | null };
export type ParsedJson = Place & {
  index: number;
  label: string;
  title: string;
  content: string;
  chapter: { index: number; number: number; title: string; hidden: boolean; storedId: string | null } | null;
  section: { index: number; number: number; title: string; storedId: string | null } | null;
};

export type PlanItem = {
  id: string;
  kind: string;
  decision: string | null;
  articleId: string | null;
  targetArticleId: string | null;
  parsed: ParsedJson | null;
  label: string;
};

/** 계획에 필요한 지금 조문 상태 */
export type PlanArticle = {
  id: string;
  live: StructureSnapshot;
  /** 비교 대상 버전(최근 발행본, 발행 이력이 없으면 최신 작업본) */
  base: { versionId: string; status: string; content: string } | null;
  /** 발행 이력이 있고 마지막 발행이 폐지가 아니다 — 시행 중이거나 시행 예정 */
  inForce: boolean;
  repealed: boolean;
  /** 묶음이 아닌 초안·검토 중 버전 */
  pending: { versionId: string; status: string } | null;
};

export type ChapterPlanEntry = { key: string; number: number; title: string; hidden: boolean };
export type SectionPlanEntry = { key: string; chapter: { id: string | null; key: string | null }; number: number; title: string };

export type ApplyPlan = {
  drafts: { itemId: string; articleId: string; content: string; proposal: StructureProposal | null; reason: 'amend' | 'structure' | 'chapter' }[];
  newArticles: {
    itemId: string;
    chapter: { id: string | null; key: string | null };
    section: { id: string | null; key: string | null } | null;
    number: number;
    branchNumber: number | null;
    clauseNumber: number | null;
    itemNumber: number | null;
    title: string;
    content: string;
  }[];
  chapters: { create: ChapterPlanEntry[]; update: { id: string; number: number; title: string; hidden: boolean }[] };
  sections: { create: SectionPlanEntry[]; update: { id: string; number: number; title: string }[] };
  /** 버전이 없는 조 머리 행(본문 없이 제목만, 항으로만 이루어진 조)의 자리·제목 변경 — 이력이 없으니 승인 때 조문 행만 고친다 */
  rowUpdates: { itemId: string; articleId: string; proposal: StructureProposal }[];
  /** 새 조문으로 돌린 짝의 기존 조문 — 그 조문은 원문에 없음 항목(결정 때 만든다)이 맡는다 */
  released: { itemId: string; articleId: string }[];
  /** 폐지로 정한 원문에 없는 조문 */
  repeals: { itemId: string; articleId: string }[];
  /** 반영할 수 없는 항목 — 묶음이 아닌 작업본이 남은 조문 */
  conflicts: { itemId: string; articleId: string; label: string; status: string }[];
  /** 아무것도 하지 않는 항목(그대로·보류·유지) */
  untouched: { itemId: string; why: 'same' | 'hold' | 'keep' | 'undecided' }[];
};

const chapterRef = (p: ParsedJson) =>
  p.chapter?.storedId ? { id: p.chapter.storedId, key: null } : { id: null, key: `c${p.chapter?.index ?? 0}` };
const sectionRef = (p: ParsedJson) =>
  !p.section ? null : p.section.storedId ? { id: p.section.storedId, key: null } : { id: null, key: `c${p.chapter?.index ?? 0}s${p.section.index}` };

/** 재파싱 행이 가리키는 자리 — 지금 계층과 다르면 제안, 같으면 null */
export function proposalFor(p: ParsedJson, live: StructureSnapshot): StructureProposal | null {
  const chapter = chapterRef(p);
  const section = sectionRef(p);
  const same =
    chapter.id === live.chapter.id &&
    (section?.id ?? null) === (live.section?.id ?? null) &&
    !(section && section.key) &&
    p.number === live.number &&
    (p.branch ?? null) === (live.branchNumber ?? null) &&
    (p.clause ?? null) === (live.clauseNumber ?? null) &&
    (p.item ?? null) === (live.itemNumber ?? null) &&
    normalizeText(p.title ?? '') === normalizeText(live.title ?? '');
  if (same) return null;
  return {
    v: 1,
    kind: 'proposal',
    chapter,
    section,
    number: p.number,
    branchNumber: p.branch ?? null,
    clauseNumber: p.clause ?? null,
    itemNumber: p.item ?? null,
    title: p.title ?? '',
    base: live,
  };
}

const sameText = (a: string, b: string) => {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return na === nb || looseText(na) === looseText(nb);
};

export function planApply(
  items: PlanItem[],
  articles: Map<string, PlanArticle>,
  chapters: { id: string; number: number; title: string; hidden: boolean; sections: { id: string; number: number; title: string }[] }[],
  chapterChanges: { parsed: { index: number; number: number; title: string; hidden: boolean } | null; storedId: string | null; change: string }[],
): ApplyPlan {
  const plan: ApplyPlan = {
    drafts: [],
    newArticles: [],
    rowUpdates: [],
    chapters: { create: [], update: [] },
    sections: { create: [], update: [] },
    released: [],
    repeals: [],
    conflicts: [],
    untouched: [],
  };
  const drafted = new Set<string>();
  const usedChapterKeys = new Map<string, ChapterPlanEntry>();
  const usedSectionKeys = new Map<string, SectionPlanEntry>();
  const sectionUpdates = new Map<string, { id: string; number: number; title: string }>();
  const storedSection = new Map(chapters.flatMap((c) => c.sections.map((s) => [s.id, s] as const)));

  const noteTarget = (p: ParsedJson) => {
    if (p.chapter && !p.chapter.storedId) {
      const key = `c${p.chapter.index}`;
      if (!usedChapterKeys.has(key)) usedChapterKeys.set(key, { key, number: p.chapter.number, title: p.chapter.title, hidden: p.chapter.hidden });
    }
    if (p.section) {
      if (p.section.storedId) {
        const s = storedSection.get(p.section.storedId);
        if (s && (s.number !== p.section.number || s.title !== p.section.title)) {
          sectionUpdates.set(s.id, { id: s.id, number: p.section.number, title: p.section.title });
        }
      } else {
        const key = `c${p.chapter?.index ?? 0}s${p.section.index}`;
        if (!usedSectionKeys.has(key)) {
          usedSectionKeys.set(key, { key, chapter: chapterRef(p), number: p.section.number, title: p.section.title });
        }
      }
    }
  };
  const conflict = (item: PlanItem, a: PlanArticle) => {
    if (!a.pending) return false;
    plan.conflicts.push({ itemId: item.id, articleId: a.id, label: item.label, status: a.pending.status });
    return true;
  };
  // 본문은 원문 쪽 — 띄어쓰기만 다른 원문(옮김 등)이면 개정으로 보지 않고 비교 대상 본문 그대로 둔다
  const draftOn = (item: PlanItem, a: PlanArticle, p: ParsedJson) => {
    if (conflict(item, a)) return;
    const proposal = proposalFor(p, a.live);
    // 버전이 없고 원문에도 본문이 없는 조 머리 행 — 초안을 만들 본문이 없다. 자리·제목만 승인 때 바꾼다
    if (!a.base && !normalizeText(p.content)) {
      if (proposal) plan.rowUpdates.push({ itemId: item.id, articleId: a.id, proposal });
      else plan.untouched.push({ itemId: item.id, why: 'same' });
      noteTarget(p);
      return;
    }
    const baseContent = a.base?.content ?? '';
    const content = p.content;
    // 폐지된 조문에 잇는 것은 다시 시행이라 본문·자리가 같아도 초안을 만든다
    const amend = !sameText(content, baseContent) || !a.base || a.repealed;
    if (!amend && !proposal) {
      plan.untouched.push({ itemId: item.id, why: 'same' });
      noteTarget(p);
      return;
    }
    plan.drafts.push({ itemId: item.id, articleId: a.id, content: amend ? content : baseContent, proposal, reason: amend ? 'amend' : 'structure' });
    drafted.add(a.id);
    noteTarget(p);
  };
  const createNew = (item: PlanItem, p: ParsedJson) => {
    plan.newArticles.push({
      itemId: item.id,
      chapter: chapterRef(p),
      section: sectionRef(p),
      number: p.number,
      branchNumber: p.branch ?? null,
      clauseNumber: p.clause ?? null,
      itemNumber: p.item ?? null,
      title: p.title ?? '',
      content: p.content,
    });
    noteTarget(p);
  };

  for (const item of items) {
    const p = item.parsed;
    const d = item.decision;
    if (item.kind === 'missing') {
      if (d === 'repeal' && item.articleId) plan.repeals.push({ itemId: item.id, articleId: item.articleId });
      else plan.untouched.push({ itemId: item.id, why: d === 'keep' ? 'keep' : 'undecided' });
      continue;
    }
    if (!p) continue;
    if (d === 'hold') {
      plan.untouched.push({ itemId: item.id, why: 'hold' });
      continue;
    }
    if (item.kind === 'same') {
      const a = item.articleId ? articles.get(item.articleId) : undefined;
      // 그대로인 조문도 제목 정규화 차이 등으로 제안이 생길 수 있다 — 본문은 그대로
      if (a) draftOn(item, a, p);
      else plan.untouched.push({ itemId: item.id, why: 'same' });
      continue;
    }
    const target =
      d === 'pick' || d === 'link'
        ? item.targetArticleId
        : (item.kind === 'moved' && d === 'accept') || (item.kind === 'changed' && d === 'amend')
          ? item.articleId
          : null;
    if (target) {
      const a = articles.get(target);
      if (!a) continue;
      draftOn(item, a, p);
      continue;
    }
    if (d === 'new') {
      createNew(item, p);
      if ((item.kind === 'moved' || item.kind === 'changed') && item.articleId) {
        plan.released.push({ itemId: item.id, articleId: item.articleId });
      }
    }
  }

  // 장 번호·제목 변경(기존 장) — 승인 때 장 행에. 이 장·절의 시행 중인 조문은 계층만 바꾸는 초안을 받는다
  for (const c of chapterChanges) {
    if (!c.parsed || !c.storedId || c.change === 'same' || c.change === 'new' || c.change === 'missing') continue;
    plan.chapters.update.push({ id: c.storedId, number: c.parsed.number, title: c.parsed.title, hidden: c.parsed.hidden });
  }
  plan.chapters.create = [...usedChapterKeys.values()];
  plan.sections.create = [...usedSectionKeys.values()];
  plan.sections.update = [...sectionUpdates.values()];
  const touchedChapters = new Set(plan.chapters.update.map((c) => c.id));
  const touchedSections = new Set(plan.sections.update.map((s) => s.id));
  // 조문마다 그 초안을 맡을 항목 — 새 조문으로 돌린 짝은 기존 조문을 놓으므로, 그 조문은 원문에 없음 항목이 맡는다
  const itemOf = new Map<string, { id: string; label: string }>();
  for (const item of items) {
    if ((item.kind === 'moved' || item.kind === 'changed') && item.decision === 'new') continue;
    const id = item.kind === 'missing' ? item.articleId : item.decision === 'pick' || item.decision === 'link' ? item.targetArticleId : item.articleId;
    if (!id || itemOf.has(id)) continue;
    itemOf.set(id, { id: item.id, label: item.label });
  }
  const repealed = new Set(plan.repeals.map((r) => r.articleId));
  for (const a of articles.values()) {
    if (drafted.has(a.id) || !a.inForce || repealed.has(a.id)) continue;
    if (!touchedChapters.has(a.live.chapter.id) && !(a.live.section && touchedSections.has(a.live.section.id))) continue;
    // 보류한 항목도 — 본문·자리는 그대로 두지만 장 번호·제목은 장 행에서 바뀌므로 그 날부터의 계층 버전이 필요하다
    const item = itemOf.get(a.id);
    if (!item) continue;
    if (a.pending) {
      plan.conflicts.push({ itemId: item.id, articleId: a.id, label: item.label || positionLabel({ number: a.live.number, branch: a.live.branchNumber, clause: a.live.clauseNumber, item: a.live.itemNumber }), status: a.pending.status });
      continue;
    }
    plan.drafts.push({ itemId: item.id, articleId: a.id, content: a.base?.content ?? '', proposal: null, reason: 'chapter' });
    drafted.add(a.id);
    plan.untouched = plan.untouched.filter((u) => u.itemId !== item.id);
  }
  return plan;
}
