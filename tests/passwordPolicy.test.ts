import { describe, it, expect } from 'vitest';
import { passwordProblem } from '../apps/api/src/users/password-policy';

describe('passwordProblem', () => {
  it('8자 미만은 거부한다', () => {
    expect(passwordProblem('abc1234')).toContain('8자');
    expect(passwordProblem('abcd1234')).toBeNull();
  });

  /** bcrypt 는 72바이트 뒤를 무시한다 — 한글 25자(75바이트)는 앞 24자만 검사되는 비밀번호가 된다 */
  it('72바이트를 넘으면 거부한다 — 한글은 글자당 3바이트', () => {
    expect(passwordProblem('가'.repeat(24))).toBeNull();
    expect(passwordProblem('가'.repeat(25))).toContain('72바이트');
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toContain('72바이트');
  });

  it('현재 비밀번호와 같으면 거부한다', () => {
    expect(passwordProblem('samePass123', 'samePass123')).toContain('같습니다');
    expect(passwordProblem('otherPass123', 'samePass123')).toBeNull();
  });

  it('재설정처럼 현재 값을 모르는 경우엔 비교하지 않는다', () => {
    expect(passwordProblem('anything123')).toBeNull();
  });
});
