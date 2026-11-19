import { describe, it, expect } from 'vitest';
import {
  LAW_SEARCH_PAGE_SIZE,
  LAW_SEARCH_QUERY_MAX,
  mergeSearchPages,
  nextSearchPage,
  retrySearch,
  searchFailureText,
  searchFailureView,
} from '../apps/web/src/lib/lawSearchPages';
import { LAW_SEARCH_QUERY_MAX as SERVER_QUERY_MAX } from '../apps/api/src/lawgokr/lawgokr-search-rank';
import { messages } from '../apps/web/src/i18n/messages';
import type { LawSearchItem, LawSearchResult } from '../apps/web/src/api/lawgokr';

/**
 * 법령 등록 창의 '더 보기' (T-210, SRS LAW-28) — 받은 쪽을 한 목록으로 잇고, 더 받을 쪽이 남았는지 정한다.
 *
 * 막고 싶은 사고: 결과가 한 쪽을 넘는데 다음 쪽을 볼 방법이 없어 찾던 법령이 끝까지 안 나온다(2026-11-18 신고).
 * 반대로 '더 보기'가 끝나지 않고 남는 것(빈 쪽을 받고도 계속 청함)도 막는다.
 */
function law(mst: string, title = `법령 ${mst}`): LawSearchItem {
  return {
    mst,
    lawId: mst.padStart(6, '0'),
    title,
    shortTitle: null,
    lawType: '법률',
    revisionType: null,
    ministry: null,
    promulgationDate: null,
    promulgationNo: null,
    effectiveDate: null,
    status: '현행',
  };
}

function pageOf(total: number, page: number, items: LawSearchItem[], ranked?: boolean): LawSearchResult {
  return { total, page, display: LAW_SEARCH_PAGE_SIZE, items, ...(ranked === undefined ? {} : { ranked }) };
}

const many = (from: number, count: number) => Array.from({ length: count }, (_, i) => law(String(from + i)));

describe('nextSearchPage — 더 받을 쪽 (T-210)', () => {
  it('한 번에 법제처 상한인 100건을 청한다', () => {
    expect(LAW_SEARCH_PAGE_SIZE).toBe(100);
  });

  it('전체가 한 쪽에 다 왔으면 더 받지 않는다 ("상법" 56건)', () => {
    expect(nextSearchPage(pageOf(56, 1, many(1, 56), true))).toBeUndefined();
    expect(nextSearchPage(pageOf(100, 1, many(1, 100), true))).toBeUndefined();
  });

  it('남았으면 다음 쪽 번호를 준다 — 마지막 쪽에서 멈춘다', () => {
    expect(nextSearchPage(pageOf(250, 1, many(1, 100), true))).toBe(2);
    expect(nextSearchPage(pageOf(250, 2, many(101, 100), true))).toBe(3);
    expect(nextSearchPage(pageOf(250, 3, many(201, 50), true))).toBeUndefined();
    expect(nextSearchPage(pageOf(101, 1, many(1, 100), true))).toBe(2);
  });

  it('빈 쪽이 오면 총건수가 남았다고 해도 멈춘다 — 끝나지 않는 더 보기를 만들지 않는다', () => {
    expect(nextSearchPage(pageOf(4535, 7, [], false))).toBeUndefined();
    expect(nextSearchPage(pageOf(0, 1, []))).toBeUndefined();
  });
});

