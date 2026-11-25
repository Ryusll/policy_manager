import { describe, it, expect } from 'vitest';
import {
  checkReport,
  cleanInline,
  joKeyOf,
  normalizeVerdict,
  reportAcceptor,
  stripLawJoInText,
  stripUngroundedJo,
  type ReportContext,
} from '../apps/api/src/ask/ask-report';
import { REPORT_SCHEMA } from '../apps/api/src/ask/ask-report-prompt';
import { VERDICTS } from '../apps/api/src/ask/ask-text';

/**
 * T-207 규정 질문 답 모양 고정 — 검토 보고서형(SRS SEARCH-7). AI 가 채운 칸을 서버가 검사해 고정된 순서의 블록으로 바꾼다.
 * T-130 의 근거 규칙(준 번호 밖 근거는 버림, 근거가 없으면 답하지 않음)은 그대로다(SEARCH-4).
 */

const ctx: ReportContext = { refs: new Set(['R1', 'R2']), lawRefs: new Set(['L1']), lawJo: new Set(['제29조']) };
const good = (over: Record<string, unknown> = {}) => ({
  answerable: true,
  lead: '이 규정은 관련 법령과 **대체로 부합**합니다 [R1].',
  rows: [
    { area: '적용 범위', law: '개인정보 보호법 제29조', current: '제2조: 모든 임직원', verdict: '대체로 부합', advice: '현행 유지' },
    { area: '침해사고 대응', law: '정보통신망법', current: '규정에 없음', verdict: '보완 필요', advice: '신고 절차를 둔다' },
  ],
  listKind: 'amend',
  priorities: [{ title: '침해사고 대응 절차', detail: '사고 등급과 **보고 기한**을 정한다.' }],
  conclusion: '골격은 갖췄지만 **세부 절차**가 약합니다.',
  basis: '근거 규정상으로는 적용 범위는 제2조에 있습니다.',
  citations: ['R1', 'R2'],
  lawCitations: ['L1'],
  ...over,
});

describe('검토 보고서 모양 — 늘 같은 순서의 블록 (T-207)', () => {
  it('직답 → 검토 표 → 우선 권고 → 종합 의견 → 근거 요약 순서로 나온다 (T-207)', () => {
    const out = checkReport(good(), ctx);
    expect(out.answerable).toBe(true);
    expect(out.problem).toBeNull();
    expect(out.blocks.map((b) => b.type)).toEqual(['paragraph', 'review', 'priorities', 'paragraph', 'paragraph']);
    expect(out.blocks[0]).toEqual({ type: 'paragraph', text: '이 규정은 관련 법령과 **대체로 부합**합니다 .' });
    expect(out.blocks[2]).toEqual({
      type: 'priorities',
      kind: 'amend',
      items: [{ title: '침해사고 대응 절차', detail: '사고 등급과 **보고 기한**을 정한다.' }],
    });
    expect(out.citations).toEqual(['R1', 'R2']);
    expect(out.lawCitations).toEqual(['L1']);
  });

  it('모델이 칸 순서를 바꿔 내도 블록 순서는 서버가 정한다 (T-207)', () => {
    const shuffled = Object.fromEntries(Object.entries(good()).reverse());
    expect(checkReport(shuffled, ctx).blocks.map((b) => b.type)).toEqual(['paragraph', 'review', 'priorities', 'paragraph', 'paragraph']);
  });

  it('표에 고칠 행이 있으면 목록은 늘 "우선 개정 권고"다 — 모델이 summary 라고 해도 (T-207)', () => {
    const out = checkReport(good({ listKind: 'summary' }), ctx);
    expect(out.blocks[2]).toMatchObject({ type: 'priorities', kind: 'amend' });
    const fine = good({
      listKind: 'summary',
      rows: [{ area: '연차휴가', law: '근로기준법', current: '제12조: 15일', verdict: '부합', advice: '현행 유지' }],
    });
    expect(checkReport(fine, ctx).blocks[2]).toMatchObject({ kind: 'summary' });
    // 고칠 행이 없으면 모델이 amend 라고 해도 '핵심 정리' — 목록 종류는 표로만 정한다(검토 지적 M1)
    expect(checkReport({ ...fine, listKind: 'amend', priorities: [] }, ctx).blocks[2]).toMatchObject({ kind: 'summary' });
  });

  it('권고 목록을 비워 오면 표에서 만든다 — 목록 칸이 늘 있다 (T-207)', () => {
    const out = checkReport(good({ priorities: [] }), ctx);
    expect(out.blocks[2]).toEqual({ type: 'priorities', kind: 'amend', items: [{ title: '침해사고 대응', detail: '신고 절차를 둔다' }] });
  });

  it('근거 요약이 비면 서버가 인용 조문으로 만든 문장을 쓴다 (T-207)', () => {
    const out = checkReport(good({ basis: '' }), { ...ctx, basisFrom: (refs) => `근거 규정은 정보보안 규정 ${refs.join('·')}입니다.` });
    expect(out.blocks.at(-1)).toEqual({ type: 'paragraph', text: '근거 규정은 정보보안 규정 R1·R2입니다.' });
  });

  it('직답·표·종합 의견이 비면 형식 미달 — 다음 모델로 다시 받게 사유를 돌려준다 (T-207)', () => {
    expect(checkReport(good({ lead: '  ' }), ctx)).toMatchObject({ answerable: false, problem: 'lead', blocks: [] });
    expect(checkReport(good({ rows: [] }), ctx)).toMatchObject({ answerable: false, problem: 'rows' });
    expect(checkReport(good({ rows: [{ area: '', current: '' }] }), ctx)).toMatchObject({ problem: 'rows' });
    expect(checkReport(good({ conclusion: '' }), ctx)).toMatchObject({ answerable: false, problem: 'conclusion' });
  });

  it('판단을 알아볼 수 없으면 "추가 확인 필요"로 덮지 않고 형식 미달 (T-207)', () => {
    const rows = [{ area: '적용 범위', law: '-', current: '제2조', verdict: '음…', advice: '-' }];
    expect(checkReport(good({ rows }), ctx)).toMatchObject({ answerable: false, problem: 'verdict' });
  });
});

