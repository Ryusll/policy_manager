import { describe, it, expect } from 'vitest';
import {
  SPEECH_CHUNK_LIMIT,
  articleToSpeech,
  buildPolicySpeech,
  chunkForSpeech,
} from '../apps/web/src/lib/speech';

describe('articleToSpeech — 화면 표기가 아니라 말로 읽는 표기', () => {
  it('조는 번호와 제목을 읽는다', () => {
    expect(articleToSpeech({ number: 3, title: '목적', content: '이 규정은…' })).toBe(
      '제3조. 목적. 이 규정은…',
    );
  });

  it('항은 ① 이 아니라 "제1항" 으로 읽는다', () => {
    // 화면 표기(①)를 그대로 넘기면 읽어주지 못하거나 "동그라미 일" 로 읽는다.
    expect(articleToSpeech({ number: 3, clauseNumber: 1, content: '항 본문' })).toBe(
      '제1항. 항 본문',
    );
  });

  it('목은 "제N목" 으로 읽는다', () => {
    expect(articleToSpeech({ number: 3, clauseNumber: 1, itemNumber: 2, content: '목 본문' })).toBe(
      '제2목. 목 본문',
    );
  });

  it('본문이 없으면 번호만', () => {
    expect(articleToSpeech({ number: 5 })).toBe('제5조');
  });

  it('줄바꿈·연속 공백을 정리한다', () => {
    expect(articleToSpeech({ number: 1, content: '가\n\n나   다' })).toBe('제1조. 가 나 다');
  });

  it('규정 상세의 조문은 오늘 시행 중인 버전의 본문을 읽는다(조문 행에는 본문 칸이 없다)', () => {
    expect(articleToSpeech({ number: 2, title: '수당', versions: [{ content: '수당은 10만원이다.' }] })).toBe(
      '제2조. 수당. 수당은 10만원이다.',
    );
  });

  it('시행 예정 본문은 읽지 않는다 — 폐지면 "삭제", 시행 전 새 조문이면 "시행 예정"만 (T-127)', () => {
    const scheduledVersions = [{ content: '다음 해 본문', effectiveDate: '2099-03-01' }];
    expect(articleToSpeech({ number: 5, title: '신설', versions: [], currentState: 'scheduled', scheduledVersions })).toBe(
      '제5조. 신설. 2099-03-01 시행 예정',
    );
    expect(articleToSpeech({ number: 3, versions: [], currentState: 'repealed', repealedOn: '2026-10-10' })).toBe(
      '제3조. 삭제 <2026. 10. 10.>',
    );
    expect(
      articleToSpeech({ number: 2, versions: [{ content: '지금 본문' }], currentState: 'in_force', scheduledVersions }),
    ).toBe('제2조. 지금 본문');
  });
});

describe('chunkForSpeech — 길면 중간에서 끊긴다', () => {
  it('빈 입력은 빈 배열', () => {
    expect(chunkForSpeech('')).toEqual([]);
    expect(chunkForSpeech('   ')).toEqual([]);
  });

  it('짧으면 한 덩이', () => {
    expect(chunkForSpeech('짧은 문장이다.')).toEqual(['짧은 문장이다.']);
  });

  it('모든 덩이가 한도를 넘지 않는다', () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i}번째 문장입니다.`).join(' ');
    const chunks = chunkForSpeech(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SPEECH_CHUNK_LIMIT);
  });

  it('한 문장이 한도를 넘으면 쉼표에서 자른다', () => {
    const sentence = `${'가'.repeat(100)}, ${'나'.repeat(100)}.`;
    const chunks = chunkForSpeech(sentence);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SPEECH_CHUNK_LIMIT);
    expect(chunks.join('')).toContain('가');
    expect(chunks.join('')).toContain('나');
  });

  it('쉼표조차 없어도 글자 수로 자른다 (읽다 마는 것보다 낫다)', () => {
    const chunks = chunkForSpeech('다'.repeat(500));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SPEECH_CHUNK_LIMIT);
  });

  it('내용을 잃지 않는다', () => {
    const text = '첫째 문장. 둘째 문장. 셋째 문장.';
    expect(chunkForSpeech(text).join(' ')).toBe(text);
  });
});

describe('buildPolicySpeech', () => {
  const chapters = [
    {
      id: 'c1',
      number: 1,
      title: '총칙',
      suppressHeader: false,
      blocks: [
        {
          kind: 'groups',
          groups: [{ articleNumber: 1, items: [{ number: 1, title: '목적', content: '본문이다.' }] }],
        },
      ],
    },
  ];

  it('규정명·장·조를 순서대로 읽는다', () => {
    const out = buildPolicySpeech(chapters, '인사규정').join(' ');
    expect(out).toContain('인사규정');
    expect(out).toContain('제1장 총칙');
    expect(out).toContain('제1조');
    expect(out).toContain('본문이다.');
  });

  it('숨김 장의 제목은 읽지 않는다', () => {
    // 원문에 없는 장을 우리가 만든 것이라 읽으면 없는 구조를 말하는 셈이다.
    const hidden = [{ ...chapters[0], suppressHeader: true }];
    expect(buildPolicySpeech(hidden).join(' ')).not.toContain('총칙');
  });

  it('절 제목도 읽는다', () => {
    const withSection = [
      {
        ...chapters[0],
        blocks: [{ kind: 'section', number: 2, title: '통칙', groups: [] }],
      },
    ];
    expect(buildPolicySpeech(withSection).join(' ')).toContain('제2절 통칙');
  });

  it('빈 규정은 빈 배열', () => {
    expect(buildPolicySpeech([])).toEqual([]);
  });
});
