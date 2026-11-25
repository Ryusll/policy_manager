import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { join } from 'node:path';
import {
  EVIDENCE_SPACE_CLASS,
  MIN_EVIDENCE_LENGTH,
  compactEvidence,
  currentVersionOf,
  evidenceInContent,
  evidenceSummary,
  pickEvidenceVersion,
  evidenceSource,
  withHeldVersions,
  type VersionForEvidence,
} from '../apps/api/src/law-links/evidence-version';
import { holdArticleVersions, LockBusyException } from '../apps/api/src/common/row-locks';

/**
 * 법령 관계 근거 문구의 원천 판 (T-177, PAT-08 — 특허 도 3 S320). 직접 만들기·고치기·자동 찾기·마이그레이션 채우기가 같은 규칙을 쓴다.
 *
 * 막고 싶은 사고:
 * 1. 띄어쓰기·줄바꿈만 다른 근거 문구를 못 찾거나, 어디에나 있는 짧은 말로 원천을 정한다
 * 2. 같은 문장이 시행 판과 초안에 모두 있는데 초안을 원천으로 남겨, 초안이 고쳐지거나 지워질 때 원천이 흔들린다
 * 3. TS 규칙과 마이그레이션 SQL 의 공백 모음이 달라 새 연결과 채운 연결이 다른 판을 원천으로 본다
 * 4. 고른 판이 그 사이 지워져(재파싱 반려) 연결 저장이 500 이 되거나, 연결을 먼저 잡고 판을 기다려 삭제와 교착한다
 * 5. 폐지된 조문의 폐지 판을 "오늘 시행 판"으로 본다(as-of 의 asOfState 와 어긋남)
 * 6. 확장 한자·이모지가 든 근거 문구의 글자 수를 TS 와 SQL 이 다르게 센다
 */
const TODAY = new Date('2026-10-18T00:00:00Z');
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const v = (
  id: string,
  versionNum: number,
  status: VersionForEvidence['status'],
  effectiveDate: string | null,
  content: string,
  repealedOn: string | null = null,
): VersionForEvidence => ({ id, versionNum, status, effectiveDate: day(effectiveDate), repealedOn: day(repealedOn), content });

const versions = [
  v('v1', 1, 'archived', '2020-01-01', '연차휴가는 15일로 한다. 근로자는 휴가를 쓸 수 있다.'),
  v('v2', 2, 'published', '2024-01-01', '연차휴가는 20일로 한다. 근로자는 휴가를 쓸 수 있다.'), // 오늘 시행 판
  v('v3', 3, 'draft', null, '연차휴가는 25일로 한다. 근로자는 휴가를 쓸 수 있다.'),
];

