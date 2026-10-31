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

describe('내보내기 본문 HTML — 오늘 시행 중인 본문만 (T-127)', () => {
  const scheduled = (content: string, effectiveDate: string) => [{ status: 'published', content, effectiveDate, versionNum: 2 }];
  const out = buildEnterprisePolicyBodyHtml(
    buildFullViewGroups([
      {
        number: 1,
        title: '총칙',
        articles: [
          {
            id: 'a',
            number: 1,
            title: '수당',
            clauseNumber: null,
            itemNumber: null,
            versions: published('지금 본문 알파'),
            scheduledVersions: scheduled('다음 해 본문 베타', '2099-01-01'),
          },
          {
            id: 'b',
            number: 2,
            title: '신설',
            clauseNumber: null,
            itemNumber: null,
            versions: [],
            currentState: 'scheduled',
            scheduledVersions: scheduled('새 조문 엡실론', '2099-03-01'),
          },
          { id: 'c', number: 3, title: '폐지', clauseNumber: null, itemNumber: null, versions: [], currentState: 'repealed', repealedOn: '2026-10-10' },
          { id: 'd', number: 4, title: '끝', clauseNumber: null, itemNumber: null, versions: published('끝 본문') },
        ],
      },
    ]),
  );
  const jo = (n: number) => out.slice(out.indexOf(`data-article="${n}"`), out.indexOf(`data-article="${n + 1}"`) >>> 0);

  it('시행 예정 개정의 본문은 넣지 않고 지금 본문을 넣는다', () => {
    expect(jo(1)).toContain('지금 본문 알파');
    expect(out).not.toContain('베타');
  });

  it('아직 시행 전인 새 조문은 "날짜 시행 예정"만, 폐지는 "삭제 <날짜>"', () => {
    expect(jo(2)).toContain('2099-03-01 시행 예정');
    expect(out).not.toContain('엡실론');
    expect(jo(3)).toContain('삭제 &lt;2026. 10. 10.&gt;');
    expect(jo(3)).not.toContain('시행중 버전이 없습니다');
  });
});
