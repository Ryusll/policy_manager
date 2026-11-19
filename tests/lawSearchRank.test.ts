import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapSearchItem } from '../apps/api/src/lawgokr/lawgokr.mapper';
import {
  RANK_PAGE_SIZE,
  RANK_POOL_MAX,
  normalizeLawName,
  rankLawSearchItems,
  searchRanked,
} from '../apps/api/src/lawgokr/lawgokr-search-rank';
import type { LawGoKrSearchItem, LawSearchResult, LawSearchResultItem } from '../apps/api/src/lawgokr/lawgokr.types';

/**
 * 법령명 검색을 검색어와 맞는 순으로 (T-210, SRS LAW-28).
 *
 * 막고 싶은 사고(2026-11-18 PM 신고): "상법"을 찾으면 법제처가 약칭("…보상법")에 걸린 것까지 56건을 가나다순으로 주고
 * 상법은 34번째다. 첫 쪽만 그대로 보여 주면 찾던 법령이 끝까지 내려도 안 나온다. 고정 자료는 그날의 실제 응답이다.
 */
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lawgokr-search-sangbeop.json'), 'utf8'));
const sangbeopRows: LawGoKrSearchItem[] = fixture.LawSearch.law;
const sangbeop = sangbeopRows.map(mapSearchItem);

// 가운뎃점은 눈으로 구별이 안 되므로 코드값으로 만든다
const ARAEA = String.fromCharCode(0x318d); // 법제처가 쓰는 ㆍ
const MIDDOT = String.fromCharCode(0x00b7); // 자판으로 치는 ·

let seq = 0;
function item(title: string, shortTitle: string | null = null): LawSearchResultItem {
  seq += 1;
  return {
    mst: String(700000 + seq),
    lawId: String(seq).padStart(6, '0'),
    title,
    shortTitle,
    lawType: '법률',
    revisionType: '일부개정',
    ministry: null,
    promulgationDate: '2026-01-01',
    promulgationNo: '1',
    effectiveDate: '2026-01-01',
    status: '현행',
  };
}

