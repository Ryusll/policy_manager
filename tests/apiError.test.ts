/**
 * 서버 오류에서 사람이 읽을 문구와 갈라 처리할 code 를 꺼낸다 (T-219 — 규정 질문 화면과 켜기·끄기 창이 함께 쓴다).
 */
import { describe, expect, it } from 'vitest';
import { apiErrorMessage, errorCode, serverMessage } from '../apps/web/src/lib/apiError';

const failed = (data: unknown) => ({ response: { status: 400, data } });

describe('서버 오류 문구 (T-219)', () => {
  it('서버가 준 문구를 그대로, 입력 검증 배열이면 첫 문구', () => {
    expect(serverMessage(failed({ message: '고른 규정 가운데 지금 고를 수 없는 규정이 있습니다.' }))).toBe(
      '고른 규정 가운데 지금 고를 수 없는 규정이 있습니다.',
    );
    expect(serverMessage(failed({ message: ['question must be longer', 'policyIds must be unique'] }))).toBe('question must be longer');
  });

  it('서버 기본 문구·빈 문구·문구 없음·끊김은 null — 화면이 자기 문구를 쓴다', () => {
    for (const err of [failed({ message: 'Internal server error' }), failed({ message: '' }), failed({}), new Error('Network Error'), null, undefined]) {
      expect(serverMessage(err)).toBeNull();
    }
  });

  it('code 는 문자열일 때만', () => {
    expect(errorCode(failed({ code: 'AI_QA_SCOPE_INVALID' }))).toBe('AI_QA_SCOPE_INVALID');
    for (const err of [failed({ code: 400 }), failed({}), new Error('x'), null]) expect(errorCode(err)).toBeUndefined();
  });

  it('apiErrorMessage 는 그대로 — 배열은 이어 붙이고, 없으면 대신 쓸 문구', () => {
    expect(apiErrorMessage(failed({ message: ['a', 'b'] }), '대신')).toBe('a, b');
    expect(apiErrorMessage(failed({}), '대신')).toBe('대신');
  });
});
