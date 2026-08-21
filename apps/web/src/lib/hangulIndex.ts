/**
 * 사전식(가나다) 색인 (T-77).
 *
 * 규정명 첫 글자의 **초성**으로 묶는다. 국가법령정보센터의 법령 색인과 같은 방식이다.
 * 쌍자음은 기본 자음에 합친다(ㄲ→ㄱ) — 사전 배열이 그렇고, 나누면 ㄲ 칸이 거의 비어 있어
 * 훑어보는 데 방해만 된다.
 */

/** 유니코드 한글 음절의 초성 19자 (합치기 전) */
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/** 쌍자음 → 기본 자음 */
const FOLD: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

/** 색인 막대에 세우는 순서 */
export const INDEX_KEYS = [
  'ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
  'A-Z', '#',
] as const;

export type IndexKey = (typeof INDEX_KEYS)[number];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/**
 * 한 글자의 색인 키.
 * - 한글 음절 → 초성(쌍자음은 기본 자음으로)
 * - 낱자 자음(ㄱ, ㄴ …) → 그대로
 * - 영문 → 'A-Z'
 * - 그 밖(숫자·기호·한자 등) → '#'
 */
export function indexKeyOfChar(ch: string): IndexKey {
  if (!ch) return '#';
  const code = ch.charCodeAt(0);

  if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
    const initial = CHOSEONG[Math.floor((code - HANGUL_BASE) / 588)];
    return (FOLD[initial] ?? initial) as IndexKey;
  }
  // 낱자로 쓴 자음 (ㄱ ~ ㅎ)
  if (code >= 0x3131 && code <= 0x314e) {
    const folded = FOLD[ch] ?? ch;
    return (INDEX_KEYS as readonly string[]).includes(folded) ? (folded as IndexKey) : '#';
  }
  if (/[A-Za-z]/.test(ch)) return 'A-Z';
  return '#';
}

/** 규정명의 색인 키. 앞쪽 공백·따옴표 등은 건너뛰고 첫 의미 글자를 본다. */
export function indexKeyOf(title: string): IndexKey {
  const trimmed = (title || '').replace(/^[\s"'«‹「『(\[{<]+/, '');
  return indexKeyOfChar(trimmed.charAt(0));
}

/** 색인 키별 개수. 막대에서 비어 있는 칸을 흐리게 만들 때 쓴다. */
export function countByIndexKey<T>(items: T[], getTitle: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of INDEX_KEYS) out[key] = 0;
  for (const item of items) out[indexKeyOf(getTitle(item))] += 1;
  return out;
}

/** 가나다 정렬 (한국어 로케일). 같은 이름이면 안정적으로 두 번째 키를 본다. */
export function compareKo(a: string, b: string): number {
  return (a || '').localeCompare(b || '', 'ko');
}