const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe('rankLawSearchItems — 검색어와 맞는 순 (T-210)', () => {
  it('실제 "상법" 응답: 가나다순 34번째이던 상법이 첫 줄로 오고, 상법으로 시작하는 이름이 뒤따른다', () => {
    expect(titles(sangbeop).indexOf('상법')).toBe(33); // 고정 자료가 사고 상황 그대로다
    expect(titles(sangbeop.slice(0, 20))).not.toContain('상법'); // 예전 화면이 받던 첫 20건에는 없다

    const ranked = rankLawSearchItems('상법', sangbeop);
    expect(titles(ranked.slice(0, 4))).toEqual(['상법', '상법 시행령', '상법시행법', '상법의 전자선하증권 규정의 시행에 관한 규정']);
  });

  it('실제 "상법" 응답: 이름에 들어 있는 것이 약칭에만 걸린 것보다 먼저고, 같은 단계 안은 법제처 순서 그대로다', () => {
    const ranked = titles(rankLawSearchItems('상법', sangbeop));
    // 이름에 '상법'이 들어 있는 15건(…재해보상법·국가배상법·기상법·…손해배상법) — 받은 순서대로
    expect(ranked.slice(4, 19)).toEqual(titles(sangbeop).filter((t) => t.replace(/\s/g, '').includes('상법') && !t.startsWith('상법')));
    expect(ranked[4]).toBe('공무원 재해보상법');
    expect(ranked[18]).toBe('원자력 손해배상법 시행령');
    // 약칭에만 걸린 37건 — 받은 순서대로, 맨 뒤
    expect(ranked[19]).toBe('1980년해직공무원의보상등에관한특별조치법');
    expect(ranked.slice(19)).toEqual(titles(sangbeop.filter((i) => !i.title.replace(/\s/g, '').includes('상법'))));
  });

  it('줄을 세워도 빠지거나 겹치는 법령이 없고, 받은 배열은 건드리지 않는다', () => {
    const before = sangbeop.map((i) => i.mst);
    const ranked = rankLawSearchItems('상법', sangbeop);
    expect(ranked).toHaveLength(56);
    expect([...ranked.map((i) => i.mst)].sort()).toEqual([...before].sort());
    expect(sangbeop.map((i) => i.mst)).toEqual(before); // 캐시에 든 쪽을 그대로 받으므로 제자리 정렬은 캐시를 망가뜨린다
  });

  it('일곱 단계: 이름 같음 → 약칭 같음 → 이름이 시작 → 약칭이 시작 → 이름에 포함 → 약칭에 포함 → 나머지', () => {
    const rest = item('형의 집행 및 수용자의 처우에 관한 법률', '형집행법'); // 법제처가 걸어 주지만 글자로는 안 맞는 것
    const abbrHas = item('하도급거래 공정화에 관한 법률의 특례', '특례공정거래법');
    const nameHas = item('가맹사업 공정거래법 특례법');
    const abbrStarts = item('독점규제 및 공정거래에 관한 법률 시행령', '공정거래법 시행령');
    const nameStarts = item('공정거래법 시행에 관한 규정');
    const abbrSame = item('독점규제 및 공정거래에 관한 법률', '공정거래법');
    const nameSame = item('공정거래법');
    const ranked = rankLawSearchItems('공정거래법', [rest, abbrHas, nameHas, abbrStarts, nameStarts, abbrSame, nameSame]);
    expect(ranked).toEqual([nameSame, abbrSame, nameStarts, abbrStarts, nameHas, abbrHas, rest]);
  });

  it('약칭으로 찾아도 그 법령이 첫 줄이다 (실호출: 공정거래법 → 독점규제 및 공정거래에 관한 법률)', () => {
    const decree = item('독점규제 및 공정거래에 관한 법률 시행령', '공정거래법 시행령');
    const act = item('독점규제 및 공정거래에 관한 법률', '공정거래법');
    expect(rankLawSearchItems('공정거래법', [decree, act])).toEqual([act, decree]);
  });

  it('이름과 약칭이 서로 다른 단계로 걸리면 앞 단계를 고른다', () => {
    const nameStarts = item('공정거래법 시행에 관한 규정');
    const abbrSameNameHas = item('가맹사업 공정거래법 특례법', '공정거래법'); // 이름에 포함이면서 약칭이 같다 → 약칭 같음
    expect(rankLawSearchItems('공정거래법', [nameStarts, abbrSameNameHas])).toEqual([abbrSameNameHas, nameStarts]);

    const abbrStarts = item('독점규제 및 공정거래에 관한 법률 시행령', '공정거래법 시행령');
    const nameStartsAbbrHas = item('공정거래법 특례 규정', '특례공정거래법'); // 이름이 시작이면서 약칭에 포함 → 이름이 시작
    expect(rankLawSearchItems('공정거래법', [abbrStarts, nameStartsAbbrHas])).toEqual([nameStartsAbbrHas, abbrStarts]);
  });

  it('가운뎃점·마침표로 쓰이는 글자 열 가지와 자소가 풀린 글자를 모두 같게 본다', () => {
    const may18 = item(`5${ARAEA}18민주화운동 관련자 보상 등에 관한 법률`, `5${ARAEA}18보상법`);
    const other = item('가나다 특례법', `가나다5${ARAEA}18보상법특례`);
    for (const code of [0x002e, 0xff0e, 0x00b7, 0x318d, 0x30fb, 0xff65, 0x2027, 0x2022, 0x2219, 0x22c5]) {
      const q = `5${String.fromCharCode(code)}18보상법`;
      expect(rankLawSearchItems(q, [other, may18])[0], `U+${code.toString(16)}`).toBe(may18);
    }
    const loose = '상법'.normalize('NFD'); // 맥 파일 이름에서 복사한 글자
    expect(loose).not.toBe('상법');
    expect(normalizeLawName(loose)).toBe('상법');
    expect(rankLawSearchItems(loose, [item('상법 시행령'), item('상법')])[0].title).toBe('상법');
  });

  it('띄어쓰기와 가운뎃점은 빼고 견준다', () => {
    const privacy = item('개인정보 보호법');
    const privacyDecree = item('개인정보 보호법 시행령');
    expect(rankLawSearchItems('개인정보보호법', [privacyDecree, privacy])).toEqual([privacy, privacyDecree]);
    expect(rankLawSearchItems(' 개인정보  보호법 ', [privacyDecree, privacy])[0]).toBe(privacy);

    const may18 = item(`5${ARAEA}18민주화운동 관련자 보상 등에 관한 법률`, `5${ARAEA}18보상법`);
    const other = item('가나다 보상법 특례', `가나다5${ARAEA}18보상법특례`);
    for (const q of [`5${MIDDOT}18보상법`, `5${ARAEA}18보상법`, '5.18보상법', '518보상법']) {
      expect(rankLawSearchItems(q, [other, may18])[0]).toBe(may18);
    }
    expect(normalizeLawName(` 5${ARAEA}18 보상법 `)).toBe('518보상법');
    expect(normalizeLawName(null)).toBe('');
  });

  it('영문은 대소문자를 가리지 않는다', () => {
    const a = item('ICT 융합 특별법 시행령');
    const b = item('ICT 융합 특별법');
    expect(rankLawSearchItems('ict 융합 특별법', [a, b])).toEqual([b, a]);
  });

  it('견줄 글자가 없는 검색어(빈 문자열·기호뿐)면 순서를 바꾸지 않는다 — 약칭이 없는 법령도 그대로 다룬다', () => {
    // 약칭 있는 법령을 앞에 둔다 — 빈 검색어를 그대로 견주면 약칭 없는 법령이 '약칭이 같다'로 잡혀 앞으로 온다
    const list = [item('다법', '다'), item('나법'), item('가법', null)];
    expect(rankLawSearchItems('', list)).toEqual(list);
    expect(rankLawSearchItems(` ${MIDDOT} . `, list)).toEqual(list);
    expect(rankLawSearchItems('가법', list)[0]).toBe(list[2]);
  });
});

