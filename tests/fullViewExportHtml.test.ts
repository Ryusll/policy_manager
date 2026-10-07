import { describe, it, expect } from 'vitest';
import { buildFullViewGroups } from '../apps/web/src/lib/fullViewGroups';
import { buildEnterprisePolicyBodyHtml } from '../apps/web/src/components/policy-template/templateUtils';

/**
 * 인쇄·PDF·한글 내보내기 본문(HTML). 화면은 시행 전 초안도 "초안 · 시행 전"으로 보여 주지만,
 * 공식 파일은 시행본만 담는다. 항·목을 거느린 조의 머리 행에 "시행중 버전이 없습니다"를
 * 찍던 것도 여기서 막는다.
 */
const published = (content: string) => [{ status: 'published', content }];
const html = buildEnterprisePolicyBodyHtml(
  buildFullViewGroups([
    {
      number: 1,
      title: '총칙',
      articles: [
        { id: 'a', number: 2, title: '적용범위', clauseNumber: null, itemNumber: null, versions: [] },
        { id: 'b', number: 2, title: '', clauseNumber: 1, itemNumber: null, versions: published('항 본문') },
        {
          id: 'c',
          number: 3,
          title: '권한',
          clauseNumber: null,
          itemNumber: null,
          versions: [],
          pendingVersion: { status: 'draft', content: '아직 시행 전인 초안 문구' },
        },
      ],
    },
  ]),
);
const block = (jo: number) => html.slice(html.indexOf(`data-article="${jo}"`), html.indexOf(`data-article="${jo + 1}"`) >>> 0);

describe('내보내기 본문 HTML', () => {
  it('항을 거느린 조의 머리 행에는 "시행중 버전이 없습니다"를 찍지 않는다', () => {
    expect(block(2)).toContain('항 본문');
    expect(block(2)).not.toContain('시행중 버전이 없습니다');
  });

  it('시행 전 초안은 공식 파일에 넣지 않는다', () => {
    expect(html).not.toContain('아직 시행 전인 초안 문구');
    expect(block(3)).toContain('시행중 버전이 없습니다');
  });
});
