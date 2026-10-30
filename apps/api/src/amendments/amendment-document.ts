import { formatArticleLabel } from '../common/article-label';
import { diffCandidate, type CandidateDiffPart } from './amendment-diff';

/**
 * 개정안 문서(T-162, SRS LAW-22) — 같은 규정의 개정 후보를 신구조문대비표(현행·개정안·비고)·개정 이유·법령 근거
 * 한 문서로 조립한다. 이사회·노사협의회 안건 자료, 취업규칙 변경 신고의 변경 전후 비교 서류로 쓴다.
 *
 * 서버가 DB 에서 조립한다 — 클라이언트가 보낸 HTML 로 만들면 문서의 본문·근거와 감사 기록이 갈라질 수 있다.
 * 바뀐 곳은 밑줄로 그린다(대비표 관례): 현행 칸은 없어지는 글자, 개정안 칸은 새로 들어가는 글자.
 * 개정 이유는 사실만 적는다 — 법령명·조항·공포일·시행일과 바꾸는 조문. '개정이 필요하다'는 판단은 넣지 않는다(LAW-21).
 */

export type DocState = 'draft' | 'review' | 'approved';

export interface DocCandidate {
  id: string;
  reviewState: DocState;
  revision: number;
  baseContent: string;
  candidateContent: string;
  plannedEffectiveDate: string | null;
  /** 승인으로 발행된 버전의 사내 시행일 — 있으면 계획 시행일 대신 적는다 */
  issuedEffectiveDate?: string | null;
  article: { number: number; branchNumber: number | null; clauseNumber: number | null; itemNumber: number | null; title: string | null };
  law: {
    eventId: string;
    lawName: string;
    label: string;
    changeType: 'created' | 'modified' | 'deleted';
    promulgatedDate: string | null;
    lawEffectiveDate: string | null;
    /** 법령 종류와 공포번호(T-151 판 기록) — 있으면 "법률 제21700호" */
    lawType: string | null;
    promulgationNo: string | null;
    beforeContent: string | null;
    afterContent: string | null;
  };
  /** 승인 때 사람이 남긴 개정 사유(발행 버전의 changeNote) — 승인된 후보에만 있다 */
  approvedNote: string | null;
}

export interface DocInput {
  policy: { code: string; title: string };
  candidates: DocCandidate[];
  /** 문서를 만든 날(YYYY-MM-DD) */
  today: string;
}

const STATE_LABEL: Record<DocState, string> = { draft: '작성 중', review: '검토 중', approved: '승인' };
const CHANGE_LABEL: Record<DocCandidate['law']['changeType'], string> = { created: '신설', modified: '개정', deleted: '삭제' };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 2026-05-26 → "2026. 5. 26." (법령 문서의 날짜 표기) */
export function koreanDate(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : iso;
}

const text = (s: string) => escapeHtml(s).replace(/\r?\n/g, '<br>');

/** 한 칸의 본문 — `mark` 쪽(현행은 delete, 개정안은 insert) 글자에만 밑줄. 반대쪽 글자는 그 칸에 없다 */
export function markedSide(parts: CandidateDiffPart[], mark: 'delete' | 'insert'): string {
  return parts
    .filter((p) => p.op === 'equal' || p.op === mark)
    .map((p) => (p.op === mark && p.text.trim() ? `<u>${text(p.text)}</u>` : text(p.text)))
    .join('');
}

function comparePair(before: string, after: string) {
  const { parts } = diffCandidate(before, after);
  return {
    before: before.trim() ? markedSide(parts, 'delete') : '<span class="amend-muted">&lt;신 설&gt;</span>',
    after: after.trim() ? markedSide(parts, 'insert') : '<span class="amend-muted">&lt;삭 제&gt;</span>',
  };
}

const articleHeading = (c: DocCandidate) =>
  formatArticleLabel(c.article) + (c.article.title ? `(${c.article.title})` : '');

function promulgation(law: DocCandidate['law']): string {
  const no = law.lawType && law.promulgationNo ? `${law.lawType} 제${law.promulgationNo}호` : '';
  return [no, law.promulgatedDate && `${koreanDate(law.promulgatedDate)} 공포`, law.lawEffectiveDate && `${koreanDate(law.lawEffectiveDate)} 시행`]
    .filter(Boolean)
    .join(', ');
}

/** 사실만 담은 개정 이유 한 줄 — "「법」 조항 개정(법률 제N호, 공포, 시행)에 따라 제N조를 바꿈" */
export function reasonSentence(c: DocCandidate): string {
  const p = promulgation(c.law);
  const verb = c.candidateContent.trim() ? '바꿈' : '삭제함';
  const label = formatArticleLabel(c.article);
  return `「${c.law.lawName}」 ${c.law.label} ${CHANGE_LABEL[c.law.changeType]}${p ? `(${p})` : ''}에 따라 ${label}${objectParticle(label)} ${verb}`;
}

