import { describe, it, expect } from 'vitest';
import {
  renumberChapters,
  expandChaptersWithHierarchy,
} from '../apps/web/src/lib/policyImportHierarchy';

const ch = (number: number, title: string, articles: any[]) => ({ number, title, articles });
const art = (number: number, title: string, content = '본문') => ({ number, title, content });

describe('renumberChapters — 조 번호는 장을 가로질러 이어진다', () => {
  it('제1장이 제1·2조면 제2장은 제3조부터다', () => {
    // 대표님 화면 제보(2026-08-01)의 재발 방지. 장마다 1로 리셋되면
    // 목차에 "제1조"가 여러 번 나와 조문을 특정할 수 없다.
    const out = renumberChapters([
      ch(1, '총칙', [art(1, '목적'), art(2, '적용범위')]),
      ch(2, '보안 운영', [art(1, '계정 및 접근권한 관리'), art(2, '보안사고 대응')]),
    ]);

    expect(out.map((c) => c.number)).toEqual([1, 2]);
    expect(out.flatMap((c) => c.articles.map((a) => a.number))).toEqual([1, 2, 3, 4]);
  });

  it('장 번호는 원본이 비어 있거나 튀어도 1부터 다시 매긴다', () => {
    const out = renumberChapters([
      ch(7, '가', [art(3, '가1')]),
      ch(0, '나', [art(9, '나1')]),
    ]);
    expect(out.map((c) => c.number)).toEqual([1, 2]);
    expect(out.flatMap((c) => c.articles.map((a) => a.number))).toEqual([1, 2]);
  });

  it('빈 조를 걷어낸 뒤에 부르면 번호에 구멍이 없다', () => {
    // 순서가 뒤집히면(재번호 → 제거) 1, 2, 4 처럼 구멍이 남는다.
    const trimmed = [ch(1, '총칙', [art(1, '목적'), art(2, '', ''), art(3, '적용범위')])]
      .map((c) => ({
        ...c,
        articles: c.articles.filter((a) => a.title.trim() || a.content.trim()),
      }));

    const out = renumberChapters(trimmed);
    expect(out[0].articles.map((a) => a.number)).toEqual([1, 2]);
    expect(out[0].articles.map((a) => a.title)).toEqual(['목적', '적용범위']);
  });

  it('번호 외의 필드는 건드리지 않는다', () => {
    const out = renumberChapters([
      { number: 3, title: '총칙', auto: true, articles: [{ number: 9, title: '목적', content: '본문', clauseNumber: 1 }] },
    ]);
    expect(out[0]).toMatchObject({ number: 1, title: '총칙', auto: true });
    expect(out[0].articles[0]).toMatchObject({ number: 1, title: '목적', content: '본문', clauseNumber: 1 });
  });

  it('항·목 추론보다 앞에 불러야 추론이 확정된 조 번호를 쓴다', () => {
    const renumbered = renumberChapters([
      ch(1, '총칙', [art(1, '목적', '① 첫째 항\n② 둘째 항')]),
      ch(2, '운영', [art(1, '적용범위', '본문')]),
    ]);
    const expanded = expandChaptersWithHierarchy(renumbered);

    // 제1장 제1조가 조 루트 + 항 2개로 펴져도 조 번호는 1로 유지되고,
    // 제2장 첫 조는 2번을 그대로 물려받는다.
    expect(expanded[0].articles.map((a) => [a.number, a.clauseNumber ?? null]))
      .toEqual([[1, null], [1, 1], [1, 2]]);
    expect(expanded[1].articles.map((a) => a.number)).toEqual([2]);
  });
});
