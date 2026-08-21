import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearHistory,
  historyKey,
  loadHistory,
  pushHistory,
  removeHistory,
} from '../apps/web/src/lib/searchHistory';

/** localStorage 흉내 — jsdom 없이 순수하게 돌린다 */
function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

let store: ReturnType<typeof memStorage>;
beforeEach(() => {
  store = memStorage();
});

describe('searchHistory', () => {
  it('넣은 순서의 역순으로 쌓인다', () => {
    pushHistory('휴가', 't1', store);
    pushHistory('연차', 't1', store);
    expect(loadHistory('t1', store)).toEqual(['연차', '휴가']);
  });

  it('같은 말을 다시 검색하면 위로 올라오고 중복이 안 생긴다', () => {
    pushHistory('휴가', 't1', store);
    pushHistory('연차', 't1', store);
    pushHistory('휴가', 't1', store);
    expect(loadHistory('t1', store)).toEqual(['휴가', '연차']);
  });

  it('8건까지만 남는다', () => {
    for (let i = 1; i <= 12; i += 1) pushHistory(`검색${i}`, 't1', store);
    const out = loadHistory('t1', store);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe('검색12');
  });

  it('빈 값·공백은 넣지 않는다', () => {
    pushHistory('   ', 't1', store);
    pushHistory('', 't1', store);
    expect(loadHistory('t1', store)).toEqual([]);
  });

  it('하나만 지우거나 전체를 비운다', () => {
    pushHistory('a', 't1', store);
    pushHistory('b', 't1', store);
    expect(removeHistory('a', 't1', store)).toEqual(['b']);
    expect(clearHistory('t1', store)).toEqual([]);
    expect(loadHistory('t1', store)).toEqual([]);
  });

  it('테넌트가 다르면 섞이지 않는다', () => {
    // 한 브라우저로 회사를 옮겨 다녀도 남의 회사 검색어가 보이면 안 된다.
    pushHistory('A사 기밀', 'tenant-a', store);
    pushHistory('B사 자료', 'tenant-b', store);
    expect(loadHistory('tenant-a', store)).toEqual(['A사 기밀']);
    expect(loadHistory('tenant-b', store)).toEqual(['B사 자료']);
    expect(historyKey('tenant-a')).not.toBe(historyKey('tenant-b'));
  });

  it('저장소가 없어도(시크릿 모드) 죽지 않는다', () => {
    expect(loadHistory('t1', null)).toEqual([]);
    expect(pushHistory('x', 't1', null)).toEqual([]);
    expect(removeHistory('x', 't1', null)).toEqual([]);
  });

  it('값이 손상돼 있어도 화면이 죽지 않는다', () => {
    store.setItem(historyKey('t1'), '{깨진 JSON');
    expect(loadHistory('t1', store)).toEqual([]);
    store.setItem(historyKey('t1'), '{"not":"array"}');
    expect(loadHistory('t1', store)).toEqual([]);
  });
});
