import { describe, it, expect } from 'vitest';
import {
  articleHash,
  findByAnchor,
  formatArticleAnchor,
  parseArticleAnchor,
  parseLegacyArticleId,
} from '../apps/web/src/lib/articleAnchor';

const a = (number: number, clauseNumber: number | null = null, itemNumber: number | null = null) => ({
  number,
  clauseNumber,
  itemNumber,
});

describe('formatArticleAnchor', () => {
  it('조·항·목을 사람이 인용하는 그대로 만든다', () => {
    expect(formatArticleAnchor(a(3))).toBe('제3조');
    expect(formatArticleAnchor(a(3, 1))).toBe('제3조제1항');
    expect(formatArticleAnchor(a(3, 1, 2))).toBe('제3조제1항제2목');
  });

  it('해시는 # 를 붙인다', () => {
    expect(articleHash(a(12))).toBe('#제12조');
  });
});

describe('parseArticleAnchor', () => {
  it('한글 해시를 읽는다', () => {
    expect(parseArticleAnchor({ hash: '#제3조' })).toEqual({ jo: 3, hang: null, mok: null });
    expect(parseArticleAnchor({ hash: '제3조제1항' })).toEqual({ jo: 3, hang: 1, mok: null });
    expect(parseArticleAnchor({ hash: '#제3조제1항제2목' })).toEqual({ jo: 3, hang: 1, mok: 2 });
  });

  it('퍼센트 인코딩된 해시도 읽는다', () => {
    // 브라우저가 주소창에서 한글을 인코딩해 넘긴다.
    expect(parseArticleAnchor({ hash: '#' + encodeURIComponent('제3조제1항') })).toEqual({
      jo: 3,
      hang: 1,
      mok: null,
    });
  });

  it('공백이 섞여도 읽는다', () => {
    expect(parseArticleAnchor({ hash: '#제 3 조 제 1 항' })).toEqual({ jo: 3, hang: 1, mok: null });
  });

  it('쿼리 형식을 읽는다', () => {
    expect(parseArticleAnchor({ search: '?jo=3&hang=1&mok=2' })).toEqual({ jo: 3, hang: 1, mok: 2 });
    expect(parseArticleAnchor({ search: 'jo=5' })).toEqual({ jo: 5, hang: null, mok: null });
  });

  it('해시가 우선한다', () => {
    expect(parseArticleAnchor({ hash: '#제9조', search: '?jo=1' })).toEqual({
      jo: 9,
      hang: null,
      mok: null,
    });
  });

  it('읽을 수 없으면 null', () => {
    expect(parseArticleAnchor({ hash: '#article-uuid-1234' })).toBeNull();
    expect(parseArticleAnchor({ hash: '', search: '' })).toBeNull();
    expect(parseArticleAnchor({ search: '?jo=0' })).toBeNull();
    expect(parseArticleAnchor({ search: '?jo=abc' })).toBeNull();
  });
});

describe('parseLegacyArticleId — 이미 나간 링크를 깨뜨리지 않는다', () => {
  it('옛 형식에서 id 를 꺼낸다', () => {
    expect(parseLegacyArticleId('#article-abc-123')).toBe('abc-123');
  });
  it('새 형식에는 반응하지 않는다', () => {
    expect(parseLegacyArticleId('#제3조')).toBeNull();
  });
});

describe('findByAnchor', () => {
  const articles = [a(1), a(3), a(3, 1), a(3, 1, 1), a(3, 2), a(5)];

  it('정확히 일치하는 조문을 찾는다', () => {
    expect(findByAnchor(articles, { jo: 3, hang: 1, mok: 1 })).toEqual(a(3, 1, 1));
    expect(findByAnchor(articles, { jo: 3, hang: 2, mok: null })).toEqual(a(3, 2));
    expect(findByAnchor(articles, { jo: 5, hang: null, mok: null })).toEqual(a(5));
  });

  it('목이 사라졌으면 그 항으로 물러선다', () => {
    // 개정으로 하위가 없어져도 최소한 근처는 열어준다.
    expect(findByAnchor(articles, { jo: 3, hang: 1, mok: 9 })).toEqual(a(3, 1));
  });

  it('항까지 사라졌으면 조 루트로 물러선다', () => {
    expect(findByAnchor(articles, { jo: 3, hang: 9, mok: null })).toEqual(a(3));
  });

  it('조 자체가 없으면 null (엉뚱한 곳으로 보내지 않는다)', () => {
    expect(findByAnchor(articles, { jo: 99, hang: null, mok: null })).toBeNull();
  });
});
