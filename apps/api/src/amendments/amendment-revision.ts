import { createHash } from 'crypto';

/**
 * 개정 후보의 판(T-107) — DB 없는 도우미.
 */

/** 본문 SHA-256(hex, UTF-8). 마이그레이션 보정(`encode(sha256(convert_to(…,'UTF8')),'hex')`)과 같은 형식 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}

/**
 * 공백을 빼고도 제1 조문과 다른가. 공백만 바꾼 본문은 개정이 아니다 — 검토 요청 때 "개정 불필요"
 * 판단인지 가르고(이유를 받는다), 승인(T-108)은 이것이 참일 때만 된다.
 */
export function hasSubstantiveChange(base: string, content: string): boolean {
  const squash = (s: string) => (s ?? '').replace(/\s+/g, '');
  return squash(base) !== squash(content);
}
