import { describe, it, expect } from 'vitest';
import {
  applyChapterHeaderPatch,
  newChapterHeader,
  ChapterHeaderError,
  HIDDEN_CHAPTER_TITLE,
} from '../apps/api/src/policies/chapter-header';

/**
 * 장 머리글 불변식 (T-84).
 *
 * `Article.chapterId` 가 필수라 "장 없는 규정"은 숨김 장으로 표현된다(ADR-0011).
 * 그래서 **보이는 장은 제목이 있어야 한다**는 불변식이 생기는데, 이 검사가
 * 생성에는 있고 수정에는 없었다 — 실측: `PUT … {"title":""}` → 200,
 * `title=""` · `suppressHeader=false` 로 저장됐다.
 */

const visible = { title: '총칙', suppressHeader: false };
const hidden = { title: HIDDEN_CHAPTER_TITLE, suppressHeader: true };

describe('장 머리글 규칙 (T-84)', () => {
  describe('수정', () => {
    it('제목만 바꾼다', () => {
      expect(applyChapterHeaderPatch(visible, { title: '통칙' })).toEqual({
        title: '통칙',
        suppressHeader: false,
      });
    });

    it('앞뒤 공백은 정리한다', () => {
      expect(applyChapterHeaderPatch(visible, { title: '  통칙  ' }).title).toBe('통칙');
    });

    /** 이 테스트가 T-84 에서 막은 것이다 */
    it('보이는 장의 제목을 비울 수 없다', () => {
      expect(() => applyChapterHeaderPatch(visible, { title: '' })).toThrow(ChapterHeaderError);
      expect(() => applyChapterHeaderPatch(visible, { title: '   ' })).toThrow(ChapterHeaderError);
    });

    it('건드리지 않은 필드는 그대로 둔다', () => {
      expect(applyChapterHeaderPatch(visible, {})).toEqual(visible);
      expect(applyChapterHeaderPatch(hidden, {})).toEqual(hidden);
    });

    it('숨기면 제목을 비워도 된다 — 기본 이름이 채워진다', () => {
      expect(applyChapterHeaderPatch(visible, { title: '', suppressHeader: true })).toEqual({
        title: HIDDEN_CHAPTER_TITLE,
        suppressHeader: true,
      });
    });

    it('숨김 장의 제목은 남겨 둔다 — 목록에서 구분해야 한다', () => {
      expect(applyChapterHeaderPatch({ title: '부칙 묶음', suppressHeader: true }, {})).toEqual({
        title: '부칙 묶음',
        suppressHeader: true,
      });
    });

    /** 숨김을 풀 때 제목이 '본문' 이면 그대로 보이는 장이 된다 */
    it('숨김을 풀면 제목이 있어야 한다', () => {
      expect(applyChapterHeaderPatch(hidden, { suppressHeader: false })).toEqual({
        title: HIDDEN_CHAPTER_TITLE,
        suppressHeader: false,
      });
      expect(() =>
        applyChapterHeaderPatch({ title: '', suppressHeader: true }, { suppressHeader: false }),
      ).toThrow(ChapterHeaderError);
    });
  });

  describe('생성', () => {
    it('제목이 있으면 보이는 장', () => {
      expect(newChapterHeader({ title: '총칙' })).toEqual({ title: '총칙', suppressHeader: false });
    });

    it('제목이 없으면 거부한다', () => {
      expect(() => newChapterHeader({})).toThrow(ChapterHeaderError);
      expect(() => newChapterHeader({ title: '  ' })).toThrow(ChapterHeaderError);
    });

    it('숨김 장은 제목 없이 만들 수 있다', () => {
      expect(newChapterHeader({ suppressHeader: true })).toEqual({
        title: HIDDEN_CHAPTER_TITLE,
        suppressHeader: true,
      });
    });

    /** 생성과 수정이 같은 함수를 쓰므로 규칙이 갈라질 수 없다 */
    it('생성 규칙은 빈 상태에서 출발한 수정과 같다', () => {
      const patch = { title: '총칙' };
      expect(newChapterHeader(patch)).toEqual(
        applyChapterHeaderPatch({ title: '', suppressHeader: false }, patch),
      );
    });
  });
});
