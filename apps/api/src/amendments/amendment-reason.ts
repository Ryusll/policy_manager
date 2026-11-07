import { formatArticleLabel } from '../common/article-label';
import { toDateOnlyString } from '../common/date-only';
import { labelFromNodeKey } from '../laws/law-rows';
import { adjustParticle } from './amendment-rules';

/**
 * 개정 이유의 법령 인용 조각(T-161, SRS LAW-21) — 개정안 문서(T-162)의 개정 이유와 승인 화면의 개정 이유 초안(amendment-reason-draft)이
 * 같이 쓴다: 「법령 정식 제명」 조항 개정(법률 제N호, 공포일, 시행일)에 따라 …. '개정이 필요하다' 같은 판단은 넣지 않는다.
 */

export type ReasonLaw = {
  lawName: string;
  label: string;
  changeType: 'created' | 'modified' | 'deleted';
  promulgatedDate: string | null;
  lawEffectiveDate: string | null;
  /** 법령 종류와 공포번호(T-151 판 기록) — 있으면 "법률 제21700호" */
  lawType: string | null;
  promulgationNo: string | null;
};
export type ReasonArticle = { number: number; branchNumber: number | null; clauseNumber: number | null; itemNumber: number | null; title: string | null };

export const CHANGE_LABEL: Record<ReasonLaw['changeType'], string> = { created: '신설', modified: '개정', deleted: '삭제' };

/** 2026-05-26 → "2026. 5. 26." (법령 문서의 날짜 표기) */
export function koreanDate(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : iso;
}

/** "법률 제21700호, 2026. 5. 26. 공포, 2026. 11. 27. 시행" — 빈 칸은 뺀다(판 기록이 없는 옛 변경은 번호 없이) */
export function promulgation(law: Pick<ReasonLaw, 'lawType' | 'promulgationNo' | 'promulgatedDate' | 'lawEffectiveDate'>): string {
  const no = law.lawType && law.promulgationNo ? `${law.lawType} 제${law.promulgationNo}호` : '';
  return [no, law.promulgatedDate && `${koreanDate(law.promulgatedDate)} 공포`, law.lawEffectiveDate && `${koreanDate(law.lawEffectiveDate)} 시행`]
    .filter(Boolean)
    .join(', ');
}

/** 법령 인용 — "「법」 조항 개정(법률 제N호, 공포, 시행)". 시행일은 개정법의 시행일이다(인용 관례) */
export function lawCitation(law: ReasonLaw): string {
  const p = promulgation(law);
  return `「${law.lawName}」 ${law.label} ${CHANGE_LABEL[law.changeType]}${p ? `(${p})` : ''}`;
}

/** 문장 앞부분 — "「법」 조항 개정(…)에 따라" */
export function lawBasis(law: ReasonLaw): string {
  return `${lawCitation(law)}에 따라`;
}

/** 법 개정 때문에 바뀐 곳이 없을 때의 앞부분 — "「법」 조항 개정(…)을 계기로"(원인이 아니라 계기만 적는다) */
export function lawOccasion(law: ReasonLaw): string {
  const label = CHANGE_LABEL[law.changeType];
  return `${lawCitation(law)}${adjustParticle(label, '을') ?? '을'} 계기로`;
}

/**
 * 조문 표기 뒤 목적격 조사 — 읽을 때 받침이 있으면 '을'. 조(받침 없음)는 '를', 항·목은 '을', 가지번호로 끝나면 숫자를 읽는 소리로
 * (제3조의2 → '이' 를, 제3조의3 → '삼' 을, 10·100·1000 → 십·백·천 을). 제목 괄호가 붙어도 조사는 괄호 앞 표기를 따른다
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

/** "제12조(난임치료휴가)" — 조문 표기와 제목 */
export const articleHeading = (a: ReasonArticle) => formatArticleLabel(a) + (a.title ? `(${a.title})` : '');

/** 조문 단위 문장 — "…에 따라 제12조를 바꿈"(조문을 지우면 "삭제함"). 개정안 문서의 개정 이유이고, 변경 정보가 없을 때의 초안이다 */
export function articleSentence(law: ReasonLaw, article: ReasonArticle, deleted: boolean): string {
  const label = formatArticleLabel(article);
  return `${lawBasis(law)} ${label}${objectParticle(label)} ${deleted ? '삭제함' : '바꿈'}`;
}

type EventRow = {
  law: { lawName: string };
  lawArticle: { label: string } | null;
  nodeKey: string;
  changeType: ReasonLaw['changeType'];
  promulgatedDate: Date | null;
  lawEffectiveDate: Date | null;
  lawVersion: { lawType: string | null; promulgationNo: string | null } | null;
};

/** 변경 이벤트 행 → 문장의 법령 칸. 상세 조회·승인·개정안 문서가 같은 변환을 쓴다(그래야 승인 때 다시 만든 초안이 화면의 것과 같다) */
export function reasonLawOf(e: EventRow): ReasonLaw {
  const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);
  return {
    lawName: e.law.lawName,
    label: e.lawArticle?.label ?? labelFromNodeKey(e.nodeKey),
    changeType: e.changeType,
    promulgatedDate: day(e.promulgatedDate),
    lawEffectiveDate: day(e.lawEffectiveDate),
    lawType: e.lawVersion?.lawType ?? null,
    promulgationNo: e.lawVersion?.promulgationNo ?? null,
  };
}
