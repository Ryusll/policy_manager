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

/** 폐지 시행일(`repealedOn`)은 필수 필드다 — 조회에서 빠뜨리면 지문이 조용히 달라져 후보가 모두 낡아 보인다 */
export type HistoryVersion = {
  id: string;
  status: string;
  effectiveDate: Date | null;
  versionNum: number;
  repealedOn: Date | null;
};

/**
 * 조문의 발행 이력 지문(T-108) — 시행본·내려간 버전(published·archived)의 id·상태·시행일·버전 번호,
 * 그리고 폐지한 버전이면 폐지 시행일(T-126).
 *
 * 후보를 만들 때 고정하고 승인 때 다시 계산한다. 다르면 그 사이 이 조문에 다른 발행·폐지·시행일 보정이
 * 있었다는 뜻이다 — 기준 본문 id 가 같아도(예: 기준본보다 이른 시행일로 다른 버전을 발행) 잡는다.
 * 마이그레이션 보정 SQL 과 **같은 계산**이다: 줄 `id|상태|YYYY-MM-DD|번호`, id 바이트 순서, 줄바꿈 이음, 접두어 `fp1:`.
 * 폐지 시행일은 있을 때만 줄 끝에 `|YYYY-MM-DD` 로 붙인다 — 폐지가 없는 조문의 지문은 T-108 때와 같아서
 * 저장된 지문을 고쳐 쓰지 않는다. 기존 폐지를 보정한 조문의 후보만 "이력이 바뀜"으로 낡는다(그 폐지를
 * 모르고 만든 후보다).
 */
export function historyFingerprint(versions: HistoryVersion[]): string {
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
  const lines = versions
    .filter((v) => v.status === 'published' || v.status === 'archived')
    .map((v) => `${v.id}|${v.status}|${day(v.effectiveDate)}|${v.versionNum}${v.repealedOn ? `|${day(v.repealedOn)}` : ''}`)
    // id 는 ASCII(uuid)라 문자열 정렬이 바이트 순서(SQL 의 COLLATE "C")와 같다
    .sort();
  return `fp1:${createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')}`;
}