/**
 * 목적격 조사 — 읽을 때 받침이 있으면 '을'. 조(받침 없음)는 '를', 항·목은 '을', 가지번호로 끝나면 숫자를 읽는 소리로
 * (제3조의2 → '이' 를, 제3조의3 → '삼' 을, 10·100·1000 → 십·백·천 을)
 */
export function objectParticle(label: string): string {
  const digits = /(\d+)$/.exec(label)?.[1];
  if (digits) {
    const last = digits.replace(/0+$/, '');
    // 0 으로 끝나면 십·백·천…(모두 받침) — 끝 자리 숫자 소리: 일·삼·육·칠·팔은 받침, 이·사·오·구는 없음
    if (last.length < digits.length) return '을';
    return '13678'.includes(last[last.length - 1]) ? '을' : '를';
  }
  return /[항목]$/.test(label) ? '을' : '를';
}

function noteCell(c: DocCandidate): string {
  return [
    `「${escapeHtml(c.law.lawName)}」 ${escapeHtml(c.law.label)} ${CHANGE_LABEL[c.law.changeType]}`,
    c.law.lawEffectiveDate && `법령 시행 ${koreanDate(c.law.lawEffectiveDate)}`,
    c.issuedEffectiveDate
      ? `사내 시행 ${koreanDate(c.issuedEffectiveDate)}`
      : c.plannedEffectiveDate && `사내 시행 예정 ${koreanDate(c.plannedEffectiveDate)}`,
    `${STATE_LABEL[c.reviewState]} (${c.revision}판)`,
  ]
    .filter(Boolean)
    .join('<br>');
}

/** 조 → 가지 → 항 → 목 순서(규정 화면과 같은 차례) */
function byArticle(a: DocCandidate, b: DocCandidate): number {
  const key = (c: DocCandidate) => [c.article.number, c.article.branchNumber ?? 0, c.article.clauseNumber ?? 0, c.article.itemNumber ?? 0];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return a.id.localeCompare(b.id);
}

export function buildAmendmentDocument(input: DocInput) {
  const rows = [...input.candidates].sort(byArticle);
  const count = (s: DocState) => rows.filter((c) => c.reviewState === s).length;

  const reasons = rows
    .map((c) => {
      const note = c.approvedNote?.trim() ? `<br><span class="amend-muted">승인 사유: ${text(c.approvedNote.trim())}</span>` : '';
      return `<li>${escapeHtml(reasonSentence(c))}${note}</li>`;
    })
    .join('');

  const table = rows
    .map((c) => {
      const pair = comparePair(c.baseContent, c.candidateContent);
      const head = `<b>${escapeHtml(articleHeading(c))}</b><br>`;
      return `<tr><td>${head}${pair.before}</td><td>${head}${pair.after}</td><td class="amend-note">${noteCell(c)}</td></tr>`;
    })
    .join('');

  const events = new Map<string, DocCandidate['law']>();
  for (const c of rows) if (!events.has(c.law.eventId)) events.set(c.law.eventId, c.law);
  const basis = [...events.values()]
    .map((law) => {
      const pair = comparePair(law.beforeContent ?? '', law.afterContent ?? '');
      const p = promulgation(law);
      return (
        `<h3>「${escapeHtml(law.lawName)}」 ${escapeHtml(law.label)} ${CHANGE_LABEL[law.changeType]}${p ? ` (${escapeHtml(p)})` : ''}</h3>` +
        `<table class="amend"><thead><tr><th class="amend-half">변경 전</th><th class="amend-half">변경 후</th></tr></thead>` +
        `<tbody><tr><td>${pair.before}</td><td>${pair.after}</td></tr></tbody></table>`
      );
    })
    .join('');

  const html =
    `<h2>1. 개정 이유</h2><ul class="amend-reasons">${reasons}</ul>` +
    `<h2>2. 신구조문대비표</h2>` +
    `<table class="amend"><thead><tr><th class="amend-text">현행</th><th class="amend-text">개정안</th><th class="amend-note">비고</th></tr></thead>` +
    `<tbody>${table}</tbody></table>` +
    `<h2>3. 법령 근거</h2>${basis}`;

  const states = (['approved', 'review', 'draft'] as const)
    .filter((s) => count(s))
    .map((s) => `${STATE_LABEL[s]} ${count(s)}`)
    .join(' · ');
  const unsettled = rows.length - count('approved');
  return {
    title: escapeHtml(`${input.policy.title} 개정안`),
    metaLine: escapeHtml(`규정 코드 ${input.policy.code} · 작성일 ${koreanDate(input.today)} · 개정 조문 ${rows.length}개 (${states})`),
    html,
    footerText: escapeHtml(
      'VEDA에서 만든 개정안 문서입니다. 밑줄은 바뀌는 곳입니다.' +
        (unsettled ? ` 승인되지 않은 조문 ${unsettled}개(작성 중·검토 중)는 확정된 개정이 아닙니다.` : ''),
    ),
  };
}
