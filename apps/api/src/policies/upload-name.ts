import { extname } from 'path';

/**
 * 첨부파일 이름 다루기 (T-90).
 *
 * 두 가지가 어긋나 있었다.
 *
 * 1. **한글 파일명이 깨졌다.** multipart 헤더의 파일명을 busboy 가 latin1 로
 *    읽어 놓아서 `취업규칙.pdf` 가 `ì·¨ìê·ì¹.pdf` 로 들어왔다.
 * 2. **원래 이름이 아예 저장되지 않았다.** 디스크 이름은 `{시각}-{난수}{확장자}`
 *    였는데 목록 API 는 `^\d+-\d+-` 를 벗겨 원래 이름을 얻으려 했다. 그 형식이
 *    아니니 아무것도 벗겨지지 않고 `1788213942878-919001.pdf` 가 그대로 이름이
 *    됐다. 업로드 직후에는 응답이 진짜 이름을 주니 화면에는 맞게 보이고,
 *    **새로고침하면 바뀐다** — 그래서 오래 눈에 띄지 않았다.
 *
 * 삭제 버튼을 붙이려면 이걸 먼저 고쳐야 한다. `1788213942878-919001.pdf` 옆의
 * 삭제 버튼은 어느 파일을 지우는지 알 수 없는 함정이다.
 *
 * 원래 이름은 **디스크 이름 안에 base64url 로 실어** 둔다. 별도 테이블 없이
 * 해결되고, T-41 이 세운 저장명 규칙(`[A-Za-z0-9._-]` 만 허용)도 그대로 지킨다 —
 * 한글을 파일명에 직접 쓰면 그 방어를 풀어야 한다.
 * 제대로 된 자리는 첨부 메타데이터 테이블이다(기술부채 #14).
 */

/** 저장명 전체 길이 상한(파일 시스템 한계 255에서 여유를 둔다) */
const MAX_STORED = 200;
const MAX_EXT = 16;

/**
 * multipart 헤더에서 온 파일명을 원래 글자로 되돌린다.
 * 이미 올바른 UTF-8 이면 그대로 둔다.
 */
export function decodeMultipartFilename(raw: string): string {
  const name = String(raw ?? '');
  if (!name) return '';

  // 0xFF 를 넘는 글자가 하나라도 있으면 latin1 바이트열일 수 없다 — 이미 제대로
  // 읽힌 이름이다. 이 확인을 빠뜨리면 한글 이름이 **조용히 망가진다**:
  // `Buffer.from(str, 'latin1')` 은 글자 코드의 하위 바이트만 취하므로
  // `가`(U+AC00)는 0x00 이 되고, NUL 이 늘어선 문자열은 유효한 UTF-8 이라
  // "복원 성공"으로 보인다(테스트로 잡은 실제 사고다).
  for (let i = 0; i < name.length; i += 1) {
    if (name.charCodeAt(i) > 0xff) return name;
  }

  try {
    // 엄격 모드로 읽어 실패하면 원래부터 latin1 이름이었다는 뜻이다(예: `café.pdf`).
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
  } catch {
    return name;
  }
}

/** 경로·구분자로 오해될 것을 떼어 낸 마지막 이름 조각 */
function baseName(name: string): string {
  return name.split(/[\\/]/).pop() ?? '';
}

/** 디스크에 쓸 이름. `{시각}-{난수}-{base64url(원래이름)}{확장자}` */
export function buildStoredName(originalName: string, now = Date.now(), rand?: number): string {
  const original = baseName(decodeMultipartFilename(originalName)).trim() || 'file';
  const prefix = `${now}-${rand ?? Math.round(Math.random() * 1e6)}-`;
  const ext = extname(original).slice(0, MAX_EXT).replace(/[^A-Za-z0-9.]/g, '');

  // 남는 자리에 맞춰 원래 이름을 줄인다. base64 는 3바이트가 4글자가 되므로
  // 넣을 수 있는 바이트 수를 먼저 구하고 그만큼만 자른다(글자 중간에서 자르지 않는다).
  const budget = Math.max(8, MAX_STORED - prefix.length - ext.length);
  const maxBytes = Math.floor(budget / 4) * 3;
  const encoded = Buffer.from(truncateUtf8(original, maxBytes)).toString('base64url');
  return `${prefix}${encoded}${ext}`;
}

/** 바이트 상한에 맞춰 자르되 글자 중간에서 끊지 않는다 */
function truncateUtf8(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= maxBytes) return value;
  let cut = maxBytes;
  // UTF-8 이어지는 바이트(10xxxxxx)를 만나면 글자 시작까지 물러난다
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return buf.subarray(0, cut).toString('utf8');
}

/**
 * 저장명에서 원래 이름을 되찾는다.
 * 형식이 아니거나 옛 파일이면 저장명을 그대로 돌려준다 — 이름이 없는 것보다 낫다.
 */
export function originalNameFromStored(storedName: string): string {
  const stored = baseName(String(storedName ?? ''));
  const m = /^\d+-\d+-([A-Za-z0-9_-]+)(\.[A-Za-z0-9.]*)?$/.exec(stored);
  if (!m) return stored;
  const decoded = Buffer.from(m[1], 'base64url').toString('utf8');
  // 되감아 같은 값이 나와야 진짜 우리가 실어 둔 이름이다(깨진 디코딩을 걸러낸다).
  if (!decoded || Buffer.from(decoded, 'utf8').toString('base64url') !== m[1]) return stored;
  return decoded;
}
