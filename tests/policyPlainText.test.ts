import { describe, it, expect } from 'vitest';
import { buildFullViewGroups } from '../apps/web/src/lib/fullViewGroups';
import {
  buildPolicyPlainText,
  policyPlainTextFilename,
} from '../apps/web/src/lib/policyPlainText';

/**
 * 전문 텍스트(.txt) 내보내기 (T-84).
 *
 * `Article.chapterId` 가 필수라 "장 없는 규정"은 숨김 장(`suppressHeader`)이라는
 * 관례로 표현된다(ADR-0011). 화면·인쇄·읽어주기는 모두 `isChapterHeaderHidden` 을
 * 거치는데 **텍스트 내보내기만 거치지 않아서** `===== 제1장  =====` 라는 유령
 * 장 제목이 찍혔다. 관례를 모르는 코드가 하나만 있어도 새는 구조라, 조립을
 * 컴포넌트 밖으로 꺼내 여기서 묶는다.
 */

const ver = (content: string) => [{ content, status: 'published' }];

const article = (over: Record<string, any> = {}) => ({
  id: `a-${Math.random()}`,
  number: 1,
  title: '목적',
  clauseNumber: null,
  itemNumber: null,
  sectionId: null,
  versions: ver('이 규정은 …을 목적으로 한다.'),
  ...over,
});

const policy = { code: 'HR-001', title: '인사규정' };

describe('전문 텍스트 내보내기 (T-84)', () => {
  it('장이 있으면 장 제목 줄을 넣는다', () => {
    const chapters = buildFullViewGroups([
      {
        id: 'c1',
        number: 1,
        title: '총칙',
        suppressHeader: false,
        sections: [],
        articles: [article({ number: 1, title: '목적' })],
      },
    ]);
    const text = buildPolicyPlainText({ policy, chapters });
    expect(text).toContain('===== 제1장 총칙 =====');
    expect(text).toContain('제1조 목적');
    expect(text).toContain('이 규정은 …을 목적으로 한다.');
  });

  /** 이 테스트가 T-84 의 핵심이다 */
  describe('장이 없는 규정 (숨김 장)', () => {
    const hidden = () =>
      buildFullViewGroups([
        {
          id: 'c1',
          number: 1,
          title: '',
          suppressHeader: true,
          sections: [],
          articles: [
            article({ number: 1, title: '목적' }),
            article({ number: 2, title: '적용범위', versions: ver('본사와 지점에 적용한다.') }),
          ],
        },
      ]);

    it('유령 장 제목을 찍지 않는다', () => {
      const text = buildPolicyPlainText({ policy, chapters: hidden() });
      expect(text).not.toContain('제1장');
      expect(text).not.toMatch(/=====\s*제\d+장/);
    });

    it('조문은 그대로 다 들어간다', () => {
      const text = buildPolicyPlainText({ policy, chapters: hidden() });
      expect(text).toContain('제1조 목적');
      expect(text).toContain('제2조 적용범위');
      expect(text).toContain('본사와 지점에 적용한다.');
    });

    /** 제목만 비어 있고 suppressHeader 가 없는 장도 같은 취급이다 */
    it('제목이 빈 장도 숨긴다', () => {
      const chapters = buildFullViewGroups([
        { id: 'c1', number: 1, title: '   ', sections: [], articles: [article()] },
      ]);
      expect(buildPolicyPlainText({ policy, chapters })).not.toContain('제1장');
    });
  });

  /** 절 소속 조문을 빠뜨리면 텍스트만 조문이 사라진다(T-87과 같은 사고) */
  it('절에 속한 조문도 빠짐없이 담는다', () => {
    const chapters = buildFullViewGroups([
      {
        id: 'c1',
        number: 1,
        title: '총칙',
        sections: [{ id: 's1', number: 1, title: '통칙' }],
        articles: [
          article({ number: 1, title: '목적' }),
          article({ number: 2, title: '절 안의 조', sectionId: 's1', versions: ver('절 본문') }),
        ],
      },
    ]);
    const text = buildPolicyPlainText({ policy, chapters });
    expect(text).toContain('제1조 목적');
    expect(text).toContain('제2조 절 안의 조');
    expect(text).toContain('절 본문');
  });

  it('항·목도 자기 번호로 들어간다', () => {
    const chapters = buildFullViewGroups([
      {
        id: 'c1',
        number: 1,
        title: '총칙',
        sections: [],
        articles: [
          article({ number: 1, title: '목적' }),
          article({ number: 1, clauseNumber: 1, title: '', versions: ver('첫째 항') }),
          article({ number: 1, clauseNumber: 1, itemNumber: 1, title: '', versions: ver('첫째 목') }),
        ],
      },
    ]);
    const text = buildPolicyPlainText({ policy, chapters });
    expect(text).toContain('첫째 항');
    expect(text).toContain('첫째 목');
  });

  it('부칙·별표·서식을 뒤에 붙인다', () => {
    const text = buildPolicyPlainText({
      policy,
      chapters: [],
      appendices: [{ kind: 'supplementary', title: '시행일', body: '이 규정은 즉시 시행한다.' }],
      appendixKindLabel: { supplementary: '부칙', annex: '별표', form: '서식' },
    });
    expect(text).toContain('===== 부칙·별표·서식 =====');
    expect(text).toContain('[부칙] 시행일');
    expect(text).toContain('이 규정은 즉시 시행한다.');
  });

  it('부록이 없으면 그 머리글도 없다', () => {
    const text = buildPolicyPlainText({ policy, chapters: [], appendices: [] });
    expect(text).not.toContain('부칙·별표·서식');
  });

  it('파일명은 규정 코드에서 경로 문자를 지운다', () => {
    expect(policyPlainTextFilename('HR-001')).toBe('HR-001-full.txt');
    expect(policyPlainTextFilename('사규/2026 인사')).toBe('_2026_-full.txt');
    expect(policyPlainTextFilename('')).toBe('policy-full.txt');
  });
});

