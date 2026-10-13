import { describe, it, expect } from 'vitest';
import { descendantPrefix, parseNodeKey, selfAndAncestorNodeKeys } from '../apps/api/src/laws/law-node-key';
import { labelFromNodeKey } from '../apps/api/src/laws/law-rows';
import { countArticles, tenantsReached } from '../apps/api/src/law-changes/law-link-reach';
import { capConfidence, PARENT_LINK_FLAG } from '../apps/api/src/amendments/amendment-reach';
import { ourLinks } from '../apps/api/src/law-links/our-links';
import type { PrismaService } from '../apps/api/src/common/prisma/prisma.service';

type Link = { id: string; tenantId: string; lawArticleId: string; confirmState: string; owner: string };

/**
 * 연결 조회의 where 를 행 하나에 대 본다 — 이 파일이 쓰는 모양만 안다. 모르는 키뿐 아니라 아는 키에 다른 모양
 * (`{ in }`·`{ not }` 같은 연산자, 다른 관계 조건)이 와도 실패한다 — 가짜가 읽지 못한 조건을 "안 맞음"으로 넘기면
 * 거짓 기대값이 저절로 통과한다
 */
function matches(l: Link, w: any): boolean {
  const unknown = (k: string, v: unknown) => new Error(`가짜가 모르는 조건: ${k}=${JSON.stringify(v)}`);
  return Object.entries(w).every(([k, v]: [string, any]) => {
    if (k === 'AND') {
      if (!Array.isArray(v)) throw unknown(k, v);
      return v.every((x: any) => matches(l, x));
    }
    if (k === 'id' || k === 'tenantId' || k === 'confirmState') {
      if (typeof v !== 'string') throw unknown(k, v);
      return l[k] === v;
    }
    if (k === 'lawArticleId') {
      if (!Array.isArray(v?.in) || Object.keys(v).length !== 1) throw unknown(k, v);
      return v.in.includes(l.lawArticleId);
    }
    if (k === 'article') {
      const owner = v?.chapter?.policy?.tenantId;
      if (typeof owner !== 'string' || JSON.stringify(v) !== JSON.stringify({ chapter: { policy: { tenantId: owner } } })) {
        throw unknown(k, v);
      }
      return owner === l.owner;
    }
    throw unknown(k, v);
  });
}

/** 자동 생성의 회사 찾기가 부르는 조회만 흉내 낸다 — 법령 L 의 제60조(조 머리 행)와 그 제1항 */
function fakePrisma(links: Link[]) {
  const articles = [
    { id: 'jo', lawId: 'L', nodeKey: '60//' },
    { id: 'hang', lawId: 'L', nodeKey: '60/1/' },
  ];
  const ok = <T>(v: T) => Promise.resolve(v);
  return {
    lawArticle: {
      findUnique: ({ where }: any) => ok(articles.find((a) => a.id === where.id) ?? null),
      findMany: ({ where }: any) => ok(articles.filter((a) => a.lawId === where.lawId && where.nodeKey.in.includes(a.nodeKey))),
    },
    lawLink: {
      // 실제 Prisma 처럼 distinct 가 있을 때만 회사 id 중복을 거른다 — 없으면 연결 수만큼 돌려준다
      findMany: ({ where, select, distinct, ...rest }: any) => {
        if (JSON.stringify(select) !== JSON.stringify({ tenantId: true }) || Object.keys(rest).length) {
          throw new Error(`가짜가 모르는 findMany: ${JSON.stringify({ select, rest })}`);
        }
        const ids = links.filter((l) => matches(l, where)).map((l) => l.tenantId);
        const unique = Array.isArray(distinct) && distinct.length === 1 && distinct[0] === 'tenantId';
        return ok((unique ? [...new Set(ids)] : ids).map((tenantId) => ({ tenantId })));
      },
      findFirst: ({ where }: any) => ok(links.find((l) => matches(l, where)) ?? null),
    },
  } as unknown as PrismaService;
}

