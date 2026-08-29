/**
 * 장 머리글(제목 표시 여부) 규칙 (T-84).
 *
 * `Article.chapterId` 가 필수라, "장이 없는 규정"은 **숨김 장**(`suppressHeader`)
 * 이라는 관례로 표현된다([ADR-0011](../../../../docs/Deliverables/10_ADR_의사결정기록/ADR.md)).
 * 그래서 지켜야 할 불변식이 하나 생긴다 — **보이는 장은 제목이 있어야 한다.**
 * 제목 없는 보이는 장은 화면에 "제1장" 뒤에 아무것도 없는 줄로 나온다.
 *
 * 생성(`createChapter`)에는 이 검사가 있었는데 **수정에는 없었다.** 만들 때 막은
 * 상태를 고칠 때 만들 수 있었다는 뜻이다(실측: `PUT … {"title":""}` → 200,
 * `title=""` · `suppressHeader=false` 저장). T-58·T-13·T-42 와 같은 종류다 —
 * 주 경로에는 있는 검사가 곁길에 없다.
 */

/** 숨김 장의 제목. 비워 두면 관리 화면 목록에서 구분할 수 없다. */
export const HIDDEN_CHAPTER_TITLE = '본문';

export type ChapterHeaderState = { title: string; suppressHeader: boolean };

export type ChapterHeaderPatch = {
  title?: string;
  suppressHeader?: boolean;
};

export class ChapterHeaderError extends Error {}

/**
 * 수정 요청을 적용한 뒤의 상태를 돌려준다. 불변식을 깨면 던진다.
 * `undefined`(건드리지 않음)와 `''`(비우기)를 구분해야 하므로 patch 를 그대로 본다.
 */
export function applyChapterHeaderPatch(
  current: ChapterHeaderState,
  patch: ChapterHeaderPatch,
): ChapterHeaderState {
  const suppress =
    patch.suppressHeader === undefined ? current.suppressHeader : patch.suppressHeader === true;
  const title = (patch.title === undefined ? current.title : String(patch.title)).trim();

  if (suppress) {
    // 숨긴 장은 제목을 쓰지 않는다. 비워 두지 말고 기본값을 채워 목록에서 알아볼 수 있게 한다.
    return { title: title || HIDDEN_CHAPTER_TITLE, suppressHeader: true };
  }
  if (!title) {
    throw new ChapterHeaderError('장 제목을 입력하세요. 제목 없이 두려면 장 숨김을 켜세요.');
  }
  return { title, suppressHeader: false };
}

/** 생성 시에도 같은 규칙을 쓴다 — 두 경로가 갈라지지 않게 한다. */
export function newChapterHeader(patch: ChapterHeaderPatch): ChapterHeaderState {
  return applyChapterHeaderPatch({ title: '', suppressHeader: false }, patch);
}
