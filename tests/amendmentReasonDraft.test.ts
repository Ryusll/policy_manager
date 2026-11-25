import { describe, it, expect } from 'vitest';
import { articleSentence, lawBasis, reasonLawOf } from '../apps/api/src/amendments/amendment-reason';
import {
  REASON_DRAFT_RULE,
  REASON_MAX,
  applicationsOf,
  articleReason,
  changesOf,
  draftRecord,
  reasonDraft,
  type ReasonDraftInput,
} from '../apps/api/src/amendments/amendment-reason-draft';
import { reasonSentence, type DocCandidate } from '../apps/api/src/amendments/amendment-document';

/**
 * 개정 이유 초안(T-161, SRS LAW-21) — 승인 화면 '사유 초안 넣기'가 채우는 사실 문장. 승인 때 같은 함수로 다시 만들어 견준다.
 *
 * 막고 싶은 사고:
 * 1. '필요하다'·'늘림' 같은 판단이 승인 기록에 들어간다
 * 2. 회사 변수 값·사람이 고친 곳을 법 개정 때문이라고 적는다(이사회·노사 자료의 거짓 진술) — 근거 번호가 겹침으로 붙은 곳도
 * 3. 승인 사유 상한(500자)을 넘거나 여러 줄이 되어 버튼이 채운 값으로 승인이 막히거나, 고치지 않았는데 '고침'으로 남는다
 * 4. 개정안 문서(T-162)와 앞부분이 달라진다, 판 기록이 없는 옛 변경에 빈 괄호가 남는다, 조사·단위가 뜻을 바꾼다
 */
const LAW = {
  lawName: '남녀고용평등과 일·가정 양립 지원에 관한 법률',
  label: '제18조의3제1항',
  changeType: 'modified' as const,
  promulgatedDate: '2026-05-26',
  lawEffectiveDate: '2026-11-27',
  lawType: '법률',
  promulgationNo: '21700',
};
const ARTICLE = { number: 12, branchNumber: null, clauseNumber: null, itemNumber: null, title: '난임치료휴가' };
const BASIS = '「남녀고용평등과 일·가정 양립 지원에 관한 법률」 제18조의3제1항 개정(법률 제21700호, 2026. 5. 26. 공포, 2026. 11. 27. 시행)에 따라';
const OCCASION = '「남녀고용평등과 일·가정 양립 지원에 관한 법률」 제18조의3제1항 개정(법률 제21700호, 2026. 5. 26. 공포, 2026. 11. 27. 시행)을 계기로';
type Kind = 'replace' | 'insert' | 'delete';
type Change = ReasonDraftInput['changes'][number];
let nextId = 100;
/** 바뀐 곳 하나 — 기본은 법 개정 때문(규칙 근거 + 그 규칙이 낸 문구가 같은 글자), law: false 면 근거 없는 곳(사람·회사 값) */
const ch = (kind: Kind, before: string, after: string, o: { law?: boolean; variable?: boolean } = {}): Change => ({
  kind,
  base: { start: 0, end: before.length, text: before },
  candidate: { start: 0, end: after.length, text: after },
  rationaleRefs: o.law === false ? [] : [nextId++],
  ...(o.variable ? { variableRefs: [1] } : {}),
});
/** 근거 번호마다 그 규칙이 낸 문구 — 기본은 바뀐 글자와 같다 */
const appsOf = (changes: Change[]) => changes.flatMap((c) => c.rationaleRefs.map((id) => ({ id, base: { text: c.base.text }, candidate: { text: c.candidate.text } })));
const draft = (changes: Change[], o: Partial<ReasonDraftInput> = {}) =>
  reasonDraft({ law: LAW, article: ARTICLE, baseContent: '', candidateContent: '연간 4일의 유급 난임치료휴가를 준다.', changes, applications: appsOf(changes), ...o });

