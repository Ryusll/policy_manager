import { describe, it, expect } from 'vitest';
import {
  UPLOAD_ROOT,
  UnsafeUploadPathError,
  policyUploadDir,
  policyUploadFilePath,
} from '../apps/api/src/policies/upload-path';

const TENANT = '11111111-1111-4111-8111-111111111111';
const POLICY = '22222222-2222-4222-8222-222222222222';

describe('규정 첨부파일 경로 (T-41)', () => {
  it('정상 경로는 테넌트/규정 디렉터리 아래로 조립된다', () => {
    expect(policyUploadDir(TENANT, POLICY)).toBe(`${UPLOAD_ROOT}/${TENANT}/${POLICY}`);
    expect(policyUploadFilePath(TENANT, POLICY, '1754000000000-123456.pdf')).toBe(
      `${UPLOAD_ROOT}/${TENANT}/${POLICY}/1754000000000-123456.pdf`,
    );
  });

  it('규정 id 자리의 경로 조각을 막는다', () => {
    // 회귀 방지: `/policies/..%2F..%2F..%2Fetc/files/hostname` 으로 컨테이너의
    // 아무 파일이나 읽고 지울 수 있었다. Express 는 라우트를 인코딩된 상태로 맞춘 뒤
    // 값을 풀기 때문에, `:id` 하나에 `../../../etc` 가 통째로 들어온다.
    for (const bad of ['../../../etc', '..', '.', 'a/b', '../' + POLICY, '']) {
      expect(() => policyUploadDir(TENANT, bad)).toThrow(UnsafeUploadPathError);
    }
  });

  it('테넌트 id 자리도 같은 검사를 받는다', () => {
    expect(() => policyUploadDir('../other-tenant', POLICY)).toThrow(UnsafeUploadPathError);
    expect(() => policyUploadDir('default', POLICY)).toThrow(UnsafeUploadPathError);
  });

  it('파일명의 경로 조각·상위 이동을 막는다', () => {
    for (const bad of ['../secret.pdf', 'sub/dir.pdf', '/etc/hostname', '..', '.', '']) {
      expect(() => policyUploadFilePath(TENANT, POLICY, bad)).toThrow(UnsafeUploadPathError);
    }
  });

  it('저장 파일명 규칙 밖의 글자를 막는다', () => {
    // 원본 파일명은 저장에 쓰지 않는다. 우리가 만드는 이름은 영숫자·점·밑줄·붙임표뿐이다.
    for (const bad of ['한글.pdf', 'a b.pdf', 'a;rm -rf.pdf']) {
      expect(() => policyUploadFilePath(TENANT, POLICY, bad)).toThrow(UnsafeUploadPathError);
    }
  });

  it('255자를 넘는 파일명을 막는다', () => {
    expect(() => policyUploadFilePath(TENANT, POLICY, 'a'.repeat(256))).toThrow(
      UnsafeUploadPathError,
    );
  });
});
