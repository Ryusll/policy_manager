/**
 * 전문 보기 검색의 일치 개수 (`n/m` 의 m).
 *
 * 이전/다음 이동은 화면에 그려진 강조(`.tmpl-fullview-hit`)를 따라가므로, 개수는 화면이 적는 글과
 * 같은 것을 세야 한다. 조 제목은 조 머리(`제1조(목적)`)에 한 번만 적는다 — 조 머리 행의 제목과
 * 그 제목을 되풀이하는 제1항을 따로 세면 강조보다 개수가 많아진다(T-211). 조 번호도 화면처럼 센다.
 */

import { escapeRegExp } from './searchRegex';
import { articleHeadingSegments } from './articleHeading';
import { fullViewRowTitle, joGroupHeadTitle, joGroupRenderRows, type FullViewJoGroup } from './fullViewGroups';

/** `buildFullViewGroups` 결과의 장 — 개수를 세는 데 쓰는 부분만 */
type FullViewChapterLike = { title?: string | null; allGroups?: FullViewJoGroup[] };

export function countFullViewMatches(fullViewGroups: FullViewChapterLike[] | null | undefined, query: string): number {
  const q = String(query ?? '').trim();
  if (!q) return 0;
  const re = new RegExp(escapeRegExp(q), 'gi');
  const countIn = (s: string | null | undefined) => (s ?? '').match(re)?.length ?? 0;

  let count = 0;
  for (const chapter of fullViewGroups || []) {
    count += countIn(chapter?.title);
    // allGroups 는 절 소속 조문까지 포함한다(절 미소속만 보는 blocks 로 세면 개수가 모자란다)
    for (const group of chapter?.allGroups || []) {
      const joTitle = joGroupHeadTitle(group);
      // 조 머리 — 화면·내보내기가 강조하는 번호·제목 조각 그대로 센다(괄호는 대상이 아니다). 예전에는 화면이 조 번호를
      // 강조하면서 개수에는 넣지 않아 '제2조'로 찾으면 강조는 보이는데 0건이었다
      for (const seg of articleHeadingSegments(group.articleNumber, group.articleBranch, joTitle)) {
        if (seg.part !== 'paren') count += countIn(seg.text);
      }
      for (const { article } of joGroupRenderRows(group)) {
        count += countIn(fullViewRowTitle(article, joTitle));
        count += countIn(article?.versions?.[0]?.content);
      }
    }
  }
  return count;
}
