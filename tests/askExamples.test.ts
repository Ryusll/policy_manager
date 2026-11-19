/**
 * 규정 질문 처음 화면의 예시 질문 (T-217, SRS SEARCH-9 ②).
 * 열람자(직원)에게는 직원용만, 관리자·편집자에게는 담당자용을 먼저. '다른 예시 보기'는 3개씩 돈다.
 */
import { describe, expect, it } from 'vitest';
import {
  ASK_EXAMPLE_KEYS,
  ASK_EXAMPLES_PER_PAGE,
  examplePage,
  examplePageCount,
  exampleGroupsFor,
  nextExamplePage,
} from '../apps/web/src/lib/askExamples';
import { ASK_MAX_CHARS, canSubmitQuestion } from '../apps/web/src/lib/askQuestion';
import { messages } from '../apps/web/src/i18n/messages';

const ko = messages.ko as Record<string, string>;
const en = messages.en as Record<string, string>;

describe('역할별 예시 묶음 (T-217)', () => {
  it('열람자는 직원용만', () => {
    expect(exampleGroupsFor('viewer')).toEqual(['staff']);
  });

  it('관리자·편집자는 담당자용을 먼저, 직원용도 고를 수 있다', () => {
    expect(exampleGroupsFor('admin')).toEqual(['manager', 'staff']);
    expect(exampleGroupsFor('editor')).toEqual(['manager', 'staff']);
  });

  it('모르는 역할이나 사용자 없음은 직원용만(권한이 적은 쪽으로)', () => {
    expect(exampleGroupsFor(undefined)).toEqual(['staff']);
    expect(exampleGroupsFor(null)).toEqual(['staff']);
    expect(exampleGroupsFor('auditor')).toEqual(['staff']);
  });
});

describe('다른 예시 보기 — 3개씩 돈다 (T-217)', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('6개면 두 쪽을 오간다', () => {
    expect(ASK_EXAMPLES_PER_PAGE).toBe(3);
    expect(examplePage(six, 0)).toEqual(['a', 'b', 'c']);
    expect(examplePage(six, 1)).toEqual(['d', 'e', 'f']);
    expect(nextExamplePage(0, six.length)).toBe(1);
    expect(nextExamplePage(1, six.length)).toBe(0);
    expect(examplePage(six, 2)).toEqual(['a', 'b', 'c']);
  });

  it('3개 이하면 한 쪽뿐이라 다음 쪽이 없다', () => {
    expect(examplePageCount(3)).toBe(1);
    expect(examplePageCount(0)).toBe(1);
    expect(nextExamplePage(0, 3)).toBe(0);
  });

  it('3으로 나눠떨어지지 않아도 빈 쪽 없이 돈다', () => {
    const seven = [...six, 'g'];
    expect(examplePageCount(7)).toBe(3);
    expect(examplePage(seven, 2)).toEqual(['g']);
    expect(nextExamplePage(2, 7)).toBe(0);
  });
});

describe('예시 문장 (T-217)', () => {
  it('묶음마다 6개, 서로 겹치지 않는다', () => {
    expect(ASK_EXAMPLE_KEYS.manager).toHaveLength(6);
    expect(ASK_EXAMPLE_KEYS.staff).toHaveLength(6);
    const all = [...ASK_EXAMPLE_KEYS.manager, ...ASK_EXAMPLE_KEYS.staff];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all.map((k) => ko[k])).size).toBe(all.length);
  });

  it('모든 예시가 한국어 사전에 있고 보낼 수 있는 길이다', () => {
    for (const key of [...ASK_EXAMPLE_KEYS.manager, ...ASK_EXAMPLE_KEYS.staff]) {
      expect(ko[key], key).toBeTruthy();
      expect(canSubmitQuestion(ko[key]), key).toBe(true);
      expect(ko[key].length, key).toBeLessThanOrEqual(ASK_MAX_CHARS);
    }
  });

  it('영어 화면의 예시는 영어로 옮겨 두었다(한글 없음)', () => {
    for (const key of [...ASK_EXAMPLE_KEYS.manager, ...ASK_EXAMPLE_KEYS.staff]) {
      expect(en[key], key).toBeTruthy();
      expect(en[key], key).not.toMatch(/[가-힣]/);
      expect(canSubmitQuestion(en[key]), key).toBe(true);
    }
  });
});