describe('pickEvidenceVersion — 원천 판 고르기 (T-177)', () => {
  it('띄어쓰기·줄바꿈·NBSP·전각 공백만 달라도 찾는다', () => {
    expect(pickEvidenceVersion(versions, '연차 휴가는\n20일로', TODAY)).toBe('v2');
    expect(pickEvidenceVersion(versions, '연차\u00a0휴가는\u300020일로', TODAY)).toBe('v2');
  });

  it(`공백 뺀 길이 ${MIN_EVIDENCE_LENGTH}자 미만이면 찾지 않는다 — 빈 문구·없는 문구도 null`, () => {
    expect(pickEvidenceVersion(versions, '20일', TODAY)).toBeNull(); // 3자
    expect(pickEvidenceVersion(versions, '20일로', TODAY)).toBe('v2'); // 4자
    expect(pickEvidenceVersion(versions, '   ', TODAY)).toBeNull();
    expect(pickEvidenceVersion(versions, null, TODAY)).toBeNull();
    expect(pickEvidenceVersion(versions, '회사 내규에 따른다', TODAY)).toBeNull(); // 본문 밖 문구
    expect(pickEvidenceVersion([], '연차휴가는', TODAY)).toBeNull(); // 판 없는 조(머리 행)
  });

  it('여러 판이 담으면 오늘 시행 판 먼저 — 초안이 판 번호가 커도 시행 판을 원천으로', () => {
    expect(pickEvidenceVersion(versions, '근로자는 휴가를 쓸 수 있다', TODAY)).toBe('v2');
  });

  it('시행 판이 담지 않으면 담은 판 가운데 판 번호가 가장 큰 판', () => {
    expect(pickEvidenceVersion(versions, '15일로 한다', TODAY)).toBe('v1'); // 옛 판에만
    expect(pickEvidenceVersion(versions, '25일로 한다', TODAY)).toBe('v3'); // 초안에만
    const noCurrent = [v('d1', 1, 'draft', null, '같은 문장이다'), v('d2', 2, 'review', null, '같은 문장이다')];
    expect(pickEvidenceVersion(noCurrent, '같은 문장이다', TODAY)).toBe('d2'); // 시행 판이 없으면 큰 번호
  });

  it('글자 수는 코드 포인트로 센다 — SQL char_length 와 같은 셈(확장 한자 두 자는 UTF-16 으로 4 단위)', () => {
    const ext2 = String.fromCodePoint(0x20000, 0x20001); // 2자, UTF-16 길이 4
    const withExt = [v('e1', 1, 'published', '2024-01-01', `가나 ${ext2}${ext2} 다라`)];
    expect(ext2.length).toBe(4);
    expect(pickEvidenceVersion(withExt, ext2, TODAY)).toBeNull();
    expect(pickEvidenceVersion(withExt, `${ext2}${ext2}`, TODAY)).toBe('e1'); // 4자
  });

  it('오늘 폐지 상태인 조문은 시행 판이 없다 — 폐지 판을 먼저 고르지 않고 판 번호가 큰 판 (T-126 asOfState)', () => {
    const repealed = [
      v('r1', 1, 'archived', '2020-01-01', '같은 문장이다'),
      v('r2', 2, 'published', '2024-01-01', '같은 문장이다', '2025-01-01'), // 2025-01-01 폐지
      v('r3', 3, 'draft', null, '같은 문장이다'),
    ];
    expect(pickEvidenceVersion(repealed, '같은 문장이다', TODAY)).toBe('r3');
    expect(currentVersionOf(repealed, TODAY)).toBeNull();
    // 폐지일이 아직 오지 않았으면 그대로 시행 판
    expect(currentVersionOf(repealed, new Date('2024-06-01T00:00:00Z'))?.id).toBe('r2');
  });
});

describe('evidenceInContent — 근거 문구가 이 본문에 있나 (T-177, 화면 알림의 기준)', () => {
  it('공백 무시 포함, 찾을 수 없는 문구(빈·짧은)는 null', () => {
    expect(evidenceInContent('연차휴가는 20일로 한다.', '연차휴가는\n20일로')).toBe(true);
    expect(evidenceInContent('연차휴가는 25일로 한다.', '연차휴가는 20일로')).toBe(false);
    expect(evidenceInContent('연차휴가는 20일로 한다.', '20일')).toBeNull();
    expect(evidenceInContent('연차휴가는 20일로 한다.', null)).toBeNull();
  });
});

describe('evidenceSummary — 응답·근거 스냅샷의 원천 판 요약 (T-177)', () => {
  const ev = { id: 'v1', articleId: 'a1', versionNum: 1, status: 'archived' as const, effectiveDate: day('2020-01-01') };
  it('본문 없이, 시행일은 날짜만', () => {
    expect(evidenceSummary({ articleId: 'a1', evidenceVersion: ev })).toEqual({ id: 'v1', versionNum: 1, status: 'archived', effectiveDate: '2020-01-01' });
    expect(evidenceSummary({ articleId: 'a1', evidenceVersion: { ...ev, effectiveDate: null } })?.effectiveDate).toBeNull();
    expect(evidenceSummary({ articleId: 'a1', evidenceVersion: null })).toBeNull();
  });
  it('원천이 연결의 조문이 아닌 판을 가리키면 싣지 않는다 — 잘못 들어간 행이 다른 조문(회사)의 판을 보이지 않게', () => {
    expect(evidenceSummary({ articleId: 'a2', evidenceVersion: ev })).toBeNull();
  });
});

