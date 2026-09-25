import { createHash } from 'crypto';

/**
 * 법령조항 본문의 지문(versionKey) — 변경 감지(T-103)의 기준.
 *
 * ★ 정규화 규칙에 버전을 붙이는 이유
 *   지문은 `v<버전>:<sha256>` 형식이다. 규칙을 손대면 같은 본문에서도 해시가 달라지므로,
 *   버전을 올리지 않고 규칙만 바꾸면 다음 폴링에서 **법령 전체가 "개정됨"으로 잡힌다**.
 *   반대로 버전을 올리면 기존 값과 접두어가 달라 재계산이 필요한 행을 SQL 한 줄로
 *   찾을 수 있다(`WHERE version_key NOT LIKE 'v2:%'`). 규칙 변경 = 재계산 마이그레이션이다.
 */
export const LAW_NORMALIZATION_VERSION = 1;

/**
 * 비교를 위한 본문 정규화.
 *
 * 법제처 응답은 같은 조문이라도 정렬용 공백·개행이 수시로 달라진다. 그대로 해시하면
 * 내용이 그대로인데 개정으로 잡힌다. 반대로 너무 깎아내면 실제 개정을 놓치므로,
 * **보이지 않는 차이만** 지운다. 문장부호·괄호·`<개정 2009.2.6>` 같은 표기는 남긴다
 * — 그건 실제 개정에서 바뀌는 내용이다.
 */
export function normalizeLawText(raw: string | null | undefined): string {
  return (
    String(raw ?? '')
      // 한글 자모가 분리된 표기(NFD)와 합쳐진 표기(NFC)는 눈에 같아 보인다
      .normalize('NFC')
      // ZWSP 는 정규식 \s 에 포함되지 않는다. 먼저 공백으로 바꿔 둔다
      .replace(/\u200B/g, ' ')
      // 개행도 공백과 같이 뭉갠다. 법제처는 같은 조문을 줄바꿈만 다르게 보내오는데,
      // 개행을 살려두면 그때마다 지문이 달라져 "개정됨"으로 잡힌다.
      // 원문 줄 구조는 content 컬럼에 그대로 남으므로 잃는 것이 없다.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** 조항 하나의 지문 */
export function lawVersionKey(content: string | null | undefined): string {
  const normalized = normalizeLawText(content);
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `v${LAW_NORMALIZATION_VERSION}:${hash}`;
}

/**
 * 법령 전체의 지문 — 조항 지문을 **문서 순서대로** 이어서 다시 해시한다.
 *
 * 순서를 섞지 않는 이유: 조문이 신설·삭제되면 집합은 같아도 순서가 달라진다.
 * 그 경우도 개정으로 잡혀야 한다.
 */
export function lawAggregateVersionKey(articleVersionKeys: string[]): string {
  const hash = createHash('sha256').update(articleVersionKeys.join('\n'), 'utf8').digest('hex');
  return `v${LAW_NORMALIZATION_VERSION}:${hash}`;
}

/** 지문에서 정규화 규칙 버전만 떼어낸다. 재계산 대상 판별용 */
export function versionKeyRuleVersion(versionKey: string): number | null {
  const m = /^v(\d+):/.exec(versionKey || '');
  return m ? Number(m[1]) : null;
}