describe('searchRanked — 모두 받아 줄 세우기 (T-210)', () => {
  const pageOf = (all: LawSearchResultItem[], page: number): LawSearchResult => ({
    total: all.length,
    page,
    display: RANK_PAGE_SIZE,
    items: all.slice((page - 1) * RANK_PAGE_SIZE, page * RANK_PAGE_SIZE),
  });

  it('한 쪽에 다 들어오면 한 번만 받고, 청한 쪽·건수만큼 잘라 준다 — total 은 줄 세운 건수', async () => {
    const calls: number[] = [];
    const r = await searchRanked((p) => (calls.push(p), Promise.resolve(pageOf(sangbeop, p))), '상법', 2, 20);
    expect(calls).toEqual([1]);
    expect(r).toMatchObject({ total: 56, page: 2, display: 20, ranked: true });
    expect(r?.items.map((i) => i.mst)).toEqual(rankLawSearchItems('상법', sangbeop).slice(20, 40).map((i) => i.mst));
  });

  it('줄 세운 목록 밖의 쪽을 청하면 빈 목록이다(오류가 아니다)', async () => {
    const r = await searchRanked((p) => Promise.resolve(pageOf(sangbeop, p)), '상법', 4, 20);
    expect(r).toMatchObject({ total: 56, page: 4, items: [] });
  });

  it('여러 쪽이면 남은 쪽을 모두 받는다 — 쪽 사이에 겹친 법령(MST)은 한 번만', async () => {
    const all = Array.from({ length: 249 }, (_, i) => item(`가나다 보상 등에 관한 법률 ${i}`, `가나다${i}보상법`));
    const target = item('상법');
    all.splice(230, 0, target); // 가나다순 3쪽(231번째)
    const calls: number[] = [];
    const r = await searchRanked(
      (p) => {
        calls.push(p);
        const page = pageOf(all, p);
        // 받는 사이에 법제처 목록이 밀려 2쪽 첫 행이 1쪽 끝 행과 겹친 상황
        return Promise.resolve(p === 2 ? { ...page, items: [all[99], ...page.items] } : page);
      },
      '상법',
      1,
      100,
    );
    expect([...calls].sort()).toEqual([1, 2, 3]);
    expect(r?.items[0]).toBe(target);
    expect(r?.total).toBe(250); // 겹친 한 건은 세지 않는다
    expect(new Set(r?.items.map((i) => i.mst)).size).toBe(100);
  });

  it(`딱 ${RANK_POOL_MAX}건이면 줄 세우고(${RANK_POOL_MAX / RANK_PAGE_SIZE}번), 한 건이라도 넘으면 받지 않고 null 을 준다`, async () => {
    const full = Array.from({ length: RANK_POOL_MAX }, (_, i) => item(`법률 ${i}`));
    const calls: number[] = [];
    const ok = await searchRanked((p) => (calls.push(p), Promise.resolve(pageOf(full, p))), '법률 499', 1, 20);
    expect([...calls].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(ok?.items[0].title).toBe('법률 499');

    const over = [...full, item('법률 500')];
    const overCalls: number[] = [];
    expect(await searchRanked((p) => (overCalls.push(p), Promise.resolve(pageOf(over, p))), '법률 500', 1, 20)).toBeNull();
    expect(overCalls).toEqual([1]); // 총건수만 보고 그만둔다
  });

  it('받다가 한 쪽이라도 실패하면 일부만 주지 않고 실패한다', async () => {
    const all = Array.from({ length: 150 }, (_, i) => item(`법률 ${i}`));
    const run = searchRanked((p) => (p === 2 ? Promise.reject(new Error('법제처 실패')) : Promise.resolve(pageOf(all, p))), '법률', 1, 20);
    await expect(run).rejects.toThrow('법제처 실패');
  });

  it('쪽마다 실린 총건수가 다르면(받은 시각이 다른 쪽이 섞임) 캐시를 건너뛰고 모두 다시 받아 줄 세운다', async () => {
    const old = Array.from({ length: 150 }, (_, i) => item(`법률 ${String(i).padStart(3, '0')}`));
    const now = [item('가나다 새 법률'), ...old]; // 가나다순 맨 앞에 법령 하나가 새로 들어왔다
    const calls: string[] = [];
    const r = await searchRanked(
      (p, fresh) => {
        calls.push(`${p}${fresh ? ' 새로' : ''}`);
        // 캐시: 1쪽은 방금 받은 것(151건), 2쪽은 150건 때 받은 옛것 — 이으면 옛 100번째(법률 099)가 어느 쪽에도 없다
        if (!fresh) return Promise.resolve(p === 1 ? pageOf(now, 1) : pageOf(old, 2));
        return Promise.resolve(pageOf(now, p));
      },
      '법률 099',
      1,
      20,
    );
    expect(calls).toEqual(['1', '2', '1 새로', '2 새로']);
    expect(r?.total).toBe(151);
    expect(r?.items[0].title).toBe('법률 099'); // 섞인 채로 이었다면 빠졌을 법령
  });

  it('다시 받아도 쪽마다 총건수가 다르면 일부만 주지 않고 502 로 실패한다 — 법제처가 가운데 쪽을 비워 준 경우', async () => {
    const all = Array.from({ length: 250 }, (_, i) => item(`법률 ${i}`));
    const emptyMiddle: LawSearchResult = { total: 0, page: 2, display: RANK_PAGE_SIZE, items: [] };
    const run = searchRanked((p) => Promise.resolve(p === 2 ? emptyMiddle : pageOf(all, p)), '법률', 1, 20);
    await expect(run).rejects.toMatchObject({ status: 502 });
  });

  it(`다시 받았더니 ${RANK_POOL_MAX}건을 넘었으면 줄 세우지 않는다(null)`, async () => {
    const before = Array.from({ length: RANK_POOL_MAX }, (_, i) => item(`법률 ${i}`));
    const after = [...before, item('법률 끝'), item('법률 끝2')];
    const r = await searchRanked((p, fresh) => Promise.resolve(fresh || p === 1 ? pageOf(after, p) : pageOf(before, p)), '법률', 1, 20);
    expect(r).toBeNull();
  });
});