describe('AI 답 검사 — 근거 규칙 (T-130·T-207)', () => {
  it('준 번호 밖의 근거는 버리고 본문의 참조 표기는 지운다 (T-130)', () => {
    const out = checkReport(good({ citations: ['R2', 'R999', '[R1]', 'R2'], lawCitations: ['L1', 'L9'] }), ctx);
    expect(out.answerable).toBe(true);
    expect(out.citations).toEqual(['R2', 'R1']);
    expect(out.lawCitations).toEqual(['L1']);
    expect(out.droppedCitations).toBe(2);
    expect(JSON.stringify(out.blocks)).not.toMatch(/\[R\d+\]/);
  });

  it('근거가 하나도 남지 않으면 답하지 않은 것으로 본다 (T-130)', () => {
    const out = checkReport(good({ citations: ['R7'] }), ctx);
    expect(out).toMatchObject({ answerable: false, blocks: [], citations: [], droppedCitations: 1, problem: 'citations' });
  });

  it('AI 가 답할 수 없다고 하면 칸이 차 있어도 내보내지 않는다 — 형식 미달도 아니다 (T-130)', () => {
    const out = checkReport(good({ answerable: false }), ctx);
    expect(out).toMatchObject({ answerable: false, blocks: [], problem: null });
  });

  it('형식이 깨진 응답도 예외 없이 "답 없음" (T-130)', () => {
    expect(checkReport(null, ctx).answerable).toBe(false);
    expect(checkReport('문자열', ctx).answerable).toBe(false);
    expect(checkReport({ answerable: 'yes', rows: 'x', citations: 3 }, ctx).answerable).toBe(false);
  });
});

describe('받아들일 답 — 형식 미달이면 다음 모델 (T-207)', () => {
  const accept = reportAcceptor(ctx);
  it('제대로 채운 답과 "답할 수 없음"은 받는다 (T-207)', () => {
    expect(accept(good())).toBe(true);
    expect(accept({ answerable: false })).toBe(true);
  });
  it('칸이 빈 답·판단을 알아볼 수 없는 답·객체가 아닌 답은 받지 않는다 (T-207)', () => {
    expect(accept(good({ rows: [] }))).toBe(false);
    expect(accept(good({ rows: [{ area: 'a', law: 'b', current: 'c', verdict: '?', advice: 'd' }] }))).toBe(false);
    expect(accept(null)).toBe(false);
    expect(accept({ answerable: 'yes' })).toBe(false);
  });
  it('준 적 없는 근거만 댄 답은 다음 모델로 다시 받되 마지막 수단으로 남긴다 — 끝내 없으면 "근거 없음"(T-130 동작) (SEARCH-7, T-207)', () => {
    expect(accept(good({ citations: ['R9'] }))).toBe('last-resort');
  });
});

