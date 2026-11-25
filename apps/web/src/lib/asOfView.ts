import type { AsOfRepealedArticle } from '../api/policies';

/** 시점 조회 응답의 머리(T-126·T-180) — 서버가 받은 날짜 문자열을 그대로 돌려준다 */
export type AsOfInfo = {
  date: string;
  omittedArticles: number;
  repealedArticles: AsOfRepealedArticle[];
  hasEffectiveDates: boolean;
};

/**
 * 시점 조회 화면 상태(T-180, PAT-22). 고른 날짜의 응답을 받은 뒤에만 그 날짜 본문을 그린다 — 받는 중이거나 실패면 현행 본문으로 대신하지
 * 않고(`viewPolicy` 없음) 본문·전체화면·인쇄·내보내기를 막는다(`blocked`). 라벨·파일명·머리말의 날짜는 요청한 날짜가 아니라 응답의 날짜.
 * 날짜를 바꾸면 앞 날짜 응답이 남아 있어도 그 날짜가 아니라 막힌다. 다시 받는 중(재시도)은 실패로 치지 않는다.
 */
export function asOfViewState<P extends { current?: { date?: string | null } | null }>(input: {
  asOfDate: string;
  policy: P | undefined;
  asOfPolicy: (P & { asOf?: AsOfInfo }) | undefined;
  isError: boolean;
  isFetching: boolean;
  /** 현행 본문 머리말의 날짜 — 응답에 current.date 가 없을 때 */
  today: string;
}) {
  const { asOfDate, policy, asOfPolicy, isError, isFetching, today } = input;
  const info = asOfDate && asOfPolicy?.asOf?.date === asOfDate ? asOfPolicy.asOf : null;
  const blocked = !!asOfDate && !info;
  return {
    info,
    blocked,
    failed: blocked && isError && !isFetching,
    viewPolicy: asOfDate ? (info ? asOfPolicy : undefined) : policy,
    /** 인쇄·PDF·한/글·TXT 머리말 — 문서 본문이라 한국어 그대로 */
    basisLine: info ? `기준일: ${info.date} 시점 본문` : `기준일: ${policy?.current?.date ?? today} 현행 본문`,
  };
}