describe('searchFailureView·searchFailureText — 실패했을 때 무엇을 보이고 하라고 할지 (T-210)', () => {
  const httpError = (status: number, code?: string) => ({
    response: { status, data: { ...(code ? { code } : {}), message: '법제처 API 호출에 실패했습니다: 시간 초과' } },
  });
  const t = (key: string) => `[${key}]`;

  it('법제처 호출 실패(502)·끊긴 연결은 서버가 준 까닭 뒤에 잠시 뒤 검색을 다시 누르라고 한다', () => {
    expect(searchFailureView(httpError(502), false)).toEqual({ messageKey: null, hintKey: 'lawSearch.retry' });
    expect(searchFailureView(new Error('Network Error'), false)).toEqual({ messageKey: null, hintKey: 'lawSearch.retry' });
    expect(searchFailureText(httpError(502), false, t)).toBe('법제처 API 호출에 실패했습니다: 시간 초과 [lawSearch.retry]');
    expect(searchFailureText(new Error('Network Error'), false, t)).toBe('[lawSearch.failed] [lawSearch.retry]');
  });

  it('다음 쪽만 실패했으면 더 보기를 다시 누르라고 한다 — 검색을 다시 누르면 받은 쪽만 다시 받는다', () => {
    expect(searchFailureView(httpError(502), true)).toEqual({ messageKey: null, hintKey: 'lawSearch.moreRetry' });
  });

  it('법제처 연결이 막혔으면(code LAWGOKR_*) 운영자용 서버 문구 대신 고객용 문구를 보이고 문의하게 한다', () => {
    const operatorText = { response: { status: 503, data: { code: 'LAWGOKR_AUTH', message: '법제처 API 인증에 실패했습니다: … 서버 IP·도메인 확인' } } };
    expect(searchFailureView(operatorText, false)).toEqual({ messageKey: 'lawSearch.blocked', hintKey: 'lawSearch.contact' });
    expect(searchFailureText(operatorText, false, t)).toBe('[lawSearch.blocked] [lawSearch.contact]');
    expect(searchFailureText(operatorText, false, t)).not.toContain('IP');
    expect(searchFailureView(httpError(503, 'LAWGOKR_NOT_CONFIGURED'), true)).toEqual({ messageKey: 'lawSearch.blocked', hintKey: 'lawSearch.contact' });
    expect(searchFailureView(httpError(500, 'LAWGOKR_AUTH'), false).messageKey).toBe('lawSearch.blocked');
    // code 를 붙이기 전 서버가 섞여 도는 동안에도 같은 안내 — 503 만으로도 가른다
    expect(searchFailureView(httpError(503), false)).toEqual({ messageKey: 'lawSearch.blocked', hintKey: 'lawSearch.contact' });
  });

  it('요청이 틀린 실패(4xx — 검색어가 너무 김 등)는 서버 문구만 보이고 다시 누르라고 하지 않는다', () => {
    const tooLong = { response: { status: 400, data: { message: '검색어는 200자까지 넣을 수 있습니다.' } } };
    expect(searchFailureView(tooLong, false)).toEqual({ messageKey: null, hintKey: null });
    expect(searchFailureText(tooLong, false, t)).toBe('검색어는 200자까지 넣을 수 있습니다.');
  });

  it('요청이 잠시 많았으면(429) 고객용 문구에 잠시 뒤 다시 누르라고 붙인다 — 408(시간 초과)도 다시 누르라고 한다', () => {
    const throttled = { response: { status: 429, data: { message: 'ThrottlerException: Too Many Requests' } } };
    expect(searchFailureView(throttled, false)).toEqual({ messageKey: 'lawSearch.busy', hintKey: 'lawSearch.retry' });
    expect(searchFailureText(throttled, false, t)).toBe('[lawSearch.busy] [lawSearch.retry]');
    expect(searchFailureView(httpError(408), false)).toEqual({ messageKey: null, hintKey: 'lawSearch.retry' });
  });

  it('문구 키는 한국어·영어 문구에 모두 있다', () => {
    for (const key of ['lawSearch.failed', 'lawSearch.blocked', 'lawSearch.retry', 'lawSearch.moreRetry', 'lawSearch.contact', 'lawSearch.busy']) {
      expect(messages.ko).toHaveProperty([key]);
      expect(messages.en).toHaveProperty([key]);
    }
  });
});

describe('retrySearch — 실패한 검색을 다시 보낼지 (T-210)', () => {
  // axios 오류처럼 response 를 단 Error
  const httpErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

  it('요청이 틀린 실패(4xx)는 다시 보내지 않는다 — 보내도 같은 400 이다. 429 도 곧바로 다시 보내지 않는다(또 막힌다)', () => {
    expect(retrySearch(0, httpErr(400))).toBe(false);
    expect(retrySearch(0, httpErr(403))).toBe(false);
    expect(retrySearch(0, httpErr(429))).toBe(false);
    expect(retrySearch(0, httpErr(408))).toBe(true);
  });

  it('그 밖(502·503·연결 끊김)은 앱 기본값처럼 한 번만 다시 보낸다', () => {
    expect(retrySearch(0, httpErr(502))).toBe(true);
    expect(retrySearch(0, httpErr(503))).toBe(true);
    expect(retrySearch(0, new Error('Network Error'))).toBe(true);
    expect(retrySearch(1, httpErr(502))).toBe(false);
  });

  it('검색어 길이 상한은 서버와 같다(입력 칸이 그보다 받지 않는다)', () => {
    expect(LAW_SEARCH_QUERY_MAX).toBe(SERVER_QUERY_MAX);
  });
});

describe('mergeSearchPages — 받은 쪽을 한 목록으로 (T-210)', () => {
  it('아직 받은 것이 없으면 빈 목록이다', () => {
    expect(mergeSearchPages(undefined)).toEqual({ items: [], total: 0, ranked: undefined });
    expect(mergeSearchPages([])).toEqual({ items: [], total: 0, ranked: undefined });
  });

  it('쪽을 받은 순서대로 잇고, 전체 건수와 줄 세움 여부는 첫 쪽 것을 쓴다', () => {
    // 더 보기 사이에 서버 쪽 캐시가 바뀌어 둘째 쪽의 건수·줄 세움 여부가 달라져 와도, 화면 머리의 숫자와 안내는 흔들리지 않는다
    const merged = mergeSearchPages([pageOf(250, 1, many(1, 100), true), pageOf(249, 2, many(101, 100), false)]);
    expect(merged.items.map((i) => i.mst)).toEqual(many(1, 200).map((i) => i.mst));
    expect(merged.total).toBe(250);
    expect(merged.ranked).toBe(true);
  });

  it('쪽 사이에 겹친 법령(MST)은 먼저 온 것 하나만 남긴다 — 같은 줄이 두 번 보이지 않게', () => {
    const first = pageOf(4535, 1, [law('1', '가법'), law('2', '나법')], false);
    const second = pageOf(4535, 2, [law('2', '나법(밀려 다시 온 행)'), law('3', '다법')], false);
    const merged = mergeSearchPages([first, second]);
    expect(merged.items.map((i) => i.title)).toEqual(['가법', '나법', '다법']);
    expect(merged.ranked).toBe(false);
  });

  it('줄 세움 표시가 없는 응답(정렬을 직접 준 검색)은 undefined 로 둔다 — 가나다순 안내를 띄우지 않는다', () => {
    expect(mergeSearchPages([pageOf(3, 1, many(1, 3))]).ranked).toBeUndefined();
  });
});
