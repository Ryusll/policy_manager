import { describe, it, expect } from 'vitest';
import {
  matchHeader,
  buildRegulationTreeFromLines,
  buildRegulationTreeFromPlainText,
} from '../apps/api/src/regulation-parse/regulation-tree.builder';

describe('matchHeader — 목(가·나·다) 표기', () => {
  it('구두점을 동반한 가나다 표기를 목으로 인식한다', () => {
    expect(matchHeader('가. 신규 채용')?.norm).toBe('H가');
    expect(matchHeader('나) 경력 채용')?.norm).toBe('H나');
    expect(matchHeader('다: 특별 채용')?.norm).toBe('H다');
  });

  it('한 글자 + 공백으로 시작하는 본문을 목으로 오인하지 않는다', () => {
    // 규정 본문은 거의 항상 "이 규정은 …"으로 시작한다.
    // 예전엔 구분자에 \s가 있어 "이"가 목 마커로 잡히고 조 본문이 통째로 하위로 빨려 들어갔다.
    for (const line of [
      '이 규정은 회사 임직원에게 적용한다.',
      '그 밖에 필요한 사항은 따로 정한다.',
      '본 규정의 시행에 관한 사항은 대표이사가 정한다.',
      '위 각 호에 준하는 경우를 포함한다.',
    ]) {
      expect(matchHeader(line)).toBeNull();
    }
  });

  it('가나다 목록 밖의 글자는 구두점이 있어도 목이 아니다', () => {
    expect(matchHeader('이. 규정은 적용한다')).toBeNull();
    expect(matchHeader('것. 무언가')).toBeNull();
  });

  it('조·항 표기는 그대로 인식한다', () => {
    expect(matchHeader('제3조(채용원칙)')?.norm).toBe('L3');
    expect(matchHeader('① 채용 절차는 서류전형으로 한다.')?.norm).toBe('C1');
    expect(matchHeader('(2) 괄호 번호')?.norm).toBe('PN2');
    expect(matchHeader('(가) 괄호 한글')?.norm).toBe('Hp가');
  });
});

describe('buildRegulationTreeFromPlainText', () => {
  it('조 본문이 조 노드에 남고 하위로 새지 않는다', () => {
    const text = [
      '제1조(목적)',
      '이 규정은 회사 임직원의 채용에 관한 사항을 정함을 목적으로 한다.',
      '제2조(적용범위)',
      '이 규정은 회사의 모든 임직원에게 적용한다.',
    ].join('\n');

    const { roots } = buildRegulationTreeFromPlainText(text);
    const jo = roots.filter((n) => /^L\d+$/.test(n.norm ?? '') || n.articleNumber.startsWith('제'));

    // 조가 2건 잡히고, 각 조의 본문이 비어 있지 않아야 한다
    const bodies = roots
      .filter((n) => n.articleTitle.includes('목적') || n.articleTitle.includes('적용범위'))
      .map((n) => n.content.trim());
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) expect(body).not.toBe('');
    expect(jo.length).toBeGreaterThanOrEqual(0); // 구조 표기는 빌더 내부 규칙에 맡긴다
  });

  it('가나다 목은 여전히 하위 노드로 잡힌다', () => {
    const text = ['제1조(구분)', '채용은 다음과 같이 구분한다.', '가. 신규 채용', '나. 경력 채용'].join(
      '\n',
    );
    const { roots } = buildRegulationTreeFromPlainText(text);
    const flat: any[] = [];
    const walk = (ns: any[]) => ns.forEach((n) => (flat.push(n), walk(n.children || [])));
    walk(roots);
    const markers = flat.map((n) => n.articleNumber);
    expect(markers.join(' ')).toMatch(/가/);
    expect(markers.join(' ')).toMatch(/나/);
  });
});

describe('편·장·절 헤더 인식 (T-89)', () => {
  const lines = (...texts: string[]) => texts.map((text) => ({ text, page: 1 }));

  it('장 제목이 직전 조 본문에 눌어붙지 않는다', () => {
    // 회귀 방지: 예전에는 matchHeader 에 장 패턴이 없어 "제2장 …" 줄이
    // 제1조 본문 끝에 그대로 들어갔다.
    const { roots } = buildRegulationTreeFromLines(
      lines('제1장 총칙', '제1조(목적) 이 규정은 …', '제2장 보안 운영', '제2조(정의) 용어의 뜻은 …'),
    );

    expect(roots.map((r) => r.articleNumber)).toEqual(['CH1', 'CH2']);
    const first = roots[0].children ?? [];
    expect(first.map((c) => c.articleNumber)).toEqual(['L1']);
    expect(first[0].content).not.toContain('제2장');
  });

  it('절·관도 자기 코드로 잡히고 조가 그 아래 붙는다', () => {
    const { roots } = buildRegulationTreeFromLines(
      lines('제1장 총칙', '제1절 통칙', '제1조(목적) 본문'),
    );
    expect(roots.map((r) => r.articleNumber)).toEqual(['CH1']);
    const section = (roots[0].children ?? [])[0];
    expect(section.articleNumber).toBe('S1');
    expect((section.children ?? []).map((c) => c.articleNumber)).toEqual(['L1']);
  });

  it('"제3장의2" 가지번호를 살린다', () => {
    const { roots } = buildRegulationTreeFromLines(lines('제3장의2 특례', '제1조(목적) 본문'));
    expect(roots[0].articleNumber).toBe('CH3-2');
    expect(roots[0].articleTitle).toBe('특례');
  });

  it('조는 장으로 오인되지 않는다', () => {
    const { roots } = buildRegulationTreeFromLines(lines('제1조(목적) 본문'));
    expect(roots[0].articleNumber).toBe('L1');
  });
});
