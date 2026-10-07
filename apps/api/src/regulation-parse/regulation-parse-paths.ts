import { join, resolve, sep } from 'path';
import { UPLOAD_ROOT } from '../policies/upload-path';

/**
 * 가져오기용으로 올린 PDF를 규정 등록 전까지 두는 곳.
 * 등록하면 규정 첨부파일(원문 PDF)로 옮기고, 등록하지 않은 세션의 파일은 일주일 뒤 지운다.
 *
 * 첨부파일과 같은 업로드 루트(`UPLOAD_ROOT`) 아래에 둔다. 예전에는 `process.cwd()/uploads` 였는데,
 * 도커(cwd=/app)에선 같은 곳이지만 맥에서 띄운 API는 저장소 안(`apps/api/uploads/`)에 원문 PDF를
 * 쌓았다 — git 이 무시하지 않는 위치라 실수로 커밋될 수 있었다.
 */
export function regulationParseDir(tenantId: string): string {
  return join(UPLOAD_ROOT, tenantId || 'default', 'regulation-parse');
}

/** 세션이 보관한 원문 이름은 우리가 만든 `<세션 UUID>.pdf` 뿐이다. 그 밖의 값은 경로로 쓰지 않는다. */
const SOURCE_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

export function regulationParseSourcePath(tenantId: string, sourceFile: unknown): string | null {
  if (typeof sourceFile !== 'string' || !SOURCE_FILE_RE.test(sourceFile)) return null;
  const dir = resolve(regulationParseDir(tenantId));
  const path = resolve(dir, sourceFile);
  return path.startsWith(dir + sep) ? path : null;
}
