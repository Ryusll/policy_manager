import { describe, it, expect } from 'vitest';
import {
  buildTreeFromJoUnits,
  circledToNumber,
  mapLawDetail,
  mapSearchItem,
  toIsoDate,
} from '../apps/api/src/lawgokr/lawgokr.mapper';
import type { LawGoKrJoUnit } from '../apps/api/src/lawgokr/lawgokr.types';

/**
 * 픽스처는 자동차관리법(MST=286989) 실응답에서 그대로 발췌·축약한 것이다.
 * 값 모양(정렬용 선행 공백, 내용에 박힌 번호 접두어, 항이 객체/배열로 오락가락하는 것)을
 * 손대지 않은 이유는 그 변형들이 바로 매퍼가 감당해야 할 대상이기 때문이다.
 */
const 장제목: LawGoKrJoUnit = {
  조문번호: '1',
  조문여부: '전문',
  조문내용: '            제1장 총칙 <개정 2009.2.6>',
};

const 조1_항없음: LawGoKrJoUnit = {
  조문번호: '1',
  조문여부: '조문',
  조문제목: '목적',
  조문내용: '제1조(목적) 이 법은 자동차의 등록, 안전기준에 관한 사항을 정함을 목적으로 한다.',
};

const 조3_항배열: LawGoKrJoUnit = {
  조문번호: '3',
  조문여부: '조문',
  조문제목: '자동차의 종류',
  조문내용: '제3조(자동차의 종류)',
  항: [
    {
      항번호: '①',
      항내용: '① 자동차는 다음 각 호와 같이 구분한다. <개정 2011.5.24>',
      호: [
        { 호번호: '1.', 호내용: '1. 승용자동차' },
        { 호번호: '1.', 호가지번호: '2', 호내용: '1의2. 특수용도형 승용자동차' },
        {
          호번호: '2.',
          호내용: '2. 승합자동차. 다만, 다음 각 목으로 분류한다.',
          목: [
            { 목번호: '가.', 목내용: '가. 소형 승합자동차' },
            { 목번호: '나.', 목내용: '나. 대형 승합자동차' },
          ],
        },
      ],
    },
    { 항번호: '②', 항내용: '② 세부기준은 국토교통부령으로 정한다.' },
  ],
};

// 항이 1건이면 배열이 아니라 객체로 온다 — 실응답에서 19건이 이 모양이었다.
const 조4의2_항객체: LawGoKrJoUnit = {
  조문번호: '4',
  조문가지번호: '2',
  조문여부: '조문',
  조문제목: '자동차정책기본계획의 수립',
  조문내용: '제4조의2(자동차정책기본계획의 수립)',
  항: {
    항번호: '①',
    항내용: '① 국토교통부장관은 5년마다 기본계획을 수립하여야 한다.',
  },
};

describe('buildTreeFromJoUnits — 편·장·절 계층', () => {
  it('장 제목 행을 조의 부모로 세운다', () => {
    const { roots } = buildTreeFromJoUnits([장제목, 조1_항없음]);
    expect(roots).toHaveLength(1);
    expect(roots[0].articleNumber).toBe('CH1');
    expect(roots[0].articleTitle).toBe('총칙');
    expect(roots[0].children?.[0].articleNumber).toBe('L1');
    expect(roots[0].children?.[0].depth).toBe(1);
  });

  it('장 제목의 조문번호(그 장 첫 조의 번호)를 장 번호로 오인하지 않는다', () => {
    // "제2장 …" 행의 조문번호는 5(그 장의 첫 조)로 오지만 장 번호는 2다.
    const 제2장: LawGoKrJoUnit = {
      조문번호: '5',
      조문여부: '전문',
      조문내용: '            제2장 자동차의 등록 <개정 2009.2.6>',
    };
    const { roots } = buildTreeFromJoUnits([제2장]);
    expect(roots[0].articleNumber).toBe('CH2');
  });

  it('"제3장의2" 같은 가지 장을 표현한다', () => {
    const 가지장: LawGoKrJoUnit = {
      조문번호: '35',
      조문가지번호: '2',
      조문여부: '전문',
      조문내용: '            제3장의2 저속전기자동차에 대한 특례 <신설 2009.12.29>',
    };
    const { roots } = buildTreeFromJoUnits([가지장]);
    expect(roots[0].articleNumber).toBe('CH3-2');
    expect(roots[0].articleTitle).toBe('저속전기자동차에 대한 특례');
  });

  it('절은 장 아래로, 다음 장이 열리면 절 스택이 닫힌다', () => {
    const units: LawGoKrJoUnit[] = [
      장제목,
      { 조문번호: '2', 조문여부: '전문', 조문내용: '   제1절 통칙' },
      조1_항없음,
      { 조문번호: '9', 조문여부: '전문', 조문내용: '   제2장 등록' },
      { 조문번호: '9', 조문여부: '조문', 조문제목: '등록', 조문내용: '제9조(등록) 등록하여야 한다.' },
    ];
    const { roots } = buildTreeFromJoUnits(units);
    expect(roots.map((r) => r.articleNumber)).toEqual(['CH1', 'CH2']);
    const 절 = roots[0].children?.[0];
    expect(절?.articleNumber).toBe('S1');
    expect(절?.children?.[0].articleNumber).toBe('L1');
    // 제9조는 제1절이 아니라 제2장 직속이어야 한다
    expect(roots[1].children?.[0].articleNumber).toBe('L9');
    expect(roots[1].children?.[0].depth).toBe(1);
  });
});