describe('currentVersionOf — 오늘 시행 판 (common/as-of 의 "현재" 규칙과 같다)', () => {
  it('시행일이 오늘 이하인 발행·내려간 판 가운데 시행일이 가장 늦은 판, 같으면 판 번호 큰 판', () => {
    expect(currentVersionOf(versions, TODAY)?.id).toBe('v2');
    const sameDay = [v('a', 1, 'archived', '2024-01-01', 'x'), v('b', 2, 'published', '2024-01-01', 'x')];
    expect(currentVersionOf(sameDay, TODAY)?.id).toBe('b');
  });

  it('시행 예정 판(미래 시행일)·초안은 아니다 — 시행일 없는 예전 시행본은 날짜 있는 판보다 뒤(NULLS LAST)', () => {
    const scheduled = [v('old', 1, 'archived', '2020-01-01', 'x'), v('future', 2, 'published', '2027-01-01', 'x'), v('draft', 3, 'draft', null, 'x')];
    expect(currentVersionOf(scheduled, TODAY)?.id).toBe('old');
    const undated = [v('legacy', 1, 'archived', null, 'x'), v('dated', 2, 'published', '2025-01-01', 'x')];
    expect(currentVersionOf(undated, TODAY)?.id).toBe('dated');
    expect(currentVersionOf([v('legacy', 1, 'published', null, 'x')], TODAY)?.id).toBe('legacy');
    expect(currentVersionOf([v('d', 1, 'draft', null, 'x')], TODAY)).toBeNull();
  });
});

describe('공백 모음 — TS·마이그레이션 SQL·규칙 엔진(JS \\s)이 같다', () => {
  it('마이그레이션의 채우기 SQL 이 같은 공백 모음 글자열을 쓴다', () => {
    const sql = readFileSync(join(__dirname, '..', 'apps', 'api', 'prisma', 'migrations', '20261018120000_law_link_evidence_version', 'migration.sql'), 'utf8');
    const fill = sql.slice(sql.indexOf('[evidence-fill:start]'), sql.indexOf('[evidence-fill:end]'));
    expect(fill.split(`'${EVIDENCE_SPACE_CLASS}'`).length - 1).toBe(3); // 근거 문구·판 본문·길이 검사
  });

  it('공백 모음이 JS \\s 와 같은 글자를 지운다(BMP 전부) — 규칙 엔진의 근거 문장 좁히기와 같은 기준', () => {
    const ours = new RegExp(`^${EVIDENCE_SPACE_CLASS}$`);
    const diff: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      const ch = String.fromCharCode(c);
      if (/^\s$/.test(ch) !== ours.test(ch)) diff.push(c.toString(16));
    }
    expect(diff).toEqual([]);
    expect(compactEvidence(' a\tb\nc\u00a0d\u3000e\ufeff ')).toBe('abcde');
  });
});

describe('evidenceSource — 원천 판과 "본문에서 찾았는가"를 함께 (T-177)', () => {
  it('찾으면 그 판과 true, 본문 밖·짧은 문구면 null 과 false', () => {
    expect(evidenceSource(versions, '20일로 한다', TODAY)).toEqual({ evidenceVersionId: 'v2', evidenceFromBody: true });
    expect(evidenceSource(versions, '회사 메모에 적은 설명', TODAY)).toEqual({ evidenceVersionId: null, evidenceFromBody: false });
    expect(evidenceSource(versions, '20일', TODAY)).toEqual({ evidenceVersionId: null, evidenceFromBody: false });
  });
});

