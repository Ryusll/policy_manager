import { describe, it, expect } from 'vitest';
import { publicSignupEnabled } from '../apps/api/src/auth/signup-policy';
import { generateTemporaryPassword, TEMP_PASSWORD_LENGTH } from '../apps/api/src/common/temp-password';
import { passwordProblem } from '../apps/api/src/users/password-policy';

describe('publicSignupEnabled — 공개 회원가입 (T-122)', () => {
  it('기본은 닫힘 — 설정을 빠뜨린 운영 서버가 열려 버리면 안 된다', () => {
    expect(publicSignupEnabled({})).toBe(false);
    expect(publicSignupEnabled({ ALLOW_PUBLIC_SIGNUP: '' })).toBe(false);
  });

  it('"true" 일 때만 열린다 — "1"·"yes" 같은 값으로 우연히 열리지 않는다', () => {
    expect(publicSignupEnabled({ ALLOW_PUBLIC_SIGNUP: 'true' })).toBe(true);
    expect(publicSignupEnabled({ ALLOW_PUBLIC_SIGNUP: ' TRUE ' })).toBe(true);
    for (const v of ['1', 'yes', 'false', 'on']) {
      expect(publicSignupEnabled({ ALLOW_PUBLIC_SIGNUP: v }), v).toBe(false);
    }
  });
});

describe('generateTemporaryPassword — 아스트룸이 마스터에게 주는 임시 비밀번호', () => {
  it('비밀번호 규칙을 항상 만족한다', () => {
    for (let i = 0; i < 200; i += 1) expect(passwordProblem(generateTemporaryPassword())).toBeNull();
  });

  it('불러 주기 헷갈리는 글자(0 O 1 l I)를 쓰지 않는다', () => {
    const many = Array.from({ length: 300 }, () => generateTemporaryPassword()).join('');
    expect(many).not.toMatch(/[0O1lI]/);
    expect(generateTemporaryPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
  });

  it('매번 다르다', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    expect(set.size).toBe(200);
  });
});