describe('buildTreeFromJoUnits — 조·항·호·목', () => {
  it('항이 없는 조는 조문내용에서 "제1조(목적)" 머리말을 뗀 본문만 남긴다', () => {
    const { roots } = buildTreeFromJoUnits([조1_항없음]);
    expect(roots[0].content).toBe(
      '이 법은 자동차의 등록, 안전기준에 관한 사항을 정함을 목적으로 한다.',
    );
    expect(roots[0].articleTitle).toBe('목적');
  });

  it('항·호·목을 4단계로 중첩하고 번호 접두어를 뗀다', () => {
    const { roots } = buildTreeFromJoUnits([조3_항배열]);
    const 조 = roots[0];
    expect(조.articleNumber).toBe('L3');
    // 항이 있는 조는 조문내용이 제목뿐이라 본문이 비어야 한다
    expect(조.content).toBe('');

    const 항1 = 조.children?.[0];
    expect(항1?.articleNumber).toBe('C1');
    expect(항1?.content).toBe('자동차는 다음 각 호와 같이 구분한다. <개정 2011.5.24>');
    expect(조.children?.[1].articleNumber).toBe('C2');

    const 호들 = 항1?.children || [];
    expect(호들.map((h) => h.articleNumber)).toEqual(['1', '1.2', '2']);
    expect(호들[0].content).toBe('승용자동차');
    expect(호들[1].articleTitle).toBe('제1의2호');
    expect(호들[1].content).toBe('특수용도형 승용자동차');

    const 목들 = 호들[2].children || [];
    expect(목들.map((m) => m.articleNumber)).toEqual(['H가', 'H나']);
    expect(목들[0].content).toBe('소형 승합자동차');
    // 이 픽스처엔 장 제목이 없어 조가 곧 루트다: 조 0 · 항 1 · 호 2 · 목 3
    expect(목들[0].depth).toBe(3);
  });

  it('항이 배열이 아니라 객체 1건으로 와도 같게 처리한다', () => {
    const { roots } = buildTreeFromJoUnits([조4의2_항객체]);
    expect(roots[0].articleNumber).toBe('L4-2');
    expect(roots[0].articleTitle).toBe('자동차정책기본계획의 수립');
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children?.[0].articleNumber).toBe('C1');
  });

  it('항번호 없는 단일 항은 새 노드를 만들지 않고 조 본문에 합친다', () => {
    const unit: LawGoKrJoUnit = {
      조문번호: '7',
      조문여부: '조문',
      조문제목: '적용범위',
      조문내용: '제7조(적용범위)',
      항: { 항내용: '이 법은 모든 자동차에 적용한다.', 호: [{ 호번호: '1.', 호내용: '1. 승용차' }] },
    };
    const { roots } = buildTreeFromJoUnits([unit]);
    expect(roots[0].content).toBe('이 법은 모든 자동차에 적용한다.');
    // 호는 조의 직속 자식으로 올라온다
    expect(roots[0].children?.[0].articleNumber).toBe('1');
  });

  it('"가"로 시작하는 본문을 목 번호로 오인해 깎지 않는다', () => {
    // 접두어는 목번호와 정확히 일치할 때만 제거한다.
    const unit: LawGoKrJoUnit = {
      조문번호: '8',
      조문여부: '조문',
      조문내용: '제8조(정의)',
      항: {
        항번호: '①',
        항내용: '① 정의는 다음과 같다.',
        호: [{ 호번호: '1.', 호내용: '1. 가스자동차란 가스를 연료로 하는 자동차를 말한다.' }],
      },
    };
    const { roots } = buildTreeFromJoUnits([unit]);
    const 호 = roots[0].children?.[0].children?.[0];
    expect(호?.content).toBe('가스자동차란 가스를 연료로 하는 자동차를 말한다.');
  });

  it('sortOrder가 문서 순서(선위 순회)를 따른다 — 커밋이 이 순서로 조문을 만든다', () => {
    const { roots } = buildTreeFromJoUnits([장제목, 조3_항배열]);
    const flat: { articleNumber: string; sortOrder: number }[] = [];
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        flat.push({ articleNumber: n.articleNumber, sortOrder: n.sortOrder });
        if (n.children?.length) walk(n.children);
      }
    };
    walk(roots);
    expect(flat.map((f) => f.sortOrder)).toEqual([...flat.keys()]);
    expect(flat.map((f) => f.articleNumber)).toEqual([
      'CH1', 'L3', 'C1', '1', '1.2', '2', 'H가', 'H나', 'C2',
    ]);
  });

  it('parentId가 실제 부모의 id를 가리킨다', () => {
    const { roots } = buildTreeFromJoUnits([장제목, 조1_항없음]);
    expect(roots[0].parentId).toBeNull();
    expect(roots[0].children?.[0].parentId).toBe(roots[0].id);
  });
});