describe('칸 정리 (T-207)', () => {
  it('판단 표기의 흔한 변형을 여섯 값으로 맞춘다 (T-207)', () => {
    for (const v of VERDICTS) expect(normalizeVerdict(v)).toBe(v);
    expect(normalizeVerdict('**보완 필요**')).toBe('보완 필요');
    expect(normalizeVerdict('부적합')).toBe('보완 필요');
    expect(normalizeVerdict('일부 미흡')).toBe('부분 부합');
    expect(normalizeVerdict('대부분 충족')).toBe('대체로 부합');
    expect(normalizeVerdict('확인 필요')).toBe('추가 확인 필요');
    expect(normalizeVerdict('해당 사항 없음')).toBe('해당 없음');
    expect(normalizeVerdict('충족')).toBe('부합');
    expect(normalizeVerdict('')).toBeNull();
    // 부정형은 '부합'(초록)으로 바뀌면 안 된다 — 검토 지적 H2
    for (const neg of [
      '부합하지 않음', '적합하지 않음', '일치하지 않음', '준수하지 않음', '미준수', '미충족', '불충족', '불부합', '대체로 부합하지 않음',
      '충족되지 않음', '부합 아님', '충족하지 못함', '준수하지 못함', '준수 안 함', '충족 안 됨', '부적정', '비준수', '부합한다고 보기 어려움',
    ]) {
      expect(normalizeVerdict(neg), neg).toBe('보완 필요');
    }
    // 판단이 서지 않는 표현은 '추가 확인 필요', 해당하지 않으면 '해당 없음', 위반이 없으면 '부합'(재검토 지적)
    expect(normalizeVerdict('충족 여부 불분명')).toBe('추가 확인 필요');
    expect(normalizeVerdict('해당하지 않음')).toBe('해당 없음');
    expect(normalizeVerdict('적용 대상 아님')).toBe('해당 없음');
    expect(normalizeVerdict('위반 없음')).toBe('부합');
    expect(normalizeVerdict(3)).toBeNull();
  });

  it('굵게는 짝이 맞을 때만 남기고, HTML·제목·코드 표시는 글자에서 지운다 (T-207)', () => {
    expect(cleanInline('핵심은 **세부 절차**다', 100)).toBe('핵심은 **세부 절차**다');
    expect(cleanInline('짝이 **안 맞는 굵게', 100)).toBe('짝이 안 맞는 굵게');
    expect(cleanInline('<script>alert(1)</script>본문 <b>굵게</b>', 100)).toBe('alert(1)본문 굵게');
    expect(cleanInline('## 제목 `코드` *기울임*', 100)).toBe('제목 코드 기울임');
    expect(cleanInline('__굵게__', 100)).toBe('**굵게**');
    expect(cleanInline('표 칸은 **굵게** 없이', 100, false)).toBe('표 칸은 굵게 없이');
  });

  it('길이를 넘기면 자르되 굵게 짝이 깨지면 굵게를 지운다 (T-207)', () => {
    const out = cleanInline(`${'가'.repeat(8)} **굵게 끝`, 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out).not.toContain('*');
  });

  it('법령 칸에서 준 법령 조문 밖의 조 번호는 지우고 법령 이름은 남긴다 (SEARCH-4, T-207)', () => {
    const jo = new Set(['제29조']);
    expect(stripUngroundedJo('개인정보 보호법 제29조', jo)).toBe('개인정보 보호법 제29조');
    expect(stripUngroundedJo('개인정보 보호법 제30조 제1항', jo)).toBe('개인정보 보호법');
    expect(stripUngroundedJo('개인정보 보호법 제29조, 제34조의2', jo)).toBe('개인정보 보호법 제29조');
    expect(stripUngroundedJo('정보통신망법(제48조)', new Set())).toBe('정보통신망법');
    expect(joKeyOf('제34조의2제1항')).toBe('제34조의2');
    // 검토 표에서도 같은 규칙
    const out = checkReport(good(), { ...ctx, lawJo: new Set() });
    const review = out.blocks[1] as { rows: { law: string }[] };
    expect(review.rows[0].law).toBe('개인정보 보호법');
  });

  it('다른 칸에서도 "법령 이름 + 조 번호"는 준 법령 조문 밖이면 조 번호를 지운다 — 회사 규정의 조는 그대로 (SEARCH-4, T-207)', () => {
    const noLaw = { ...ctx, lawJo: new Set<string>() };
    expect(stripLawJoInText('근로기준법 제60조에 따라 15일을 준다', noLaw.lawJo)).toBe('근로기준법에 따라 15일을 준다');
    expect(stripLawJoInText('개인정보 보호법 시행령 제30조 제1항', noLaw.lawJo)).toBe('개인정보 보호법 시행령');
    expect(stripLawJoInText('취업규칙 제5조와 제2조를 고친다', noLaw.lawJo)).toBe('취업규칙 제5조와 제2조를 고친다');
    expect(stripLawJoInText('여비규정 시행규칙 제5조를 고친다', noLaw.lawJo)).toBe('여비규정 시행규칙 제5조를 고친다');
    expect(stripLawJoInText('근로기준법 시행규칙 제15조', noLaw.lawJo)).toBe('근로기준법 시행규칙');
    expect(stripLawJoInText('개인정보 보호법 제29조', new Set(['제29조']))).toBe('개인정보 보호법 제29조');
    const out = checkReport(
      good({ lead: '**근로기준법 제60조** 기준 부합', conclusion: '정보통신망법 제48조를 보라', priorities: [{ title: 'x', detail: '개인정보 보호법 제30조 반영' }] }),
      noLaw,
    );
    const json = JSON.stringify(out.blocks);
    for (const fake of ['제60조', '제48조', '제30조']) expect(json).not.toContain(fake);
  });

  it('AI 에 주는 칸 정의는 strict 모드 조건을 지킨다 — 모든 칸 required, 추가 칸 없음 (T-207)', () => {
    const walk = (s: Record<string, unknown>) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) walk(v);
      }
      if (s.type === 'array') walk(s.items as Record<string, unknown>);
    };
    walk(REPORT_SCHEMA);
  });
});