describe('개정 이유 초안 (T-161)', () => {
  it('법령 정식 제명·조항·법률 번호·공포일·시행일과 바뀐 글자 쌍 — 사실만, 마침표 없이 (LAW-21)', () => {
    expect(draft([ch('replace', '2일', '4일')])).toBe(`${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로 바꿈`);
  });

  it('판 기록이 없는 옛 변경은 번호 칸만 빠지고, 날짜도 없으면 괄호째 빠진다(빈 괄호 없음)', () => {
    const old = draft([ch('replace', '2일', '4일')], { law: { ...LAW, lawType: null, promulgationNo: null } });
    expect(old).toContain('개정(2026. 5. 26. 공포, 2026. 11. 27. 시행)에 따라');
    const bare = draft([ch('replace', '2일', '4일')], { law: { ...LAW, lawType: null, promulgationNo: null, promulgatedDate: null, lawEffectiveDate: null } });
    expect(bare).toContain('제18조의3제1항 개정에 따라 제12조');
    expect(bare).not.toMatch(/\(\)|\(,|, \)/);
  });

  it('바꿈이 이어지면 한 동사로, 추가·삭제는 저마다 — 본문 순서대로', () => {
    expect(draft([ch('replace', '2일', '4일'), ch('replace', '무급', '유급')])).toBe(`${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로, ‘무급’을 ‘유급’으로 바꿈`);
    expect(draft([ch('replace', '2일', '4일'), ch('insert', '', '매년'), ch('delete', '무급', '')])).toBe(
      `${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로 바꿈, ‘매년’을 추가함, ‘무급’을 삭제함`,
    );
  });

  it('조사는 인용한 글자 끝의 받침으로 — ㄹ 받침은 로, 숫자는 끝자리 소리로, 낫표·따옴표는 건너뛰고 괄호면 괄호 앞 낱말로', () => {
    const one = (b: string, a: string) => draft([ch('replace', b, a)]).split(' 중 ')[1];
    expect(one('근로자', '노동자')).toBe('‘근로자’를 ‘노동자’로 바꿈');
    expect(one('휴가', '휴직')).toBe('‘휴가’를 ‘휴직’으로 바꿈');
    expect(one('3개월', '6개월')).toBe('‘3개월’을 ‘6개월’로 바꿈');
    expect(one('15', '20')).toBe('‘15’를 ‘20’으로 바꿈');
    expect(one('11', '13')).toBe('‘11’을 ‘13’으로 바꿈');
    expect(one('17', '18')).toBe('‘17’을 ‘18’로 바꿈');
    expect(one('10%', '20%')).toBe('‘10%’를 ‘20%’로 바꿈');
    expect(one('「근로기준법」', '「노동기준법」')).toBe('‘「근로기준법」’을 ‘「노동기준법」’으로 바꿈');
    expect(one('휴가(연 4일)', '유급(연 4일)')).toBe('‘휴가(연 4일)’를 ‘유급(연 4일)’으로 바꿈');
    expect(one('수당(시간외(연장) 근로)', '휴가')).toBe('‘수당(시간외(연장) 근로)’을 ‘휴가’로 바꿈'); // 겹친 괄호는 바깥 괄호 앞 낱말
    expect(draft([ch('insert', '', '다만, 회사가 정하는 바에 따름.')]).split(' 중 ')[1]).toBe('‘다만, 회사가 정하는 바에 따름.’을 추가함'); // 끝 마침표는 건너뛴다
  });

  it('법 개정 때문인 곳만 "에 따라" 뒤에 — 근거 없는 곳·회사 변수 값과 섞인 곳·규칙 문구 밖 글자는 "그 밖에 N곳을 고침"으로 따로', () => {
    expect(draft([ch('replace', '2일', '4일'), ch('replace', '연간', '매년', { law: false })])).toBe(`${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로 바꿈. 그 밖에 1곳을 고침`);
    // 규칙 근거와 회사 변수 값이 한 구간에 붙었다(구간 합치기) — 회사 값까지 법 탓으로 적지 않는다
    expect(draft([ch('replace', '2일', '4일'), ch('replace', '15일', '20일', { variable: true })])).toContain('‘2일’을 ‘4일’로 바꿈. 그 밖에 1곳을 고침');
    // 규칙 구간 끝에 사람이 붙여 넣은 삽입 — 근거 번호는 경계 겹침으로 붙었지만 그 규칙이 낸 문구가 아니다
    const rule = ch('replace', '2일', '4일');
    const pasted = { ...ch('insert', '', '(파견 포함)'), rationaleRefs: [...rule.rationaleRefs] };
    expect(draft([rule, pasted], { applications: appsOf([rule]) })).toBe(`${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로 바꿈. 그 밖에 1곳을 고침`);
    // 근거 번호의 규칙 적용이 없으면(옛 후보) 법 탓으로 세지 않는다
    expect(draft([ch('replace', '2일', '4일')], { applications: [] })).toBe(`${OCCASION} 제12조(난임치료휴가) 중 1곳을 고침`);
  });

  it('법 개정 때문인 곳이 없으면 "에 따라" 대신 계기만 — "…개정(…)을 계기로 제12조(…) 중 N곳을 고침"(회사 값을 법 탓으로 적지 않는다)', () => {
    const none = draft([ch('replace', '연간', '매년', { law: false }), ch('replace', '3', '5', { law: false, variable: true })]);
    expect(none).toBe(`${OCCASION} 제12조(난임치료휴가) 중 2곳을 고침`);
    expect(none).not.toContain('에 따라');
    expect(draft([ch('replace', '연간', '매년', { law: false })], { law: { ...LAW, changeType: 'deleted' } })).toContain('제18조의3제1항 삭제(법률 제21700호, 2026. 5. 26. 공포, 2026. 11. 27. 시행)를 계기로');
  });

  it('조문을 지우면 — 법 개정 때문이면 "에 따라 …를 삭제함", 아니면 "을 계기로 …를 삭제함". 변경 정보가 없으면 개정안 문서와 같은 조문 단위 문장', () => {
    expect(draft([ch('delete', '연간 2일', '')], { candidateContent: '  ' })).toBe(`${BASIS} 제12조를 삭제함`);
    expect(draft([ch('delete', '연간 2일', '', { law: false })], { candidateContent: '' })).toBe(`${OCCASION} 제12조를 삭제함`);
    expect(draft([])).toBe(`${BASIS} 제12조를 바꿈`);
    expect(draft([ch('replace', '2일', '4일'), ch('replace', ' ', '\n')])).toBe(`${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로 바꿈`); // 공백만 바뀐 곳은 넣지 않는다
  });

  it('숫자만 바뀐 곳은 양쪽 뒤의 같은 단위를 붙여 인용한다 — "‘2’를 ‘4’로"가 아니라 "‘2일’을 ‘4일’로"(값 규칙은 숫자만 바꾼다)', () => {
    const base = '근로자는 연간 2일의 유급휴가를 쓸 수 있고 3개월 안에 쓴다.';
    const cand = '근로자는 연간 4일의 유급휴가를 쓸 수 있고 6개월 안에 쓴다.';
    const at = (b: string, a: string, bAt = base.indexOf(b), cAt = cand.indexOf(a)): Change => ({
      kind: 'replace',
      base: { start: bAt, end: bAt + b.length, text: b },
      candidate: { start: cAt, end: cAt + a.length, text: a },
      rationaleRefs: [nextId++],
    });
    const body = (changes: Change[], b = base, c = cand) => reasonDraft({ law: LAW, article: ARTICLE, baseContent: b, candidateContent: c, changes, applications: appsOf(changes) });
    expect(body([at('2', '4'), at('3', '6')])).toBe(`${BASIS} 제12조(난임치료휴가) 중 ‘2일’을 ‘4일’로, ‘3개월’을 ‘6개월’로 바꿈`);
    // 위치가 본문과 맞지 않거나(옛 후보 — 그 자리 뒤에 단위가 있어도), 뒤의 단위가 서로 다르거나, 숫자가 아니면 그대로
    expect(body([at('5', '4', 8, 8)])).toContain('‘5’를 ‘4’로 바꿈');
    expect(body([at('2', '4', 3, 3)], '연간 2일', '연간 4회')).toContain('‘2’를 ‘4’로 바꿈');
    expect(body([at('십', '이십', 3, 3)], '연간 십일', '연간 이십일')).toContain('‘십’을 ‘이십’으로 바꿈');
    // 단위가 낱말의 일부면 붙이지 않는다 — 분수·주택·분기·세대
    expect(body([at('2', '3', 4, 4)], '임금의 2분의 1', '임금의 3분의 1')).toContain('‘2’를 ‘3’으로 바꿈');
    expect(body([at('1', '2', 0, 0)], '1주택 보유', '2주택 보유')).toContain('‘1’을 ‘2’로 바꿈');
    expect(body([at('3', '4', 0, 0)], '3분기 말', '4분기 말')).toContain('‘3’을 ‘4’로 바꿈');
    expect(body([at('5', '6', 0, 0)], '5세대 이상', '6세대 이상')).toContain('‘5’를 ‘6’으로 바꿈');
    expect(body([at('3', '4', 0, 0)], '3주 동안', '4주택 동안')).toContain('‘3’을 ‘4’로 바꿈'); // 한쪽만 단위여도 붙이지 않는다
    expect(body([at('50', '60', 0, 0)], '50초과 근무', '60초과 근무')).toContain('‘50’을 ‘60’으로 바꿈'); // "초과"는 초 단위가 아니다
    // 조사·띄어쓰기가 이어지면 단위다
    expect(body([at('30', '60', 0, 0)], '30일간 쉰다', '60일간 쉰다')).toContain('‘30일’을 ‘60일’로 바꿈');
    expect(body([at('5', '6', 0, 0)], '5세 이상', '6세 이상')).toContain('‘5세’를 ‘6세’로 바꿈');
  });

  it('곳이 많으면 수와 보기 세 곳만 — "N곳을 바꿈(‘전’→‘후’ … 등)", 종류가 섞이면 "고침"', () => {
    const four = [ch('replace', '2일', '4일'), ch('replace', '무급', '유급'), ch('replace', '1회', '2회'), ch('replace', '30일', '60일')];
    expect(draft(four)).toBe(`${BASIS} 제12조(난임치료휴가) 중 4곳을 바꿈(‘2일’→‘4일’, ‘무급’→‘유급’, ‘1회’→‘2회’ 등)`);
    expect(draft([...four.slice(0, 3), ch('insert', '', '매년')])).toContain('중 4곳을 고침(');
  });

  it('500자 이하 한 줄 — 긴 인용은 40자로 줄이고(조사는 원래 끝 글자로, 앞이 같으면 뒷부분을), 줄바꿈은 어디서 와도 한 줄로', () => {
    const long = 'ㄱ'.repeat(10) + '가'.repeat(60) + '\n둘째 줄 일';
    const s = draft([ch('replace', long, `${long}이`), ch('replace', '2일', '4일')]);
    expect(s.length).toBeLessThanOrEqual(REASON_MAX);
    expect(s).not.toContain('\n');
    const [, quotes] = s.split(' 중 ');
    const [q1, q2] = quotes.match(/‘[^’]*’/g) ?? [];
    expect(q1).not.toBe(q2); // 앞 39자가 같아도 똑같아 보이지 않게 — 달라진 뒷부분을 보인다
    expect(q1.startsWith('‘…')).toBe(true);
    expect(draft([ch('replace', '연간\n 2일', '연간\t4일')])).toContain('‘연간 2일’을 ‘연간 4일’로 바꿈');
    expect(draft([ch('replace', '2일', '4일')], { article: { ...ARTICLE, title: '난임\r\n치료휴가' } })).toContain('제12조(난임 치료휴가) 중');
    const many = Array.from({ length: 12 }, (_, i) => ch('replace', `${'긴문구'.repeat(20)}${i}`, `${'바뀐문구'.repeat(15)}${i}`));
    const m = draft(many, { law: { ...LAW, lawName: '아주 긴 법령 이름'.repeat(8) } });
    expect(m.length).toBeLessThanOrEqual(REASON_MAX);
    expect(m).toContain('12곳을 바꿈(');
    expect(m).toContain(' 등)');
    // 보기 한 곳도 못 넣을 만큼 길면 조문 단위로 줄이되, 법 개정 탓이 아닌 곳의 수는 남긴다
    const tight = draft([ch('replace', '가'.repeat(45), '나'.repeat(45)), ch('replace', '연간', '매년', { law: false })], { law: { ...LAW, lawName: '법'.repeat(380) } });
    expect(tight.endsWith('에 따라 제12조를 바꿈. 그 밖에 1곳을 고침')).toBe(true);
    expect(tight.length).toBeLessThanOrEqual(REASON_MAX);
    const huge = draft([ch('replace', '2일', '4일')], { law: { ...LAW, lawName: '법'.repeat(600) } });
    expect(huge.length).toBe(REASON_MAX);
    expect(huge.endsWith('…')).toBe(true);
  });

  it('판단·증감 표현은 어느 입력에서도 나오지 않는다 (LAW-21, LAW-5)', () => {
    const inputs = [
      draft([ch('replace', '2일', '4일')]),
      draft([ch('replace', '4일', '2일')]),
      draft([ch('insert', '', '매년'), ch('delete', '무급', '')]),
      draft([ch('replace', '연간', '매년', { law: false })]),
      draft([], { candidateContent: '' }),
      draft(Array.from({ length: 5 }, (_, i) => ch('replace', `${i}일`, `${i + 1}일`))),
    ];
    for (const s of inputs) expect(s).not.toMatch(/필요|위반|미달|해야|권고|늘림|늘려|줄임|줄여|상향|하향|완화|강화|유리|불리|확대|축소/);
  });

  it('개정안 문서의 개정 이유 한 줄도 같은 판정 — 법 개정 때문인 곳이 없으면 "을 계기로", 있으면 "에 따라"(섞였으면 그 밖에 N곳), 변경 정보가 없으면 예전 문장', () => {
    const line = (changes: Change[], o: Partial<ReasonDraftInput> = {}) =>
      articleReason({ law: LAW, article: ARTICLE, baseContent: '', candidateContent: '연간 4일', changes, applications: appsOf(changes), ...o });
    expect(line([ch('replace', '2일', '4일')])).toBe(`${BASIS} 제12조를 바꿈`);
    expect(line([ch('replace', '2일', '4일'), ch('replace', '연간', '매년', { law: false })])).toBe(`${BASIS} 제12조를 바꿈. 그 밖에 1곳을 고침`);
    expect(line([ch('replace', '3', '5', { law: false, variable: true })])).toBe(`${OCCASION} 제12조를 바꿈`);
    expect(line([ch('delete', '연간 2일', '', { law: false })], { candidateContent: '' })).toBe(`${OCCASION} 제12조를 삭제함`);
    expect(line([])).toBe(`${BASIS} 제12조를 바꿈`);
  });

  it('앞부분은 개정안 문서의 개정 이유와 같은 함수 — 변경 정보가 없으면 문장 전체가 같다(T-162)', () => {
    const doc: DocCandidate = {
      id: 'c1',
      reviewState: 'review',
      revision: 1,
      baseContent: '연간 2일',
      candidateContent: '연간 4일',
      plannedEffectiveDate: null,
      article: ARTICLE,
      law: { eventId: 'e1', ...LAW, beforeContent: null, afterContent: null },
      approvedNote: null,
    };
    expect(reasonSentence(doc).startsWith(lawBasis(LAW))).toBe(true);
    expect(draft([ch('replace', '2일', '4일')]).startsWith(lawBasis(LAW))).toBe(true);
    expect(draft([])).toBe(reasonSentence(doc));
    expect(articleSentence(LAW, ARTICLE, true)).toBe(reasonSentence({ ...doc, candidateContent: '' }));
  });

  it('승인 기록 — 앞뒤 공백만 다르면 같은 것(초안 글은 사유와 같아 다시 쓰지 않는다), 한 글자라도 다르면 고친 것(견준 초안 글을 남긴다)', () => {
    const d = draft([ch('replace', '2일', '4일')]);
    expect(draftRecord(`  ${d}\n`, d)).toEqual({ matches: true, rule: REASON_DRAFT_RULE });
    expect(draftRecord(d.replace('4일', '5일'), d)).toEqual({ matches: false, draft: d, rule: REASON_DRAFT_RULE });
    expect(draftRecord(`${d}.`, d).matches).toBe(false);
  });

  it('저장된 diff·근거에서 변경 목록과 규칙 적용 — 모양이 맞지 않는 옛 항목은 버린다', () => {
    expect(changesOf(null)).toEqual([]);
    expect(changesOf({ parts: [] })).toEqual([]);
    const good = ch('replace', '2일', '4일');
    expect(changesOf({ changes: [good, { kind: 'replace' }, null, { kind: 'insert', base: { text: '' }, candidate: {} }] })).toEqual([good]);
    const app = { id: 1, ruleId: 'r', base: { start: 0, end: 2, text: '2일' }, candidate: { start: 0, end: 2, text: '4일' } };
    expect(applicationsOf({ applications: [app, { id: 'x', base: { text: '' }, candidate: { text: '' } }, null] })).toEqual([app]);
    expect(applicationsOf(null)).toEqual([]);
  });

  it('변경 이벤트 행 → 법령 칸 — 날짜는 YYYY-MM-DD, 조항 표기가 끊겼으면 nodeKey 로, 판 기록이 없으면 번호 null', () => {
    const row = {
      law: { lawName: LAW.lawName },
      lawArticle: null,
      nodeKey: '18의3/1/',
      changeType: 'modified' as const,
      promulgatedDate: new Date('2026-05-26T00:00:00Z'),
      lawEffectiveDate: new Date('2026-11-27T00:00:00Z'),
      lawVersion: null,
    };
    expect(reasonLawOf(row)).toEqual({ ...LAW, label: '제18조의3제1항', lawType: null, promulgationNo: null });
    expect(reasonLawOf({ ...row, lawArticle: { label: '제18조의3제1항' }, lawVersion: { lawType: '법률', promulgationNo: '21700' } })).toEqual(LAW);
  });
});
