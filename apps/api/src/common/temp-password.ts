import { randomInt } from 'crypto';

/**
 * 임시 비밀번호 — 아스트룸이 고객사 마스터에게 전달한다 (T-122).
 *
 * 전화·메신저로 불러 주게 되므로 헷갈리는 글자(0/O, 1/l/I)를 뺐다. 받은 사람은 처음 로그인할 때
 * 반드시 바꾼다(`mustChangePassword`). 길이 14 · 54자 집합 ≈ 80비트로, 바꾸기 전 잠깐 쓰는 값으로
 * 충분하다. 비밀번호 규칙(8자 이상·72바이트 이하)은 항상 만족한다.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export const TEMP_PASSWORD_LENGTH = 14;

export function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
