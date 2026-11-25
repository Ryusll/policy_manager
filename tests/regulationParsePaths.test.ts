import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { regulationParseDir, regulationParseSourcePath } from '../apps/api/src/regulation-parse/regulation-parse-paths';
import { UPLOAD_ROOT } from '../apps/api/src/policies/upload-path';

const TENANT = '11111111-2222-3333-4444-555555555555';
const SESSION_PDF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf';

describe('가져오기 원문 PDF 보관 경로', () => {
  it('첨부파일과 같은 업로드 루트 아래에 둔다 (실행 위치 기준이 아니다)', () => {
    // 예전에는 process.cwd()/uploads 라서 맥에서 띄운 API가 저장소 안에 원문을 쌓았다
    expect(regulationParseDir(TENANT)).toBe(`${UPLOAD_ROOT}/${TENANT}/regulation-parse`);
    expect(regulationParseDir(TENANT).startsWith(process.cwd())).toBe(UPLOAD_ROOT.startsWith(process.cwd()));
  });

  it('세션이 만든 `<UUID>.pdf` 이름만 경로로 쓴다', () => {
    expect(regulationParseSourcePath(TENANT, SESSION_PDF)).toBe(
      resolve(UPLOAD_ROOT, TENANT, 'regulation-parse', SESSION_PDF),
    );
  });

  it('그 밖의 값(경로 탈출·다른 확장자·문자열 아님)은 거절한다', () => {
    for (const bad of ['../../etc/passwd', `../${SESSION_PDF}`, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.sh', '', null, 42]) {
      expect(regulationParseSourcePath(TENANT, bad)).toBeNull();
    }
  });
});