describe('메타·값 변환', () => {
  it('YYYYMMDD를 ISO 날짜로 바꾸고, 형식이 다르면 null', () => {
    expect(toIsoDate('20261217')).toBe('2026-12-17');
    expect(toIsoDate(20090206)).toBe('2009-02-06');
    expect(toIsoDate('2026-12-17')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('20261317')).toBeNull();
  });

  it('원문자 항번호를 숫자로 바꾼다', () => {
    expect(circledToNumber('①')).toBe(1);
    expect(circledToNumber('⑬')).toBe(13);
    expect(circledToNumber('3')).toBe(3);
    expect(circledToNumber('')).toBeNull();
  });

  it('기본정보의 객체형 필드(소관부처·법종구분)에서 content를 꺼낸다', () => {
    const { meta } = mapLawDetail(
      {
        기본정보: {
          법령명_한글: '자동차관리법',
          법령ID: '001747',
          공포일자: '20260616',
          공포번호: '21817',
          시행일자: '20261217',
          제개정구분: '일부개정',
          소관부처: { content: '국토교통부', 소관부처코드: '1613000' },
          법종구분: { content: '법률', 법종구분코드: 'A0002' },
        },
        제개정이유: { 제개정이유내용: [['[일부개정]', '◇ 개정이유']] },
        조문: { 조문단위: [조1_항없음] },
      },
      '286989',
    );
    expect(meta.title).toBe('자동차관리법');
    expect(meta.ministry).toBe('국토교통부');
    expect(meta.lawType).toBe('법률');
    expect(meta.effectiveDate).toBe('2026-12-17');
    expect(meta.revisionReason).toBe('[일부개정]\n◇ 개정이유');
    expect(meta.amendmentText).toBeNull();
    expect(meta.sourceUrl).toContain('MST=286989');
  });

  it('검색 결과를 정규화한다', () => {
    const item = mapSearchItem({
      현행연혁코드: '현행',
      법령일련번호: '286989',
      법령명한글: '자동차관리법',
      법령구분명: '법률',
      소관부처명: '국토교통부',
      공포번호: '21817',
      제개정구분명: '일부개정',
      법령ID: '001747',
      공포일자: '20260616',
      시행일자: '20261217',
    });
    expect(item.mst).toBe('286989');
    expect(item.lawId).toBe('001747');
    expect(item.promulgationDate).toBe('2026-06-16');
    expect(item.status).toBe('현행');
    expect(item.shortTitle).toBeNull();
  });
});
