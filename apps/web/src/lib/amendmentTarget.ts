import { formatArticleAnchor, type AnchorTarget } from './articleAnchor';
import { articlePositionLabel } from './articleHeading';

/**
 * 개정 후보가 가리키는 조문 — 후보 상세 머리와 상단 경로 표시가 이 함수 하나로 같은 표기를 쓴다(T-214, C-109 에서 남긴 것).
 * 조면 `취업규칙 제3조(목적)`, 항·목이면 `취업규칙 제3조제2항(부제)` — 조문 표기는 T-211 의 `articlePositionLabel`.
 */
export function amendmentTargetLabel(policyTitle: string, article: AnchorTarget & { title?: string | null }): string {
  return `${policyTitle} ${articlePositionLabel(article, article.title, formatArticleAnchor(article))}`;
}
