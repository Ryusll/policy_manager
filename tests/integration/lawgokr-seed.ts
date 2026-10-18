import { execFileSync } from 'child_process';
import { randomInt, randomUUID } from 'crypto';
import { mapLawDetail, mapSearchItem } from '../../apps/api/src/lawgokr/lawgokr.mapper';
import { lawDetailCacheKey, lawVersionListCacheKey, VERSION_LIST_PAGE_SIZE } from '../../apps/api/src/lawgokr/lawgokr-cache-keys';

/**
 * 가짜 법제처 — API 가 법제처를 부르기 전에 캐시(Redis)를 먼저 보는 점을 써서(lawgokr.service), 응답을 캐시에 심는다(T-151).
 * 법제처 인증값 없이 돌고(CI), 실데이터가 바뀌어도 결과가 같다. 키는 서비스와 같은 함수(lawgokr-cache-keys)로 만든다.
 *
 * 심은 값은 서비스가 매핑을 마친 모양(검색 → LawSearchResult, 본문 → {meta, tree})이다. 법제처 원문 모양은 매퍼 시험이 본다.
 * 이름·법령ID·MST 는 실행마다 달라 다른 시험·실데이터와 겹치지 않는다(법령ID·MST 는 9 로 시작).
 */
function redis(args: string[], input?: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', ...args], { input, encoding: 'utf8' }).trim();
}

function sql(statement: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'], {
    input: statement,
    encoding: 'utf8',
  }).trim();
}

/**
 * API 와 같은 Redis 가 떠 있어야 한다 — 없으면 심을 수 없다. 건너뛰지 않고 실패한다: 건너뛰면 판 걷기 시험이 통째로 빠진 채
 * "통과"로 보인다(T-151 검토). CI 는 docker compose 의 redis 를 띄운다
 */
export function requireRedis(): void {
  let pong: string;
  try {
    pong = redis(['PING']);
  } catch (e) {
    pong = (e as Error).message;
  }
  if (pong !== 'PONG') {
    throw new Error(`가짜 법제처를 심을 Redis 가 없습니다(${pong.slice(0, 120)}) — docker compose 의 redis 를 띄우고 API 가 그 Redis 를 쓰게 하세요.`);
  }
}

export interface FakeArticle {
  no: string;
  title: string;
  body: string;
}

export interface FakeVersion {
  mst: string;
  /** YYYYMMDD */
  promulgated: string;
  promulgationNo: string;
  /** 본문 기본정보의 시행일 YYYYMMDD */
  effective: string;
  /** 판 목록에 나올 단계 시행일들(없으면 effective 하나) */
  stages?: string[];
  revisionType?: string;
  /** 조문. null 이면 조문 없는 본문(별표만 있는 문서처럼) — 반영이 실패한다 */
  articles: FakeArticle[] | null;
}

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export class FakeLaw {
  readonly lawId = `9${randomInt(10_000_000, 99_999_999)}`;
  readonly name: string;
  private readonly keys = new Set<string>();

  constructor(prefix: string) {
    this.name = `${prefix}${randomInt(100_000, 999_999)}`;
  }

  /** 판 번호 — 법령마다 겹치지 않게 법령ID 전체를 앞에 붙인다(11자리 — 순서 키의 MST 칸 12자리 안). 끝자리만 쓰면 가짜 법령끼리 겹칠 수 있다 */
  mst(n: number): string {
    return `${this.lawId}${String(n).padStart(2, '0')}`;
  }

  private set(key: string, value: unknown) {
    const out = redis(['-x', 'SETEX', key, '3600'], JSON.stringify(value));
    if (out !== 'OK') throw new Error(`캐시 심기 실패(${key}): ${out}`);
    this.keys.add(key);
  }

  private item(v: FakeVersion, effective: string, status: string) {
    return mapSearchItem({
      법령일련번호: v.mst,
      법령ID: this.lawId,
      법령명한글: this.name,
      법령구분명: '법률',
      공포일자: v.promulgated,
      공포번호: v.promulgationNo,
      시행일자: effective,
      제개정구분명: v.revisionType ?? '일부개정',
      현행연혁코드: status,
    });
  }

  /** 판 본문(`target=law&MST=`). noLawId — 기본정보에 법령ID 가 빠진 응답(법제처가 가끔 그런다) */
  seedBody(v: FakeVersion, o: { noLawId?: boolean } = {}) {
    const detail = {
      기본정보: {
        ...(o.noLawId ? {} : { 법령ID: this.lawId }),
        법령명_한글: this.name,
        법종구분: { content: '법률' },
        공포일자: v.promulgated,
        공포번호: v.promulgationNo,
        시행일자: v.effective,
        제개정구분: v.revisionType ?? '일부개정',
      },
      조문: {
        조문단위: (v.articles ?? []).map((a) => ({ 조문번호: a.no, 조문여부: '조문', 조문제목: a.title, 조문내용: `제${a.no}조(${a.title}) ${a.body}` })),
      },
    };
    this.set(lawDetailCacheKey(v.mst), mapLawDetail(detail, v.mst));
  }

  /** 판 목록(`target=eflaw&LID=`) 1쪽 — 법령ID 로, 공포일 내림차순, 단계 시행일마다 한 행. current 판의 행은 현행 표시 */
  seedVersionList(versions: FakeVersion[], current?: FakeVersion) {
    const rows = [...versions]
      .sort((a, b) => b.promulgated.localeCompare(a.promulgated))
      .flatMap((v) => (v.stages ?? [v.effective]).map((d) => this.item(v, d, v === current ? '현행' : '연혁')));
    this.set(lawVersionListCacheKey(this.lawId, 1), { total: rows.length, page: 1, display: VERSION_LIST_PAGE_SIZE, items: rows });
  }

  /** 판 전부 — 본문과 판 목록(current 를 주면 그 판, 아니면 첫 판이 현행) */
  seedAll(versions: FakeVersion[], current: FakeVersion = versions[0]) {
    for (const v of versions) this.seedBody(v);
    this.seedVersionList(versions, current);
  }

  cleanup() {
    if (this.keys.size) redis(['DEL', ...this.keys]);
    this.keys.clear();
  }
}

/**
 * 시험용 법령원 — 실제 법제처로 등록하는 시험은 여기에 등록한다. 등록은 같은 법령원에서 같은 법령ID 를 이미 추적 중이면 그 행을
 * 돌려주므로(T-151), 기본 법령원에 등록하면 개발 DB 의 실제 법령 행을 돌려받아 고치거나 지울 수 있다. 지우는 함수를 함께 돌려준다
 */
export function testLawSource(): { code: string; drop: () => void } {
  const id = randomUUID();
  const code = `it-${id.slice(0, 8)}`;
  sql(`INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${id}', '${code}', '통합테스트', 'http://example.test', now());`);
  const laws = `SELECT id FROM laws WHERE source_id='${id}'`;
  return {
    code,
    drop: () =>
      sql(`
        DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${laws}));
        UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${laws}));
        DELETE FROM law_links WHERE law_article_id IN (SELECT id FROM law_articles WHERE law_id IN (${laws}));
        DELETE FROM laws WHERE source_id='${id}';
        DELETE FROM law_sources WHERE id='${id}';
      `),
  };
}

/** 날짜 문자열 'YYYYMMDD' → 'YYYY-MM-DD' (DB 비교용) */
export const day = iso;
