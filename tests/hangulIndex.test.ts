import { describe, it, expect } from 'vitest';
import {
  INDEX_KEYS,
  compareKo,
  countByIndexKey,
  indexKeyOf,
  indexKeyOfChar,
} from '../apps/web/src/lib/hangulIndex';

describe('indexKeyOfChar', () => {
  it('한글 음절에서 초성을 뽑는다', () => {
    expect(indexKeyOfChar('가')).toBe('ㄱ');
    expect(indexKeyOfChar('휴')).toBe('ㅎ');
    expect(indexKeyOfChar('인')).toBe('ㅇ');
  });

  it('쌍자음은 기본 자음에 합친다', () => {
    // 나누면 ㄲ 칸이 거의 비어 훑어보는 데 방해만 된다.
    expect(indexKeyOfChar('까')).toBe('ㄱ');
    expect(indexKeyOfChar('따')).toBe('ㄷ');
    expect(indexKeyOfChar('빵')).toBe('ㅂ');
    expect(indexKeyOfChar('싸')).toBe('ㅅ');
    expect(indexKeyOfChar('짜')).toBe('ㅈ');
  });

  it('낱자 자음도 받는다', () => {
    expect(indexKeyOfChar('ㄱ')).toBe('ㄱ');
    expect(indexKeyOfChar('ㄲ')).toBe('ㄱ');
  });

  it('영문은 A-Z, 나머지는 #', () => {
    expect(indexKeyOfChar('A')).toBe('A-Z');
    expect(indexKeyOfChar('z')).toBe('A-Z');
    expect(indexKeyOfChar('3')).toBe('#');
    expect(indexKeyOfChar('※')).toBe('#');
    expect(indexKeyOfChar('')).toBe('#');
  });
});

describe('indexKeyOf — 규정명', () => {
  it('규정명 첫 글자로 판정한다', () => {
    expect(indexKeyOf('인사관리규정')).toBe('ㅇ');
    expect(indexKeyOf('취업규칙')).toBe('ㅊ');
  });

  it('앞의 괄호·따옴표는 건너뛴다', () => {
    expect(indexKeyOf('(구)인사규정')).toBe('ㄱ');
    expect(indexKeyOf('"보안규정"')).toBe('ㅂ');
  });

  it('빈 제목은 #', () => {
    expect(indexKeyOf('')).toBe('#');
    expect(indexKeyOf('   ')).toBe('#');
  });
});

describe('countByIndexKey', () => {
  it('모든 키를 0으로라도 채운다 (빈 칸을 흐리게 그리려면 필요하다)', () => {
    const counts = countByIndexKey([{ t: '인사규정' }], (x) => x.t);
    expect(Object.keys(counts).sort()).toEqual([...INDEX_KEYS].sort());
    expect(counts['ㅇ']).toBe(1);
    expect(counts['ㄱ']).toBe(0);
  });

  it('키별로 센다', () => {
    const items = ['인사규정', '임금규정', '보안규정', 'API 정책', '2026 지침'];
    const counts = countByIndexKey(items, (x) => x);
    expect(counts['ㅇ']).toBe(2);
    expect(counts['ㅂ']).toBe(1);
    expect(counts['A-Z']).toBe(1);
    expect(counts['#']).toBe(1);
  });
});

describe('compareKo', () => {
  it('가나다 순으로 정렬한다', () => {
    expect(['취업규칙', '인사규정', '보안규정'].sort(compareKo)).toEqual([
      '보안규정',
      '인사규정',
      '취업규칙',
    ]);
  });
});