describe('withHeldVersions — 조문 → 판 순서로 잡은 채 고르고 쓴다 (T-177)', () => {
  // 트랜잭션·원시 질의만 흉내 낸다 — 실제 잠금·삭제 경합은 통합 시험(law-link-evidence-race)이 본다
  const held = [{ id: 'v1', versionNum: 1, status: 'published', effectiveDate: day('2024-01-01'), repealedOn: null, content: '본문이다' }];
  const lockWait = () => new Prisma.PrismaClientKnownRequestError('canceling statement due to lock timeout', { code: 'P2010', clientVersion: '5.22.0', meta: { code: '55P03' } });
  // 시계를 고정한다 — 조문 문장이 1초 걸린 것으로 만들어 "남은 시간"(한도 − 지난 시간)이 한도와 또렷이 갈리게
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const fakeDb = (o: { articleExists?: boolean; articleLockWait?: boolean; versionsLockWait?: boolean; articleMs?: number } = {}) => {
    const calls: string[] = [];
    const line = (sql: TemplateStringsArray, values: unknown[]) => sql.join('?').replace(/\s+/g, ' ').trim() + (values.length ? ` [${values.join(',')}]` : '');
    const tx = {
      // 잠금 도우미(row-locks 의 acquire)가 처음 거는 한도(set_config)는 세지 않는다
      $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => {
        const text = line(sql, values);
        if (text.includes('set_config')) return Promise.resolve([{ prev: '0' }]);
        calls.push(text);
        if (text.includes('FROM articles')) {
          vi.advanceTimersByTime(o.articleMs ?? 1000); // 조문 행을 잡는 데 걸린 시간
          if (o.articleLockWait) return Promise.reject(lockWait());
          return Promise.resolve(o.articleExists === false ? [] : [{ id: 'a1' }]);
        }
        return o.versionsLockWait ? Promise.reject(lockWait()) : Promise.resolve(held);
      },
      $executeRaw: (sql: TemplateStringsArray, ...values: unknown[]) => {
        const text = line(sql, values);
        // acquire 가 잡은 뒤 statement_timeout 을 되돌리는 문장은 세지 않는다
        if (!text.includes("'statement_timeout', ?, true)") || text.includes('lock_timeout')) calls.push(`exec:${text}`);
        return Promise.resolve(0);
      },
    };
    const db = {
      $transaction: <R>(fn: (t: typeof tx) => Promise<R>, options: { timeout: number }) => (calls.push(`tx:${options.timeout}`), fn(tx)),
    };
    return { db, tx, calls };
  };

  it('조문 행을 먼저, 그다음 그 판들을 id 순으로 FOR KEY SHARE 로 잡고, 잡은 판들을 넘긴다 — 기다림 둘을 견디는 트랜잭션 제한', async () => {
    const { db, calls } = fakeDb();
    const got = await withHeldVersions(db as never, 'a1', (_tx, vs) => Promise.resolve(vs.map((x) => x.id)));
    expect(got).toEqual(['v1']);
    expect(calls[0]).toBe('tx:9000');
    expect(calls[1]).toBe('SELECT id FROM articles WHERE id = ? FOR KEY SHARE [a1]');
    // 두 문장이 한도 하나(3초)를 나눠 쓴다 — 조문 문장에 1초를 썼으니 판은 남은 2초로 걸고, 잡은 뒤 lock_timeout 을 한도 전체로 되돌린다
    expect(calls[2]).toBe("exec:SELECT set_config('lock_timeout', ?, true), set_config('statement_timeout', ?, true) [2000ms,2000ms]");
    expect(calls[3]).toMatch(/FROM article_versions WHERE article_id = \? ORDER BY id FOR KEY SHARE \[a1\]$/);
    expect(calls[4]).toBe("exec:SELECT set_config('lock_timeout', ?, true) [3000ms]");
  });

  it('조문이 그 사이 지워졌으면 판을 잡지 않고 404', async () => {
    const { db, calls } = fakeDb({ articleExists: false });
    await expect(withHeldVersions(db as never, 'a1', () => Promise.resolve('쓰면 안 된다'))).rejects.toThrow('조문을 찾을 수 없습니다.');
    expect(calls.some((c) => c.includes('article_versions'))).toBe(false);
  });

  it('조문 문장에서 한도를 다 썼으면 판을 잡지 않고 409 — 조문 라벨로(한도를 쓴 쪽)', async () => {
    const { tx, calls } = fakeDb({ articleMs: 0 });
    const err: unknown = await holdArticleVersions(tx as never, 'a1', 0).catch((e: unknown) => e); // 한도 0 — 남은 시간이 딱 0 이어도 더 기다리지 않는다
    expect(err).toBeInstanceOf(LockBusyException);
    expect((err as LockBusyException).lock).toBe('article');
    expect(calls.some((c) => c.includes('article_versions'))).toBe(false);
  });

  it('조문 문장이 기다림 한도를 넘기면 조문 라벨의 409 — 판 문장은 돌지 않는다', async () => {
    const { tx, calls } = fakeDb({ articleLockWait: true });
    const err: unknown = await holdArticleVersions(tx as never, 'a1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockBusyException);
    expect((err as LockBusyException).lock).toBe('article');
    expect(calls.some((c) => c.includes('article_versions'))).toBe(false);
  });

  it('판 문장이 기다림 한도를 넘기면 판 단계 라벨의 409 — 조문(삭제)에 막혔는지 판(재파싱 반려)에 막혔는지 로그로 가른다', async () => {
    const { tx } = fakeDb({ versionsLockWait: true });
    const err: unknown = await holdArticleVersions(tx as never, 'a1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockBusyException);
    expect((err as LockBusyException).lock).toBe('article-versions');
  });
});