// 회사 1 이름으로 회사 2 조문을 가리키는 잘못된 행 — 연결의 회사만 보면 회사 1 것으로 잡힌다(T-41 의 모양)
const BAD: Link = { id: 'bad', tenantId: 't1', lawArticleId: 'jo', confirmState: 'confirmed', owner: 't2' };
const GOOD1: Link = { id: 'g1', tenantId: 't1', lawArticleId: 'jo', confirmState: 'confirmed', owner: 't1' };
const GOOD2: Link = { id: 'g2', tenantId: 't2', lawArticleId: 'jo', confirmState: 'confirmed', owner: 't2' };

/**
 * 상위 조항 연결로 영향을 잡을 때의 경계 (T-148).
 */
describe('T-148 영향 범위와 상위 조항 후보', () => {
  it('위 조항은 문자열 앞부분이 아니라 단계로 찾는다 — 제1항제20호는 제1항제2호에 닿지 않는다', () => {
    expect(selfAndAncestorNodeKeys('60/1/20')).toEqual(['60/1/20', '60/1/', '60//']);
    expect(selfAndAncestorNodeKeys('60/1/20')).not.toContain('60/1/2');
    // 제60조의2 의 항은 제60조에 닿지 않는다
    expect(selfAndAncestorNodeKeys('60의2/1/')).toEqual(['60의2/1/', '60의2//']);
    expect(selfAndAncestorNodeKeys('60의2/1/')).not.toContain('60//');
  });

  it('변경 목록 거르기(아래로 머리말)와 영향 조회(위 조항 목록)는 같은 판정이다 — 형식에 맞는 모든 키 쌍', () => {
    const keys = ['60//', '60/1/', '60/1/2', '60/1/20', '60//3', '60/10/', '60/2/', '600//', '60의2//', '60의2/1/', '3의2/1/1의2', '3의2//'];
    for (const event of keys) {
      for (const link of keys) {
        const prefix = descendantPrefix(link);
        const byPrefix = event === link || (prefix !== null && event.startsWith(prefix));
        expect(selfAndAncestorNodeKeys(event).includes(link), `${event} ← ${link}`).toBe(byPrefix);
      }
    }
  });

  it('형식 해석은 표기와 같은 규칙 하나 — 형식이 어긋난 키는 위아래가 없다', () => {
    expect(parseNodeKey('3의2/1/1의2')).toMatchObject({ jo: '3의2', clause: '1', item: '1의2', joBranch: 2, itemBranch: 2 });
    expect(labelFromNodeKey('3의2/1/1의2')).toBe('제3조의2제1항제1호의2');
    for (const bad of ['60/1', '엉뚱한값', '', 'a//', '60/x/']) {
      expect(parseNodeKey(bad), bad).toBeNull();
      expect(selfAndAncestorNodeKeys(bad)).toEqual([bad]);
      expect(descendantPrefix(bad)).toBeNull();
      expect(labelFromNodeKey(bad)).toBe(bad);
    }
  });

  it('조문 수는 같은 조문을 한 번만 센다 — 조·항 둘 다 걸려도 1', () => {
    const links = [
      { lawArticleId: 'jo', articleId: 'D', confirmState: 'confirmed' },
      { lawArticleId: 'hang', articleId: 'D', confirmState: 'confirmed' },
      { lawArticleId: 'jo', articleId: 'X', confirmState: 'confirmed' },
    ];
    expect(countArticles(links, new Set(['jo', 'hang']))).toEqual({ confirmed: 2, suggested: 0 });
  });

  it('추천 연결이 걸린 조문을 확인 필요로 센다 — 확정 연결이 같이 있어도 감추지 않고, 반려는 세지 않는다', () => {
    const links = [
      { lawArticleId: 'jo', articleId: 'S', confirmState: 'suggested' },
      { lawArticleId: 'jo', articleId: 'X', confirmState: 'confirmed' },
      // X 는 조로 확정돼 있지만 항 단위 추천이 남아 있다 — 확정하면 바뀐 항에 바로 닿는 연결이다
      { lawArticleId: 'hang', articleId: 'X', confirmState: 'suggested' },
      { lawArticleId: 'jo', articleId: 'R', confirmState: 'rejected' },
    ];
    expect(countArticles(links, new Set(['jo', 'hang']))).toEqual({ confirmed: 1, suggested: 2 });
  });

  it('닿지 않는 조항(다른 조, 아래 조항)에 걸린 연결은 세지 않는다', () => {
    const links = [
      { lawArticleId: 'other', articleId: 'A', confirmState: 'confirmed' },
      { lawArticleId: 'child', articleId: 'B', confirmState: 'suggested' },
    ];
    expect(countArticles(links, new Set(['jo']))).toEqual({ confirmed: 0, suggested: 0 });
    expect(countArticles(links, new Set())).toEqual({ confirmed: 0, suggested: 0 });
  });

  it('상위 조항 연결로 찾은 후보의 신뢰도 상한 — 높음은 보통으로, 보통·낮음은 그대로', () => {
    expect(capConfidence('high', 'medium')).toBe('medium');
    expect(capConfidence('medium', 'medium')).toBe('medium');
    expect(capConfidence('low', 'medium')).toBe('low');
    // 상한이 높음이면 아무것도 바꾸지 않는다
    expect(capConfidence('high', 'high')).toBe('high');
    expect(PARENT_LINK_FLAG).toBe('parent_link');
  });

  it('우리 회사 연결 조건은 연결의 회사와 조문의 실제 소속을 함께 보고, 넘긴 조건이 그것을 덮어쓰지 못한다', () => {
    expect(matches(GOOD1, ourLinks('t1'))).toBe(true);
    expect(matches(BAD, ourLinks('t1'))).toBe(false);
    expect(matches(GOOD1, ourLinks('t1', { id: 'g1' }))).toBe(true);
    expect(matches(GOOD1, ourLinks('t1', { id: 'g2' }))).toBe(false);
    // 다른 회사 id 나 조문 조건을 넘겨도 우리 회사 조건이 남는다 — 어느 회사의 행도 맞지 않는다
    for (const l of [GOOD1, GOOD2, BAD]) {
      expect(matches(l, ourLinks('t1', { tenantId: 't2' })), l.id).toBe(false);
      expect(matches(l, ourLinks('t1', { article: { chapter: { policy: { tenantId: 't2' } } } })), l.id).toBe(false);
    }
  });

  it('자동 생성의 회사 찾기도 조문의 실제 소속을 본다 — 잘못된 행만 닿는 회사는 빠진다', async () => {
    expect(await tenantsReached(fakePrisma([BAD]), 'hang')).toEqual([]);
    // 같은 조에 회사 2 의 정상 연결과 회사 1 의 추천 연결이 있어도 회사 1 은 빠진다(추천은 후보를 만들지 않는다)
    const suggested1: Link = { id: 's1', tenantId: 't1', lawArticleId: 'hang', confirmState: 'suggested', owner: 't1' };
    expect(await tenantsReached(fakePrisma([BAD, GOOD2, suggested1]), 'hang')).toEqual(['t2']);
    // 회사 1 의 정상 연결이 위 조항(조 머리 행)에 있으면 항 개정에 닿는다
    expect(await tenantsReached(fakePrisma([BAD, GOOD1]), 'hang')).toEqual(['t1']);
    // 같은 회사의 연결이 조·항에 둘 다 있어도 회사는 한 번 — 회사별 생성을 두 번 부르지 않는다
    const good1Hang: Link = { id: 'g1h', tenantId: 't1', lawArticleId: 'hang', confirmState: 'confirmed', owner: 't1' };
    expect(await tenantsReached(fakePrisma([GOOD1, good1Hang]), 'hang')).toEqual(['t1']);
  });
});