describe('전문 텍스트 — 오늘 시행 중인 본문만 (T-127)', () => {
  it('시행 예정 개정 본문은 넣지 않고, 시행 전 새 조문·폐지 조문은 표시만', () => {
    const chapters = buildFullViewGroups([
      {
        id: 'c1',
        number: 1,
        title: '총칙',
        suppressHeader: false,
        sections: [],
        articles: [
          article({ number: 1, title: '수당', versions: ver('지금 본문 알파'), scheduledVersions: [{ content: '다음 해 베타', effectiveDate: '2099-01-01' }] }),
          article({ number: 2, title: '신설', versions: [], currentState: 'scheduled', scheduledVersions: [{ content: '새 엡실론', effectiveDate: '2099-03-01' }] }),
          article({ number: 3, title: '폐지', versions: [], currentState: 'repealed', repealedOn: '2026-10-10' }),
        ],
      },
    ]);
    const text = buildPolicyPlainText({ policy, chapters });
    expect(text).toContain('지금 본문 알파');
    expect(text).not.toContain('베타');
    expect(text).not.toContain('엡실론');
    expect(text).toContain('2099-03-01 시행 예정');
    expect(text).toContain('삭제 <2026. 10. 10.>');
  });
});


describe('전문 텍스트 — 어느 날의 본문인지 (T-180)', () => {
  it('제목 아래에 기준 줄을 넣고, 시점 본문이면 파일명에 그 날짜를 붙인다 (T-180)', () => {
    const text = buildPolicyPlainText({ policy, basis: '기준일: 2021-06-01 시점 본문', chapters: [] });
    expect(text.split('\n').slice(0, 2)).toEqual(['HR-001 인사규정', '기준일: 2021-06-01 시점 본문']);
    expect(policyPlainTextFilename('HR-001', '2021-06-01')).toBe('HR-001-2021-06-01-full.txt');
    // 현행은 지금처럼, 날짜 꼴이 아니면 붙이지 않는다
    expect(policyPlainTextFilename('HR-001', null)).toBe('HR-001-full.txt');
    expect(policyPlainTextFilename('HR-001', '../x')).toBe('HR-001-full.txt');
  });

  it('기준 줄이 없으면 예전 머리 그대로 (T-180)', () => {
    expect(buildPolicyPlainText({ policy, chapters: [] }).split('\n').slice(0, 2)).toEqual(['HR-001 인사규정', '']);
  });
});
