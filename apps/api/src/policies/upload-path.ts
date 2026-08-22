import { resolve, sep } from 'path';

/**
 * 규정 첨부파일 경로 조립 (T-41).
 *
 * 예전에는 컨트롤러가 `join('/app/uploads', tenantId, id, filename)` 을 그대로 썼다.
 * `id` 와 `filename` 은 URL 경로 조각이고, Express 는 라우트를 **인코딩된 상태로** 맞춘
 * 뒤 값을 `decodeURIComponent` 로 푼다. 그래서 `..%2F..%2F..%2Fetc` 는 `:id` 하나에
 * 멀쩡히 매칭되고, 풀린 뒤에는 `../../../etc` 가 되어 `join` 이 경로를 정규화해 준다.
 * 결과적으로 로그인만 하면 API 컨테이너의 **아무 파일이나 읽고 지울 수 있었다**
 * (`GET /policies/..%2F..%2F..%2Fetc/files/hostname` → `/etc/hostname`).
 *
 * 테넌트 경계가 디렉터리 이름 하나에만 걸려 있으므로, 경로 탈출은 곧 테넌트 격리 붕괴다.
 * 그래서 조각을 검사하는 것과 **조립 결과가 루트 안인지 확인하는 것**을 둘 다 한다.
 * 앞의 검사만으로 충분해 보여도, 새 호출부가 생겼을 때 마지막 방어선이 남아야 한다.
 */

export const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/app/uploads';

/** 테넌트·규정 식별자는 항상 UUID다. 이 검사 하나로 경로 조각이 될 수 있는 값이 사라진다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 저장 파일명은 우리가 `Date.now()-난수.확장자` 로 만든다. 사용자가 올린 원본 이름은
 * 쓰지 않으므로, 영숫자·점·밑줄·붙임표 밖의 글자는 우리가 만든 적 없는 이름이다.
 */
const STORED_NAME_RE = /^[A-Za-z0-9._-]{1,255}$/;

export class UnsafeUploadPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUploadPathError';
  }
}

function assertId(label: string, value: string) {
  if (!UUID_RE.test(String(value ?? ''))) {
    throw new UnsafeUploadPathError(`${label}가 올바른 식별자가 아닙니다.`);
  }
}

/** 조립 결과가 루트 밖으로 나가지 않았는지 본다 — 조각 검사를 통과한 뒤의 마지막 확인. */
function assertInsideRoot(path: string) {
  const root = resolve(UPLOAD_ROOT);
  if (path !== root && !path.startsWith(root + sep)) {
    throw new UnsafeUploadPathError('허용되지 않은 파일 경로입니다.');
  }
}

/** 규정 하나의 첨부 디렉터리 */
export function policyUploadDir(tenantId: string, policyId: string): string {
  assertId('테넌트', tenantId);
  assertId('규정', policyId);
  const dir = resolve(UPLOAD_ROOT, tenantId, policyId);
  assertInsideRoot(dir);
  return dir;
}

/** 규정 첨부파일 하나의 전체 경로 */
export function policyUploadFilePath(
  tenantId: string,
  policyId: string,
  filename: string,
): string {
  const dir = policyUploadDir(tenantId, policyId);
  const name = String(filename ?? '');
  if (!STORED_NAME_RE.test(name) || name === '.' || name === '..') {
    throw new UnsafeUploadPathError('허용되지 않은 파일명입니다.');
  }
  const path = resolve(dir, name);
  // 규정 디렉터리 바로 아래인지 본다 — 이름 검사를 통과했어도 조립 결과로 다시 확인한다.
  if (!path.startsWith(dir + sep)) {
    throw new UnsafeUploadPathError('허용되지 않은 파일 경로입니다.');
  }
  assertInsideRoot(path);
  return path;
}
