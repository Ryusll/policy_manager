import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { parseSnapshot, positionKey, type Position, type StructureSnapshot } from '../common/article-structure';
import { placeArticle, placeAsOf } from './as-of-structure';
import {
  AS_OF_VERSION_ORDER,
  asOfState,
  asOfVersionWhere,
  currentVersionIdsSql,
  scheduledVersionWhere,
} from '../common/as-of';
import { buildCurrentChapters, currentStateOf, type CurrentState } from './current-view';
import { AuditService } from '../audit/audit.service';
import { claimPolicySlots, readPolicySlots } from './policy-slots';
import { buildPolicyForest } from './policy-hierarchy';
import {
  applyChapterHeaderPatch,
  newChapterHeader,
  ChapterHeaderError,
  type ChapterHeaderState,
} from './chapter-header';
import {
  ReorderPlanError,
  buildReorderPlan,
  currentJoOrder,
  type ReorderTarget,
} from './article-reorder';
import { coerceNullableDate, parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import {
  buildComparisonRows,
  buildCrossPolicyRows,
  type CompareArticleInput,
} from './policy-compare';
import {
  buildThreeWayRows,
  type ThreeWayArticle,
  type ThreeWayPolicy,
} from './policy-three-way';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  CreateChapterDto,
  CreateSectionDto,
  UpdateSectionDto,
  UpdateChapterDto,
  CreateArticleDto,
  UpdateArticleDto,
  CreatePolicyAppendixDto,
  UpdatePolicyAppendixDto,
  CreatePolicyImportLogDto,
  CreateRevisionReasonDto,
  UpdateRevisionReasonDto,
} from './policies.dto';
import { ARTICLE_ORDER, formatJo } from '../common/article-label';
import { VERSION_LAW_CHANGE, withLawChange } from '../versions/version-law-change';
import { readSnapshot, type SnapshotDb } from '../common/read-snapshot';
import { LONG_LOCK_WAIT_MS, lockArticlesForDelete, lockPolicyForDelete, lockPolicyRow } from '../common/row-locks';

/**
 * 계층을 바꾸는 쓰기(장·절·조문 생성·수정·삭제, 조 순서 재정렬)는 규정 행을 잠근다 — 재파싱 묶음(T-110 ②)이 같은 잠금 아래에서
 * 규정 계층 지문을 다시 계산하므로, 그 사이에 끼어들지 못하고 앞이나 뒤에 줄 선다. 잠금 순서·세기는 `common/row-locks`(T-131)
 */
const lockPolicy = lockPolicyRow;

/**
 * 바로잡기(재정렬·번호 직접 수정)가 다른 조문의 **얼린 자리**(지난 계층 기록, T-110 ②)와 겹치면 막는다. 바로잡기는 버전을 만들지
 * 않아 얼리지 않은 이력까지 새 번호를 따르므로, 지난 기간의 시점 조회에서 같은 자리에 조문 둘이 나올 수 있다(기간은 따지지 않는
 * 보수적 검사 — 사용자 지시로 코덱스 자문). 얼린 기록이 없는 규정은 지금처럼.
 */
async function assertNoFrozenClash(
  tx: Prisma.TransactionClient,
  policyId: string,
  moves: { articleId: string; position: Position; label: string }[],
) {
  if (!moves.length) return;
  const frozen = await tx.articleVersion.findMany({
    where: { article: { chapter: { policyId } }, status: { in: ['published', 'archived'] }, structure: { not: Prisma.DbNull } },
    select: { articleId: true, structure: true },
  });
  if (!frozen.length) return;
  const holders = new Map<string, Set<string>>();
  for (const f of frozen) {
    const snap = parseSnapshot(f.structure);
    if (!snap) continue;
    const key = positionKey(snap);
    holders.set(key, new Set([...(holders.get(key) ?? []), f.articleId]));
  }
  for (const m of moves) {
    const ids = holders.get(positionKey(m.position));
    if (ids && [...ids].some((id) => id !== m.articleId)) {
      throw new BadRequestException(
        `${m.label}: 이 자리는 다른 조문의 지난 계층 기록에 있습니다 — 그대로 바꾸면 그 기간의 시점 조회에서 번호가 겹칩니다. 원문을 다시 가져와(재파싱) 개정으로 옮기거나 다른 번호를 쓰세요.`,
      );
    }
  }
}

const labelOf = (p: Position) =>
  `${formatJo(p.number, p.branchNumber)}${p.clauseNumber ? `제${p.clauseNumber}항` : ''}${p.itemNumber ? `제${p.itemNumber}목` : ''}`;

/** 조 단위 자리 — 조 번호는 장을 가로질러 문서 전체에서 이어진다 */
const joKeyOf = (p: Pick<Position, 'number' | 'branchNumber'>) => `${p.number}|${p.branchNumber ?? 0}`;

/**
 * 미래 시행 구조 변경(재파싱 묶음, T-110 ②)이 옮겨 둔 조문 — 시행 예정 버전이 있고, 오늘 시행 중인 버전에 얼린 자리가 지금 행과
 * 다른 것(T-132 ⑦). 그날까지 오늘 자리는 얼린 값이고 지금 행은 그날부터의 자리다. 규정 상세의 `displaced` 와 같은 기준이다.
 */
async function scheduledMoves(tx: Prisma.TransactionClient, policyId: string, today: Date) {
  const scheduled = await tx.articleVersion.findMany({
    where: { article: { chapter: { policyId } }, ...scheduledVersionWhere(today) },
    orderBy: { effectiveDate: 'asc' },
    select: { articleId: true, effectiveDate: true },
  });
  const firstDate = new Map<string, Date>();
  for (const s of scheduled) if (!firstDate.has(s.articleId)) firstDate.set(s.articleId, s.effectiveDate!);
  if (!firstDate.size) return [];
  const picked = await tx.$queryRaw<{ id: string }[]>(currentVersionIdsSql([...firstDate.keys()], today));
  if (!picked.length) return [];
  const frozen = await tx.articleVersion.findMany({
    where: { id: { in: picked.map((p) => p.id) }, structure: { not: Prisma.DbNull } },
    select: { articleId: true, structure: true, repealedOn: true },
  });
  const rows = new Map(
    (
      await tx.article.findMany({
        where: { id: { in: frozen.map((f) => f.articleId) } },
        select: { id: true, chapterId: true, number: true, branchNumber: true, clauseNumber: true, itemNumber: true },
      })
    ).map((r) => [r.id, r]),
  );
  const out: { articleId: string; today: StructureSnapshot; live: Position & { chapterId: string }; date: Date }[] = [];
  for (const f of frozen) {
    const snap = parseSnapshot(f.structure);
    const live = rows.get(f.articleId);
    // 폐지된 조문은 오늘 자리를 쓰지 않는다
    if (!snap || !live || asOfState(f, today) !== 'in_force') continue;
    if (positionKey(snap) === positionKey(live) && snap.chapter.id === live.chapterId) continue;
    out.push({ articleId: f.articleId, today: snap, live, date: firstDate.get(f.articleId)! });
  }
  return out;
}

/**
 * 미래 시행 구조 변경을 기다리는 동안의 구조 편집(T-132 ⑦). 편집은 지금 행(그날부터의 자리)을 고치는데, 그 사이 오늘 자리는
 * 얼린 값이라 둘이 어긋나는 조가 있다. 그런 조에 조문을 넣거나 다른 조문을 옮겨 넣으면 그날 전까지의 시점 조회에서 한 조가
 * 두 자리로 갈리거나 남의 조와 겹친다(얼린 자리는 그 조문에 시행 예정 버전이 있을 때만 쓰여, 새 행에는 오늘 자리가 없다).
 * - 오늘 자리와 그날부터의 자리가 다른 조(오늘 조와 그날 조 모두) — 조를 넣거나 다른 조문을 옮겨 넣지 못한다
 * - 같은 조 안에서 항·목 번호만 바뀐 조문의 오늘 자리 — 그 자리에 새 조문을 넣지 못한다
 * 이미 그 조에 있는 조문의 번호·제목을 고치는 것(조가 그대로)과 옮겨질 조문 자신을 오늘 조로 되돌리는 것은 된다 — 그날부터의
 * 자리만 바뀐다. 순서 재정렬은 따로 막는다(`assertNoScheduledMoves`).
 */
/**
 * 조 순서 재정렬은 미래 시행 구조 변경이 조문을 옮겨 둔 동안 하지 않는다(T-132 ⑦) — 오늘 자리와 그날부터의 자리가 섞인 목록을
 * 한 번에 다시 매기면 옮겨질 조문의 오늘 자리(얼린 값)는 그대로라 한 조가 두 자리로 갈린다. 화면도 그동안 막는다.
 */
async function assertNoScheduledMoves(tx: Prisma.TransactionClient, policyId: string) {
  const moves = await scheduledMoves(tx, policyId, todayDateOnly());
  if (!moves.length) return;
  const first = moves.reduce((a, b) => (b.date < a.date ? b : a));
  throw new BadRequestException(
    `시행 예정 구조 변경(${toDateOnlyString(first.date)} 시행, 재파싱 묶음)이 조문 자리를 옮기는 중이라 조 순서를 다시 매길 수 없습니다 — ` +
      '그날 뒤에 하세요. 조·항 추가와 번호·제목 고치기는 할 수 있습니다.',
  );
}

async function assertNotIntoMovingJo(
  tx: Prisma.TransactionClient,
  policyId: string,
  targets: { articleId?: string; position: Position; label: string }[],
) {
  if (!targets.length) return;
  const moves = await scheduledMoves(tx, policyId, todayDateOnly());
  if (!moves.length) return;
  const flux = new Map<string, (typeof moves)[number][]>();
  const held = new Map<string, (typeof moves)[number]>();
  for (const m of moves) {
    held.set(positionKey(m.today), m);
    if (joKeyOf(m.today) !== joKeyOf(m.live) || m.today.chapter.id !== m.live.chapterId) {
      for (const key of new Set([joKeyOf(m.today), joKeyOf(m.live)])) flux.set(key, [...(flux.get(key) ?? []), m]);
    }
  }
  for (const t of targets) {
    const f = flux.get(joKeyOf(t.position))?.find((m) => m.articleId !== t.articleId);
    if (f) {
      throw new BadRequestException(
        `${t.label}: 이 조는 ${toDateOnlyString(f.date)}에 시행되는 구조 변경(재파싱 묶음)으로 자리가 바뀌는 중입니다` +
          `(오늘 ${formatJo(f.today.number, f.today.branchNumber)} → 그날부터 ${formatJo(f.live.number, f.live.branchNumber)}). ` +
          '이 조에 조문을 넣거나 옮겨 넣는 것은 그날 뒤에 하세요 — 본문 개정은 그대로 할 수 있습니다.',
      );
    }
    const h = held.get(positionKey(t.position));
    if (h && h.articleId !== t.articleId) {
      throw new BadRequestException(
        `${t.label}: 이 자리는 ${toDateOnlyString(h.date)} 전까지 다른 조문이 쓰고 있습니다(시행 예정 구조 변경이 그날 옮깁니다) — ` +
          '그날 뒤에 넣거나 다른 번호를 쓰세요.',
      );
    }
  }
}

@Injectable()
export class PoliciesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * 상위 규정 지정을 검증한다 (T-71).
   *
   * 순환(A→B→A)이 생기면 체계도를 그리는 쪽이 무한루프에 빠진다. DB 제약으로는 막을 수
   * 없어서 여기서 조상 사슬을 거슬러 올라가며 확인한다. 사슬 길이는 규정 수를 넘지 않으므로
   * 안전장치로 상한을 둔다(데이터가 이미 순환이면 루프를 못 빠져나온다).
   */
  private async assertParentAllowed(tenantId: string, policyId: string, parentId: string) {
    if (parentId === policyId) {
      throw new BadRequestException('규정을 자기 자신의 하위로 둘 수 없습니다.');
    }
    const parent = await this.prisma.policy.findFirst({
      where: { id: parentId, tenantId },
      select: { id: true },
    });
    if (!parent) throw new NotFoundException('상위 규정을 찾을 수 없습니다.');

    const total = await this.prisma.policy.count({ where: { tenantId } });
    let cursor: string | null = parentId;
    for (let hops = 0; cursor && hops <= total; hops += 1) {
      if (cursor === policyId) {
        throw new BadRequestException('상위 규정으로 지정하면 체계가 순환합니다.');
      }
      const row = await this.prisma.policy.findFirst({
        where: { id: cursor, tenantId },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }

  /**
   * 규정 체계도 (T-71). 상위·하위를 트리로 돌려준다.
   *
   * 한 번의 조회로 전부 받아 메모리에서 엮는다. 테넌트당 규정 수가 많아야 수천이고,
   * 재귀 쿼리를 쓰면 Prisma 밖으로 나가야 해서 얻는 것보다 잃는 게 많다.
   */
  async findHierarchy(tenantId: string) {
    const policies = await this.prisma.policy.findMany({
      where: { tenantId },
      select: {
        id: true,
        code: true,
        title: true,
        isActive: true,
        parentId: true,
        effectiveDate: true,
        _count: { select: { chapters: true } },
      },
      orderBy: [{ code: 'asc' }],
    });

    const roots = buildPolicyForest(policies);
    return { roots, total: policies.length };
  }

  /**
   * 시행 예정 개정 — 대시보드 "제·개정 예고"(T-132 ⑤). 승인됐지만 시행일 전인 조문 버전(`scheduledVersionWhere`)을
   * 규정·시행일별로 묶어 가까운 순으로. 예고는 규정의 시행일(`Policy.effectiveDate`)만 봐서, 조문 개정을 미래 시행일로
   * 승인해도 나오지 않았다.
   */
  async findScheduledChanges(tenantId: string, limit = 10) {
    const today = todayDateOnly();
    const articleSelect = {
      id: true,
      number: true,
      branchNumber: true,
      title: true,
      chapter: { select: { policy: { select: { id: true, code: true, title: true, isActive: true } } } },
    } as const;
    const rows = await this.prisma.articleVersion.findMany({
      where: { ...scheduledVersionWhere(today), article: { chapter: { policy: { tenantId } } } },
      orderBy: [{ effectiveDate: 'asc' }, { article: { number: 'asc' } }],
      select: { effectiveDate: true, article: { select: articleSelect } },
    });
    // 폐지 예정(T-132 ③) — 오늘은 시행 중이고 이 날부터 빠지는 조문
    const repeals = await this.prisma.articleVersion.findMany({
      where: { repealedOn: { gt: today }, status: { in: ['published', 'archived'] }, article: { chapter: { policy: { tenantId } } } },
      orderBy: [{ repealedOn: 'asc' }, { article: { number: 'asc' } }],
      select: { repealedOn: true, article: { select: articleSelect } },
    });
    const groups = new Map<
      string,
      {
        policyId: string;
        code: string;
        title: string;
        isActive: boolean;
        effectiveDate: string;
        articleIds: Set<string>;
        repealIds: Set<string>;
        firstArticle: string;
      }
    >();
    const add = (date: Date, article: (typeof rows)[number]['article'], kind: 'amend' | 'repeal') => {
      const p = article.chapter.policy;
      const day = toDateOnlyString(date);
      const key = `${p.id}|${day}`;
      const g = groups.get(key) ?? {
        policyId: p.id,
        code: p.code,
        title: p.title,
        isActive: p.isActive,
        effectiveDate: day,
        articleIds: new Set<string>(),
        repealIds: new Set<string>(),
        firstArticle: `${formatJo(article.number, article.branchNumber)}${article.title ? ` ${article.title}` : ''}`,
      };
      (kind === 'amend' ? g.articleIds : g.repealIds).add(article.id);
      groups.set(key, g);
    };
    for (const r of rows) add(r.effectiveDate!, r.article, 'amend');
    for (const r of repeals) add(r.repealedOn!, r.article, 'repeal');
    return [...groups.values()]
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.title.localeCompare(b.title))
      .slice(0, Math.min(Math.max(limit, 1), 50))
      .map(({ articleIds, repealIds, ...g }) => ({ ...g, articleCount: articleIds.size, repealCount: repealIds.size }));
  }

  /**
   * 조문마다 오늘 시행 중인 버전 하나(T-127 규칙). SQL 로 id 만 고른 뒤 그 버전만 읽는다 — 중첩 include 의 `take: 1` 은
   * Prisma 5.22 가 메모리에서 잘라 조문마다 발행 이력 전부(본문 포함)를 읽었다(`currentVersionIdsSql`).
   */
  private async currentVersionsOf<L extends boolean>(db: SnapshotDb, articleIds: string[], today: Date, withLawChange: L) {
    type Row = L extends true
      ? Prisma.ArticleVersionGetPayload<{ include: { changeEvent: typeof VERSION_LAW_CHANGE } }>
      : Prisma.ArticleVersionGetPayload<object>;
    if (!articleIds.length) return new Map<string, Row>();
    const picked = await db.$queryRaw<{ id: string }[]>(currentVersionIdsSql(articleIds, today));
    const rows = picked.length
      ? await db.articleVersion.findMany({
          where: { id: { in: picked.map((p) => p.id) } },
          ...(withLawChange ? { include: { changeEvent: VERSION_LAW_CHANGE } } : {}),
        })
      : [];
    return new Map(rows.map((v) => [v.articleId, v as Row]));
  }

  async findAll(tenantId: string) {
    return this.prisma.policy.findMany({
      where: { tenantId },
      include: {
        _count: { select: { chapters: true } },
        template: {
          select: { id: true, name: true, isDefault: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 규정 상세 — **"현재" = 오늘(한국 날짜) 시점의 시행본**(T-127).
   *
   * 조문마다 `versions` 는 오늘 시행 중인 버전 0~1개다(`common/as-of.ts` 의 currentVersionWhere·CURRENT_VERSION_ORDER — SQL 판 currentVersionIdsSql,
   * 시행일 없는 예전 시행본도 후보). 미래 시행일로 승인한 개정은 이전 본문이 `archived` 로 내려가 있어도 시행일 전까지
   * 그 이전 본문이 현재다 — 예전에는 `published` 를 그대로 보여 줘 미래 본문이 시행 전부터 현재처럼 보였다.
   * 오늘 폐지된 조문은 `versions` 가 비어 있다.
   *
   * @param opts.includePending 편집 권한자에게만 켠다. 시행본이 없는 조문에 최신 초안을
   *   `pendingVersion`으로 붙여, 넣은 내용이 "시행 전 초안"으로라도 보이게 한다.
   *   열람자에게 시행되지 않은 문구를 보여 주면 안 된다.
   * @param opts.detail 화면용(GET :id). 켜면 오늘 시점 조회와 같은 계층으로 조립하고(`current-view.ts`),
   *   조문마다 `currentState`·`repealedOn`·`scheduledVersions`(승인됐지만 시행일 전인 버전 — 열람자에게도 보인다)와
   *   `liveChapterId`·`liveSectionId`(편집 호출용 지금 행의 장·절)를, 규정에 `current` 요약을 싣는다.
   *   소속 확인용 내부 호출은 끈다(쿼리·조립 비용).
   */
  async findOne(tenantId: string, id: string, opts: { includePending?: boolean; detail?: boolean } = {}) {
    const today = todayDateOnly();
    // 한 스냅숏으로 읽고(T-180, PAT-22) — 조문 행·오늘 판 고르기·다시 읽기·시행 예정·초안이 같은 발행 이력 상태(common/read-snapshot).
    // 조립은 읽은 뒤 tx 밖에서 — 계산하는 동안 연결을 쥐지 않게
    const read = await readSnapshot(this.prisma, (db) => this.readOneIn(db, tenantId, id, today, opts));
    return this.shapeOne(read, today, opts);
  }

  /** findOne 의 읽기만(T-180) — 스냅숏 안에서 부른다 */
  private async readOneIn(db: SnapshotDb, tenantId: string, id: string, today: Date, opts: { includePending?: boolean; detail?: boolean }) {
    const policy = await db.policy.findFirst({
      where: { id, tenantId },
      include: {
        template: true,
        chapters: {
          include: {
            sections: { orderBy: { number: 'asc' } },
            articles: {
              include: {
                // 목차의 "의견 있음" 점 — 처리 안 된 의견이 있을 때만 찍는다
                _count: { select: { comments: { where: { isResolved: false } } } },
              },
              orderBy: ARTICLE_ORDER,
            },
          },
          orderBy: { number: 'asc' },
        },
        appendices: {
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        revisionReasons: {
          orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    const ids = policy.chapters.flatMap((c) => c.articles.map((a) => a.id));
    // 조문마다 오늘 시행 중인 버전 0~1개(연혁 탭의 날짜 3종 — 법령 시행일, T-111)
    const currentOf = await this.currentVersionsOf(db, ids, today, true);
    // 시행 예정(상세 화면만)
    const scheduledRows =
      opts.detail && ids.length
        ? await db.articleVersion.findMany({
            where: { articleId: { in: ids }, ...scheduledVersionWhere(today) },
            orderBy: [{ articleId: 'asc' }, { effectiveDate: 'asc' }, { versionNum: 'desc' }],
            include: { changeEvent: VERSION_LAW_CHANGE },
          })
        : [];
    // 초안·검토 중(편집 권한자만)
    const pending =
      opts.includePending && ids.length
        ? await db.articleVersion.findMany({
            where: { articleId: { in: ids }, status: { in: ['draft', 'review'] } },
            orderBy: [{ articleId: 'asc' }, { versionNum: 'desc' }],
            select: { id: true, articleId: true, versionNum: true, status: true, content: true, updatedAt: true },
          })
        : [];
    return { policy, currentOf, scheduledRows, pending };
  }

  /** findOne 의 조립(T-180) — 읽은 것만으로, 스냅숏 밖에서. DB 를 다시 읽지 않는다 */
  private shapeOne(
    { policy, currentOf, scheduledRows, pending }: Awaited<ReturnType<PoliciesService['readOneIn']>>,
    today: Date,
    opts: { includePending?: boolean; detail?: boolean },
  ) {
    const withCurrent = policy.chapters.map((c) => ({
      ...c,
      articles: c.articles.map((a) => ({ ...a, versions: currentOf.has(a.id) ? [currentOf.get(a.id)!] : [] })),
    }));

    // 시행 예정 — 날짜마다 그날 이기는 버전(번호가 큰 쪽) 하나, 이른 날부터. 상세 화면만
    const scheduledOf = new Map<string, ReturnType<typeof withLawChange<Prisma.ArticleVersionGetPayload<{ include: { changeEvent: typeof VERSION_LAW_CHANGE } }>>>[]>();
    for (const v of scheduledRows) {
      const list = scheduledOf.get(v.articleId) ?? [];
      const last = list.at(-1);
      if (last && last.effectiveDate?.getTime() === v.effectiveDate?.getTime()) continue;
      list.push(withLawChange(v));
      scheduledOf.set(v.articleId, list);
    }

    // 오늘 고른 버전 + 상태. 폐지된 조문은 자리를 얼린 값에서 찾아야 해서 조립까지 버전을 들고 간다
    const annotated = withCurrent.map((c) => ({
      ...c,
      articles: c.articles.map((a) => ({
        ...a,
        currentState: currentStateOf(a.versions[0], today, (scheduledOf.get(a.id)?.length ?? 0) > 0) as CurrentState,
        // 시행 예정 버전이 있는 조문만 오늘 자리를 얼린 계층에서 찾는다(current-view.ts)
        hasScheduled: scheduledOf.has(a.id),
      })),
    }));
    const present = <A extends (typeof annotated)[number]['articles'][number]>(a: A) => {
      const picked = a.versions[0];
      const inForce = a.currentState === 'in_force';
      return {
        ...a,
        versions: inForce ? [{ ...withLawChange(picked), phase: 'in_force' as const }] : [],
        ...(opts.detail
          ? {
              repealedOn: a.currentState === 'repealed' && picked?.repealedOn ? toDateOnlyString(picked.repealedOn) : null,
              // 폐지 예정(T-132 ③) — 오늘은 시행 중, 이 날부터 시행에서 빠진다
              repealScheduledOn: inForce && picked?.repealedOn ? toDateOnlyString(picked.repealedOn) : null,
              scheduledVersions: (scheduledOf.get(a.id) ?? []).map((v) => ({ ...v, phase: 'scheduled' as const })),
            }
          : {}),
      };
    };

    let chapters: Array<Omit<(typeof annotated)[number], 'articles'> & { articles: ReturnType<typeof present>[] }>;
    let current: Record<string, unknown> | undefined;
    if (opts.detail) {
      // 오늘 시점 조회와 같은 계층으로(T-110 ② 얼린 계층) — 편집용 지금 행의 장·절은 liveChapterId 로 남는다
      const built = buildCurrentChapters(annotated);
      chapters = built.chapters.map((c) => ({ ...c, articles: c.articles.map(present) }));
      const firstDates = [...scheduledOf.values()].map((l) => l[0]?.effectiveDate).filter((d): d is Date => !!d);
      const excludedJoKey = (a: { liveChapterId: string; liveNumber: number; liveBranchNumber: number | null }) =>
        `${a.liveChapterId}|${a.liveNumber}|${a.liveBranchNumber ?? 0}`;
      const excludedJoDate = new Map<string, Date>();
      for (const a of built.excluded) {
        const d = scheduledOf.get(a.id)?.[0]?.effectiveDate;
        const k = excludedJoKey(a);
        if (d && (!excludedJoDate.has(k) || d < excludedJoDate.get(k)!)) excludedJoDate.set(k, d);
      }
      current = {
        date: toDateOnlyString(today),
        scheduledCount: scheduledOf.size,
        // 오늘 자리가 지금 행과 다른 조문·장 수(미래 시행 구조 변경) — 0 이 아니면 화면이 구조 편집을 막는다
        structureChanges: built.displaced,
        // 폐지 예정인 조문 수(T-132 ③) — 오늘은 시행 중
        repealScheduledCount: annotated.reduce(
          (n, c) => n + c.articles.filter((a) => a.currentState === 'in_force' && a.versions[0]?.repealedOn).length,
          0,
        ),
        nextScheduledDate: firstDates.length
          ? toDateOnlyString(new Date(Math.min(...firstDates.map((d) => d.getTime()))))
          : null,
        // 오늘 본문의 자리를 다른 조문이 차지해 본문에서 뺀 시행 예정 조문(미래 시행 묶음의 새 조문 등)
        scheduledArticles: built.excluded.map((a) => ({
          id: a.id,
          number: a.number,
          branchNumber: a.branchNumber,
          clauseNumber: a.clauseNumber,
          itemNumber: a.itemNumber,
          title: a.title,
          liveChapterId: a.liveChapterId,
          // 버전 없는 조 머리(같은 조의 항이 모두 빠져 함께 뺀 것)는 그 조의 가장 이른 시행일
          effectiveDate: (() => {
            const d = scheduledOf.get(a.id)?.[0]?.effectiveDate ?? excludedJoDate.get(excludedJoKey(a));
            return d ? toDateOnlyString(d) : null;
          })(),
          // 제정·개정이유 창 — 본문 목록에 없는 조문이라 사유를 여기서 싣는다(T-132 ⑧)
          versionId: scheduledOf.get(a.id)?.[0]?.id ?? null,
          changeNote: scheduledOf.get(a.id)?.[0]?.changeNote ?? null,
        })),
      };
    } else {
      chapters = annotated.map((c) => ({ ...c, articles: c.articles.map(present) }));
    }
    const shaped = { ...policy, chapters, ...(current ? { current } : {}) };
    if (!opts.includePending) return shaped;

    const latest = new Map<string, (typeof pending)[number]>();
    for (const v of pending) if (!latest.has(v.articleId)) latest.set(v.articleId, v);
    return {
      ...shaped,
      chapters: shaped.chapters.map((c) => ({
        ...c,
        articles: c.articles.map((a) => ({ ...a, pendingVersion: latest.get(a.id) ?? null })),
      })),
    };
  }

  /**
   * 시점(as-of) 조회 — 기준일에 시행 중이던 본문을 재구성한다.
   *
   * 조문별로 "시행일이 기준일 이하인 시행분 중 가장 나중" 버전을 고른다.
   * 기준일에 아직 시행되지 않은 조는 결과에서 제외한다(그날 존재하지 않던 조문).
   * 고른 버전이 그날 폐지돼 있으면 그 조문도 뺀다 — 옛 버전으로 되살리지 않고, 폐지일과 함께 따로 알린다(T-126).
   * `findOne`과 같은 형태로 돌려주므로 전문 보기·인쇄·PDF가 그대로 재사용된다.
   */
  async findOneAsOf(tenantId: string, id: string, asOf: string) {
    // 날짜부터 — 잘못된 요청에는 연결을 잡지 않는다
    const asOfDate = parseDateOnly(asOf);
    if (!asOfDate) {
      throw new BadRequestException('기준일(date)은 YYYY-MM-DD 형식이어야 합니다.');
    }
    // 한 스냅숏으로 읽고(T-180, PAT-22) — 계층(장·절·조문 행)과 판·폐지·개정이유가 같은 발행 이력 상태. 조립은 읽은 뒤 tx 밖에서
    const read = await readSnapshot(this.prisma, (db) => this.readAsOfIn(db, tenantId, id, asOfDate));
    return this.shapeAsOf(read, asOf, asOfDate);
  }

  /** findOneAsOf 의 읽기만(T-180) — 스냅숏 안에서 부른다 */
  private async readAsOfIn(db: SnapshotDb, tenantId: string, id: string, asOfDate: Date) {
    const policy = await db.policy.findFirst({
      where: { id, tenantId },
      include: {
        template: true,
        chapters: {
          include: {
            sections: { orderBy: { number: 'asc' } },
            articles: {
              include: {
                versions: {
                  // 시행 이력이 있는 버전만 후보(초안·검토중 제외) — 규칙은 common/as-of.ts
                  where: asOfVersionWhere(asOfDate),
                  orderBy: AS_OF_VERSION_ORDER,
                  take: 1,
                },
              },
              orderBy: ARTICLE_ORDER,
            },
          },
          orderBy: { number: 'asc' },
        },
        appendices: {
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        revisionReasons: {
          where: { OR: [{ effectiveDate: null }, { effectiveDate: { lte: asOfDate } }] },
          orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    // 시행일이 하나도 기록되지 않았다면 시점 조회가 무의미하다는 신호
    return { policy, hasEffectiveDates: await this.hasAnyEffectiveDate(db, id) };
  }

  /** findOneAsOf 의 조립(T-180) — 읽은 것만으로, 스냅숏 밖에서. DB 를 다시 읽지 않는다 */
  private shapeAsOf({ policy, hasEffectiveDates }: Awaited<ReturnType<PoliciesService['readAsOfIn']>>, asOf: string, asOfDate: Date) {
    let omittedArticles = 0;
    const repealedArticles: Array<{
      id: string;
      number: number;
      branchNumber: number | null;
      clauseNumber: number | null;
      itemNumber: number | null;
      title: string | null;
      repealedOn: string;
    }> = [];
    const chapters = policy.chapters.map((chapter) => {
      const articles = chapter.articles.filter((article) => {
        const state = asOfState(article.versions[0], asOfDate);
        if (state === 'in_force') return true;
        if (state === 'repealed') {
          // 그때의 계층으로(T-110 ② — 얼린 계층이 있으면)
          const placed = placeArticle(article);
          repealedArticles.push({
            id: article.id,
            number: placed.number,
            branchNumber: placed.branchNumber,
            clauseNumber: placed.clauseNumber,
            itemNumber: placed.itemNumber,
            title: placed.title,
            repealedOn: toDateOnlyString(article.versions[0].repealedOn!),
          });
        } else {
          omittedArticles += 1;
        }
        return false;
      });
      return { ...chapter, articles };
    });

    return {
      ...policy,
      // 고른 버전이 얼린 계층을 가지면 그때의 자리·제목·장으로 조립한다(T-110 ②, PAT-04)
      chapters: placeAsOf(chapters),
      asOf: {
        date: asOf,
        omittedArticles,
        /** 그날 폐지돼 있어 뺀 조문(T-126) — "그 시점에 없던 조문"과 따로 알린다 */
        repealedArticles,
        hasEffectiveDates,
      },
    };
  }

  /**
   * 신구조문대비표 — 두 시점 스냅샷을 조문 단위로 맞댄다.
   * 국가법령정보센터의 신구법비교에 해당하되 대상이 우리 규정이라 외부 데이터가 필요 없다.
   */
  async compareAsOf(tenantId: string, id: string, from: string, to: string) {
    const fromDate = parseDateOnly(from);
    const toDate = parseDateOnly(to);
    if (!fromDate || !toDate) {
      throw new BadRequestException('비교 시점(from·to)은 YYYY-MM-DD 형식이어야 합니다.');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from은 to보다 앞선 날짜여야 합니다.');
    }

    // 두 기준일을 한 스냅숏에서(T-180) — 같은 발행 이력 상태의 두 시점(한 연결에서 차례로). 맞대기는 읽은 뒤 tx 밖에서
    const { policy, beforeRows, afterRows } = await readSnapshot(this.prisma, async (db) => {
      const found = await db.policy.findFirst({
        where: { id, tenantId },
        select: { id: true, code: true, title: true },
      });
      if (!found) throw new NotFoundException('Policy not found');
      const [before, after] = await Promise.all([this.articlesAsOf(db, id, fromDate), this.articlesAsOf(db, id, toDate)]);
      return { policy: found, beforeRows: before, afterRows: after };
    });

    const { rows, summary } = buildComparisonRows(beforeRows, afterRows);
    return { policy, from, to, summary, rows };
  }

  /**
   * 규정 간 비교 (T-91). 서로 다른 두 규정을 나란히 놓는다.
   *
   * `compareAsOf` 는 같은 규정의 두 시점이라 `articleId` 로 짝을 짓지만, 여기는
   * 공유하는 id 가 없어 위치(조·항·목 번호)로 맞댄다. 그 한계는
   * `buildCrossPolicyRows` 주석과 응답의 `summary.suspect` 에 드러난다.
   *
   * **두 규정 모두 테넌트 소속인지 각각 확인한다.** 기준 규정만 보고 대상 id 를
   * 그대로 쓰면 남의 회사 규정 본문이 비교표에 실려 나간다.
   */
  async compareWithPolicy(tenantId: string, id: string, targetId: string) {
    if (id === targetId) {
      throw new BadRequestException('같은 규정끼리는 비교할 수 없습니다.');
    }
    const today = todayDateOnly();
    // 두 규정을 한 스냅숏에서(T-180) — 규정끼리도 같은 발행 이력 상태. 맞대기는 읽은 뒤 tx 밖에서
    const { left, right, leftRows, rightRows } = await readSnapshot(this.prisma, async (db) => {
      const [l, r] = await Promise.all([
        db.policy.findFirst({
          where: { id, tenantId },
          select: { id: true, code: true, title: true },
        }),
        db.policy.findFirst({
          where: { id: targetId, tenantId },
          select: { id: true, code: true, title: true },
        }),
      ]);
      if (!l || !r) throw new NotFoundException('Policy not found');
      const [lr, rr] = await Promise.all([this.articlesCurrent(db, l.id, today), this.articlesCurrent(db, r.id, today)]);
      return { left: l, right: r, leftRows: lr, rightRows: rr };
    });

    const { rows, summary } = buildCrossPolicyRows(leftRows, rightRows);
    return { left, right, summary, rows, date: toDateOnlyString(today) };
  }

  /**
   * 3단비교 (T-56). 기준 규정 아래 두 단계(세칙·지침)를 나란히 놓는다.
   *
   * 짝짓기는 하위 조문 본문의 **상위 규정 인용**으로 한다(`policy-three-way.ts`).
   * 조 번호를 그냥 맞추는 방식은 쓰지 않았다 — 세칙 제1조가 규정 제1조와 관계있다는
   * 보장이 전혀 없어서 표가 그럴듯하게 틀린다.
   */
  async threeWay(tenantId: string, id: string) {
    const today = todayDateOnly();
    // 기준·하위·손자 규정을 한 스냅숏에서(T-180) — 규정끼리도 같은 발행 이력 상태. 짝짓기는 읽은 뒤 tx 밖에서
    const { base, levels, articlesByPolicy } = await readSnapshot(this.prisma, async (db) => {
      const found = await db.policy.findFirst({
        where: { id, tenantId },
        select: { id: true, code: true, title: true },
      });
      if (!found) throw new NotFoundException('Policy not found');

      // 하위 2단계까지만 본다. 3단비교라는 이름 그대로다.
      const children = await db.policy.findMany({
        where: { tenantId, parentId: id },
        select: { id: true, code: true, title: true },
        orderBy: { code: 'asc' },
      });
      const grandchildren = children.length
        ? await db.policy.findMany({
            where: { tenantId, parentId: { in: children.map((c) => c.id) } },
            select: { id: true, code: true, title: true },
            orderBy: { code: 'asc' },
          })
        : [];

      const all: ThreeWayPolicy[] = [
        { ...found, level: 0 },
        ...children.map((c) => ({ ...c, level: 1 })),
        ...grandchildren.map((g) => ({ ...g, level: 2 })),
      ];
      const byPolicy = new Map<string, ThreeWayArticle[]>();
      for (const policy of all) {
        byPolicy.set(policy.id, await this.publishedArticles(db, policy.id, today));
      }
      return { base: found, levels: all, articlesByPolicy: byPolicy };
    });

    const { rows, unmatched, matchedCount } = buildThreeWayRows(
      articlesByPolicy.get(base.id) || [],
      levels
        .filter((p) => p.level > 0)
        .map((policy) => ({ policy, articles: articlesByPolicy.get(policy.id) || [] })),
    );

    return {
      base,
      levels,
      rows,
      unmatched,
      summary: {
        baseArticles: rows.length,
        related: matchedCount,
        unmatched: unmatched.reduce((n, row) => n + row.related.length, 0),
      },
      // 오늘 시행 중인 본문 기준(T-127)
      date: toDateOnlyString(today),
    };
  }

  /**
   * 3단비교용 조문 목록 — 규정 상세 화면과 같은 "현재" 조립(T-127). 본문은 오늘 시행 중인 것만이고,
   * 초안만·폐지·시행 예정 조문은 본문 없이 자리만(예전과 같다). 시행일 전인 개정 문구로 인용을 짝짓지 않는다.
   */
  private async publishedArticles(db: SnapshotDb, policyId: string, today: Date): Promise<ThreeWayArticle[]> {
    return (await this.currentArticles(db, policyId, today)).map((a) => ({
      id: a.id,
      number: a.number,
      branchNumber: a.branchNumber,
      clauseNumber: a.clauseNumber,
      itemNumber: a.itemNumber,
      title: a.title || '',
      content: a.currentState === 'in_force' ? a.versions[0]?.content || '' : '',
    }));
  }

  /**
   * 규정의 "현재" 조문 — 규정 상세 화면과 같은 규칙·같은 계층(T-127): 오늘(한국 날짜) 시행 중인 버전,
   * 오늘의 자리(얼린 계층, 조 머리 따라감). 시행일 전인 개정은 넣지 않는다.
   */
  private async currentArticles(db: SnapshotDb, policyId: string, today: Date) {
    const chapters = await db.chapter.findMany({
      where: { policyId },
      include: {
        sections: { orderBy: { number: 'asc' } },
        articles: { orderBy: ARTICLE_ORDER },
      },
      orderBy: { number: 'asc' },
    });
    const ids = chapters.flatMap((c) => c.articles.map((a) => a.id));
    const currentOf = await this.currentVersionsOf(db, ids, today, false);
    const scheduled = ids.length
      ? new Set(
          (
            await db.articleVersion.findMany({
              where: { articleId: { in: ids }, ...scheduledVersionWhere(today) },
              select: { articleId: true },
              distinct: ['articleId'],
            })
          ).map((v) => v.articleId),
        )
      : new Set<string>();
    const built = buildCurrentChapters(
      chapters.map((c) => ({
        ...c,
        articles: c.articles.map((a) => {
          const versions = currentOf.has(a.id) ? [currentOf.get(a.id)!] : [];
          return {
            ...a,
            versions,
            currentState: currentStateOf(versions[0], today, scheduled.has(a.id)),
            hasScheduled: scheduled.has(a.id),
          };
        }),
      })),
    );
    return built.chapters.flatMap((c) => c.articles);
  }

  /**
   * 규정 간 비교의 "지금 본문" (T-91). 규정 상세 화면과 같은 기준을 쓴다 — 화면에는 있는 조문이 비교표에서 사라지면
   * "왜 다르냐"는 질문이 생긴다. T-127 부터 그 기준이 "오늘 시행 중인 본문"이라 시행일 전인 개정은 비교하지 않는다.
   */
  private async articlesCurrent(db: SnapshotDb, policyId: string, today: Date): Promise<CompareArticleInput[]> {
    return (await this.currentArticles(db, policyId, today))
      .filter((a) => a.currentState === 'in_force')
      .map((a) => ({
        id: a.id,
        number: a.number,
        branchNumber: a.branchNumber,
        clauseNumber: a.clauseNumber,
        itemNumber: a.itemNumber,
        title: a.title ?? '',
        content: a.versions[0].content ?? '',
        effectiveDate: a.versions[0].effectiveDate ? toDateOnlyString(a.versions[0].effectiveDate) : null,
      }));
  }

  private async articlesAsOf(db: SnapshotDb, policyId: string, asOfDate: Date): Promise<CompareArticleInput[]> {
    const articles = await db.article.findMany({
      where: { chapter: { policyId } },
      include: {
        versions: {
          where: asOfVersionWhere(asOfDate),
          orderBy: AS_OF_VERSION_ORDER,
          take: 1,
        },
      },
      orderBy: ARTICLE_ORDER,
    });

    return articles
      .filter((article) => asOfState(article.versions[0], asOfDate) === 'in_force')
      .map((article) => {
        const version = article.versions[0];
        // 그날의 계층으로 표기한다(T-110 ② — 얼린 계층이 있으면)
        const placed = placeArticle(article);
        return {
          id: article.id,
          number: placed.number,
          branchNumber: placed.branchNumber,
          clauseNumber: placed.clauseNumber,
          itemNumber: placed.itemNumber,
          title: placed.title ?? '',
          content: version.content ?? '',
          effectiveDate: version.effectiveDate ? toDateOnlyString(version.effectiveDate) : null,
        };
      });
  }

  private async hasAnyEffectiveDate(db: SnapshotDb, policyId: string): Promise<boolean> {
    const count = await db.articleVersion.count({
      where: {
        effectiveDate: { not: null },
        article: { chapter: { policyId } },
      },
    });
    return count > 0;
  }

  /** 시점 조회 슬라이더용: 이 규정에서 실제로 본문이 바뀐 날짜들 — 조문이 폐지돼 빠진 날도 넣는다(T-126) */
  async listEffectiveDates(tenantId: string, id: string) {
    const policy = await this.prisma.policy.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!policy) throw new NotFoundException('Policy not found');

    const [rows, repeals] = await Promise.all([
      this.prisma.articleVersion.findMany({
        where: {
          status: { in: ['published', 'archived'] },
          effectiveDate: { not: null },
          article: { chapter: { policyId: id } },
        },
        select: { effectiveDate: true },
        distinct: ['effectiveDate'],
      }),
      this.prisma.articleVersion.findMany({
        where: { repealedOn: { not: null }, article: { chapter: { policyId: id } } },
        select: { repealedOn: true },
        distinct: ['repealedOn'],
      }),
    ]);
    const days = new Set<string>();
    for (const r of rows) if (r.effectiveDate) days.add(toDateOnlyString(r.effectiveDate));
    for (const r of repeals) if (r.repealedOn) days.add(toDateOnlyString(r.repealedOn));
    return [...days].sort().reverse();
  }

  async create(tenantId: string, dto: CreatePolicyDto, userId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (dto.templateId) {
      if (tenant.plan === 'starter') {
        throw new ForbiddenException('Policy template assignment requires pro plan or higher');
      }
      const template = await this.prisma.policyTemplate.findFirst({
        where: { id: dto.templateId, tenantId, isActive: true },
      });
      if (!template) throw new NotFoundException('Template not found');
    }

    const { department, category, ...baseDto } = dto as any;
    const metadata = {
      ...(department?.trim() ? { department: department.trim() } : {}),
      ...(category?.trim() ? { category: category.trim() } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      // 플랜 상한·코드 중복은 회사 행을 잠근 뒤 센다(T-135) — 잠그지 않고 세면 마지막 한 자리에 둘이 들어간다
      await claimPolicySlots(tx, tenantId, [dto.code]);
      const created = await tx.policy.create({
        data: {
          tenantId,
          ...baseDto,
          metadata: Object.keys(metadata).length ? (metadata as any) : undefined,
        },
      });
      await this.audit.log(
        {
          tenantId,
          userId,
          action: 'policy.create',
          entityType: 'Policy',
          entityId: created.id,
          details: { code: created.code },
        },
        tx,
      );
      return created;
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePolicyDto, userId: string) {
    await this.assertPolicyInTenant(tenantId, id);
    if (dto.templateId !== undefined) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.plan === 'starter') {
        throw new ForbiddenException('Policy template assignment requires pro plan or higher');
      }
    }
    if (dto.templateId) {
      const template = await this.prisma.policyTemplate.findFirst({
        where: { id: dto.templateId, tenantId, isActive: true },
      });
      if (!template) throw new NotFoundException('Template not found');
    }
    if (dto.templateId === null) {
      (dto as any).templateId = null;
    }
    if (dto.parentId) {
      await this.assertParentAllowed(tenantId, id, dto.parentId);
    }
    /** 저장할 값 — 메타데이터(부서·분류·개정 알림)는 넘겨받은 저장값(잠근 뒤 다시 읽은 것)에 고쳐 쓴다 */
    const buildData = (storedMeta: unknown) => {
      const nextDto = { ...dto } as any;
      const hasDepartment = Object.prototype.hasOwnProperty.call(nextDto, 'department');
      const hasCategory = Object.prototype.hasOwnProperty.call(nextDto, 'category');
      const currentMeta =
        storedMeta && typeof storedMeta === 'object'
          ? ({ ...(storedMeta as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      if (hasDepartment) {
        const v = String(nextDto.department ?? '').trim();
        if (v) currentMeta.department = v;
        else delete currentMeta.department;
        delete nextDto.department;
      }
      if (hasCategory) {
        const v = String(nextDto.category ?? '').trim();
        if (v) currentMeta.category = v;
        else delete currentMeta.category;
        delete nextDto.category;
      }
      if (hasDepartment || hasCategory) {
        nextDto.metadata = Object.keys(currentMeta).length ? (currentMeta as any) : null;
      }
      const hasRevisionNotify = Object.prototype.hasOwnProperty.call(nextDto, 'revisionNotify');
      if (hasRevisionNotify) {
        const raw = nextDto.revisionNotify;
        delete nextDto.revisionNotify;
        if (raw == null) {
          delete currentMeta.revisionNotify;
          delete currentMeta.revisionNotifyEnabled;
        } else {
          currentMeta.revisionNotify = {
            enabled: raw.enabled === true,
            userIds: Array.isArray(raw.userIds) ? raw.userIds : [],
            groupIds: Array.isArray(raw.groupIds) ? raw.groupIds : [],
          };
          delete currentMeta.revisionNotifyEnabled;
        }
        nextDto.metadata = Object.keys(currentMeta).length ? (currentMeta as any) : null;
      }
      if (Object.prototype.hasOwnProperty.call(nextDto, 'revisionDate')) {
        const raw = nextDto.revisionDate;
        nextDto.revisionDate = raw ? new Date(String(raw)) : null;
      }
      if (Object.prototype.hasOwnProperty.call(nextDto, 'effectiveDate')) {
        const raw = nextDto.effectiveDate;
        nextDto.effectiveDate = raw ? new Date(String(raw)) : null;
      }
      return nextDto;
    };
    // 규정 행을 잠그고 메타데이터를 다시 읽는다(T-131) — 다른 저장과 겹쳐 서로 고친 키를 지우지 않게. 예전처럼 긴 작업(묶음 승인 등)이
    // 끝나길 기다렸다 저장하되, 한도(30초)를 넘으면 409
    const { updated, fields } = await this.prisma.$transaction(
      async (tx) => {
        await lockPolicyRow(tx, id, LONG_LOCK_WAIT_MS);
        const fresh = await tx.policy.findUniqueOrThrow({ where: { id }, select: { metadata: true } });
        const nextDto = buildData(fresh.metadata);
        return { updated: await tx.policy.update({ where: { id }, data: nextDto }), fields: Object.keys(nextDto) };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.update',
      entityType: 'Policy',
      entityId: id,
      details: { fields },
    });
    return updated;
  }

  async remove(tenantId: string, id: string, userId: string) {
    await this.assertPolicyInTenant(tenantId, id);
    // 규정 → 지울 조문(id 순)을 잡은 뒤 지운다(T-131) — 지우기가 스캔 순서로 잠그면 여러 조문을 id 순으로 가리키는 insert 와
    // 서로 기다리다 멈출 수 있고, 진행 중인 묶음 승인 뒤에 줄 선다
    await this.prisma.$transaction(
      async (tx) => {
        await lockPolicyForDelete(tx, id, LONG_LOCK_WAIT_MS);
        await lockArticlesForDelete(tx, { policyId: id }, LONG_LOCK_WAIT_MS);
        await tx.policy.delete({ where: { id } });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.delete',
      entityType: 'Policy',
      entityId: id,
    });
  }

  async createChapter(tenantId: string, policyId: string, dto: CreateChapterDto, userId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const header = this.chapterHeader(() => newChapterHeader(dto));
    const ch = await this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      return tx.chapter.create({ data: { policyId, number: dto.number, ...header } });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'chapter.create',
      entityType: 'Chapter',
      entityId: ch.id,
      details: { policyId },
    });
    return ch;
  }

  async updateChapter(tenantId: string, policyId: string, chapterId: string, dto: UpdateChapterDto) {
    await this.assertPolicyInTenant(tenantId, policyId);
    return this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      // 잠근 뒤 읽는다(T-131) — 그 사이 재파싱 승인이 장 제목을 바꿨으면 그 값에 고친다(옛 제목을 되쓰지 않는다)
      const chapter = await tx.chapter.findFirst({ where: { id: chapterId, policyId } });
      if (!chapter) throw new NotFoundException('Chapter not found');
      // 생성에는 있고 수정에는 없던 검사다(T-84). 없으면 "제목 없는 보이는 장"을
      // 만들 수 있고, 그 장은 화면·인쇄에 제목 없는 빈 머리글로 나온다.
      const header = this.chapterHeader(() =>
        applyChapterHeaderPatch(
          { title: chapter.title, suppressHeader: chapter.suppressHeader },
          dto,
        ),
      );
      return tx.chapter.update({ where: { id: chapterId }, data: { ...dto, ...header } });
    });
  }

  /** 불변식 위반을 400 으로 바꾼다(규칙 자체는 DB 없이 검사할 수 있게 밖에 둔다) */
  private chapterHeader(run: () => ChapterHeaderState): ChapterHeaderState {
    try {
      return run();
    } catch (e) {
      if (e instanceof ChapterHeaderError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  async removeChapter(tenantId: string, policyId: string, chapterId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    await this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      // 잠근 뒤 다시 확인하고, 지울 조문을 id 순으로 잡은 뒤 지운다(T-131)
      const chapter = await tx.chapter.findFirst({ where: { id: chapterId, policyId }, select: { id: true } });
      if (!chapter) throw new NotFoundException('Chapter not found');
      await lockArticlesForDelete(tx, { chapterId });
      await tx.chapter.delete({ where: { id: chapterId } });
    });
  }

  /**
   * 조문에 지정된 절이 같은 장에 속하는지 검증한다.
   * `undefined`(미지정)와 `null`(절에서 분리)을 구분해서 돌려준다.
   */
  private async resolveSectionId(
    chapterId: string,
    sectionId: string | null | undefined,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null | undefined> {
    if (sectionId === undefined) return undefined;
    if (sectionId === null || sectionId === '') return null;
    const section = await db.section.findFirst({
      where: { id: sectionId, chapterId },
      select: { id: true },
    });
    if (!section) throw new BadRequestException('해당 장에 속한 절이 아닙니다.');
    return section.id;
  }

  /** 절(節)은 선택 계층이다. 절을 지워도 소속 조문은 남고 sectionId만 해제된다(ADR-0011) */
  private async findChapterOrThrow(tenantId: string, policyId: string, chapterId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const chapter = await this.prisma.chapter.findFirst({ where: { id: chapterId, policyId } });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }

  async createSection(
    tenantId: string,
    policyId: string,
    chapterId: string,
    dto: CreateSectionDto,
    userId: string,
  ) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const title = String(dto.title ?? '').trim();
    if (!title) throw new BadRequestException('절 제목을 입력하세요.');
    const section = await this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      return tx.section.create({ data: { chapterId, number: dto.number, title } });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'section.create',
      entityType: 'Section',
      entityId: section.id,
      details: { policyId, chapterId },
    });
    return section;
  }

  async updateSection(
    tenantId: string,
    policyId: string,
    chapterId: string,
    sectionId: string,
    dto: UpdateSectionDto,
  ) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const section = await this.prisma.section.findFirst({ where: { id: sectionId, chapterId } });
    if (!section) throw new NotFoundException('Section not found');
    const data: { number?: number; title?: string } = {};
    if (dto.number !== undefined) data.number = dto.number;
    if (dto.title !== undefined) {
      const title = String(dto.title).trim();
      if (!title) throw new BadRequestException('절 제목을 입력하세요.');
      data.title = title;
    }
    return this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      return tx.section.update({ where: { id: sectionId }, data });
    });
  }

  async removeSection(tenantId: string, policyId: string, chapterId: string, sectionId: string) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const section = await this.prisma.section.findFirst({ where: { id: sectionId, chapterId } });
    if (!section) throw new NotFoundException('Section not found');
    // onDelete: SetNull 로 소속 조문의 sectionId만 해제된다(조문은 보존)
    await this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      await tx.section.delete({ where: { id: sectionId } });
    });
  }

  async createArticle(
    tenantId: string,
    policyId: string,
    chapterId: string,
    dto: CreateArticleDto,
  ) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const sectionId = await this.resolveSectionId(chapterId, dto.sectionId);

    const article = await this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      const position = {
        number: dto.number,
        branchNumber: dto.branchNumber ?? null,
        clauseNumber: dto.clauseNumber ?? null,
        itemNumber: dto.itemNumber ?? null,
      };
      await assertNotIntoMovingJo(tx, policyId, [{ position, label: labelOf(position) }]);
      return tx.article.create({
      data: {
        chapterId,
        sectionId,
        number: dto.number,
        branchNumber: dto.branchNumber ?? null,
        title: (dto.title ?? '').trim(),
        clauseNumber: dto.clauseNumber,
        itemNumber: dto.itemNumber,
        hasPrecedent: dto.hasPrecedent ?? false,
        hasRelatedLaw: dto.hasRelatedLaw ?? false,
        hasRelatedRule: dto.hasRelatedRule ?? false,
        relatedPrecedentNote: dto.relatedPrecedentNote?.trim() || null,
        relatedLawNote: dto.relatedLawNote?.trim() || null,
        relatedRuleNote: dto.relatedRuleNote?.trim() || null,
      },
      });
    });

    if (dto.content) {
      // 초안이다 — 본문의 변수 표식은 검토 요청 때 값으로 바뀐다(T-109)
      await this.prisma.articleVersion.create({
        data: {
          articleId: article.id,
          versionNum: 1,
          content: dto.content,
          status: 'draft',
        },
      });
    }
    return article;
  }

  async updateArticle(tenantId: string, policyId: string, chapterId: string, articleId: string, dto: UpdateArticleDto) {
    // 장이 이 규정 소속인지까지 확인한다. 규정만 보면 남의 장·조문을 고칠 수 있다(T-41).
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const data: Record<string, unknown> = { ...dto };
    for (const key of ['relatedPrecedentNote', 'relatedLawNote', 'relatedRuleNote'] as const) {
      if (data[key] !== undefined) {
        const t = String(data[key] ?? '').trim();
        data[key] = t.length ? t : null;
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      // 잠근 뒤 읽는다(T-131) — 그 사이 재파싱 승인이 조문을 옮겼으면 옛 자리로 되돌리지 않게
      const article = await this.lockedArticle(tx, policyId, chapterId, articleId);
      // 절 이동: 같은 장의 절인지 검증. null이면 절에서 분리
      if (dto.sectionId !== undefined) {
        data.sectionId = await this.resolveSectionId(chapterId, dto.sectionId, tx);
      }
      const moved = (['number', 'branchNumber', 'clauseNumber', 'itemNumber'] as const).some(
        (k) => dto[k as keyof UpdateArticleDto] !== undefined && dto[k as keyof UpdateArticleDto] !== article[k],
      );
      if (moved) {
        const position = {
          number: (dto.number ?? article.number) as number,
          branchNumber: (dto.branchNumber !== undefined ? dto.branchNumber : article.branchNumber) ?? null,
          clauseNumber: (dto.clauseNumber !== undefined ? dto.clauseNumber : article.clauseNumber) ?? null,
          itemNumber: (dto.itemNumber !== undefined ? dto.itemNumber : article.itemNumber) ?? null,
        };
        await assertNoFrozenClash(tx, policyId, [{ articleId, position, label: labelOf(position) }]);
        // 다른 조로 옮길 때만 — 같은 조 안의 항·목·제목 고치기는 그날부터의 자리만 바꾼다(T-132 ⑦)
        if (joKeyOf(position) !== joKeyOf(article)) {
          await assertNotIntoMovingJo(tx, policyId, [{ articleId, position, label: labelOf(position) }]);
        }
      }
      return tx.article.update({ where: { id: articleId }, data: data as any });
    });
  }

  async removeArticle(tenantId: string, policyId: string, chapterId: string, articleId: string) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    await this.prisma.$transaction(async (tx) => {
      await lockPolicy(tx, policyId);
      await this.lockedArticle(tx, policyId, chapterId, articleId);
      await lockArticlesForDelete(tx, { articleId });
      await tx.article.delete({ where: { id: articleId } });
    });
  }

  /**
   * 규정을 잠근 뒤 조문을 다시 읽는다(T-131) — 이 규정에 없으면(지워졌거나 남의 조문) 404, 그 사이 같은 규정의 다른 장으로
   * 옮겨졌으면 409
   */
  private async lockedArticle(tx: Prisma.TransactionClient, policyId: string, chapterId: string, articleId: string) {
    const article = await tx.article.findFirst({ where: { id: articleId, chapter: { policyId } } });
    if (!article) throw new NotFoundException('Article not found');
    if (article.chapterId !== chapterId) {
      throw new ConflictException('그 사이 이 조문이 다른 장으로 옮겨졌습니다 — 화면을 새로 고친 뒤 다시 시도하세요.');
    }
    return article;
  }

  /**
   * 조 순서 일괄 재정렬 (T-60).
   *
   * 가져온 규정은 조 순서가 원문과 어긋나거나 장이 잘못 잡히는 일이 잦다. 조를 하나씩
   * 고치던 것을 목차에서 끌어 놓고 한 번에 다시 매긴다. 조 번호는 장을 가로질러
   * 이어지므로(제1장 제1·2조 → 제2장 제3조) 하나만 옮겨도 뒤가 전부 밀린다.
   *
   * 한 트랜잭션으로 처리한다. 중간에 끊기면 조 번호가 겹치거나 비는 상태가 남는데,
   * 그건 목차·안정 링크(T-73)·인쇄가 동시에 무너진 상태다.
   */
  async reorderArticles(
    tenantId: string,
    policyId: string,
    order: ReorderTarget[],
    userId: string,
  ) {
    await this.assertPolicyInTenant(tenantId, policyId);
    // 규정을 잠근 뒤 읽고 계획을 세운다(T-131) — 그 사이 재파싱 승인이 조문을 옮기거나 새 조문을 넣었으면, 그 전 목록으로 세운
    // 계획이 승인을 되돌리지 않게(새 조가 빠진 차례면 계획 단계에서 400)
    const changed = await this.prisma.$transaction(
      async (tx) => {
        await lockPolicy(tx, policyId, LONG_LOCK_WAIT_MS);
        const chapters = await tx.chapter.findMany({ where: { policyId }, select: { id: true } });
        const rows = await tx.article.findMany({
          where: { chapter: { policyId } },
          select: { id: true, chapterId: true, sectionId: true, number: true, branchNumber: true, clauseNumber: true, itemNumber: true },
        });
        let changes;
        try {
          changes = buildReorderPlan(rows, order, chapters.map((c) => c.id));
        } catch (e) {
          if (e instanceof ReorderPlanError) throw new BadRequestException(e.message);
          throw e;
        }
        if (changes.length === 0) return 0;
        const rowById = new Map(rows.map((r) => [r.id, r]));
        const moves = changes
          .filter((c) => {
            const r = rowById.get(c.id)!;
            return r.number !== c.number || (r.branchNumber ?? null) !== (c.branchNumber ?? null);
          })
          .map((c) => {
            const r = rowById.get(c.id)!;
            const position = { number: c.number, branchNumber: c.branchNumber ?? null, clauseNumber: r.clauseNumber, itemNumber: r.itemNumber };
            return { articleId: c.id, position, label: labelOf(position) };
          });
        await assertNoScheduledMoves(tx, policyId);
        await assertNoFrozenClash(tx, policyId, moves);
        for (const c of changes) {
          await tx.article.update({
            where: { id: c.id },
            data: { number: c.number, branchNumber: c.branchNumber, chapterId: c.chapterId, sectionId: c.sectionId },
          });
        }
        return changes.length;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    if (changed === 0) return { changed: 0 };

    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.articles.reorder',
      entityType: 'Policy',
      entityId: policyId,
      details: { changed, order: order.map((t) => (t.branch ? `${t.jo}의${t.branch}` : t.jo)) },
    });

    return { changed };
  }

  /** 재정렬 화면이 시작점으로 쓸 현재 순서 */
  async listJoOrder(tenantId: string, policyId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const chapters = await this.prisma.chapter.findMany({
      where: { policyId },
      select: { id: true, number: true, title: true, articles: { select: { number: true, branchNumber: true } } },
      orderBy: { number: 'asc' },
    });
    return { order: currentJoOrder(chapters) };
  }

  async createAppendix(tenantId: string, policyId: string, dto: CreatePolicyAppendixDto) {
    await this.assertPolicyInTenant(tenantId, policyId);
    return this.prisma.policyAppendix.create({
      data: {
        policyId,
        kind: dto.kind,
        title: dto.title.trim(),
        body: dto.body ?? '',
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateAppendix(
    tenantId: string,
    policyId: string,
    appendixId: string,
    dto: UpdatePolicyAppendixDto,
  ) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const row = await this.prisma.policyAppendix.findFirst({
      where: { id: appendixId, policyId },
    });
    if (!row) throw new NotFoundException('Appendix not found');
    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.policyAppendix.update({
      where: { id: appendixId },
      data: data as any,
    });
  }

  async removeAppendix(tenantId: string, policyId: string, appendixId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const row = await this.prisma.policyAppendix.findFirst({
      where: { id: appendixId, policyId },
    });
    if (!row) throw new NotFoundException('Appendix not found');
    await this.prisma.policyAppendix.delete({ where: { id: appendixId } });
  }

  // --- 제정·개정 이유(개정문) ---

  async listRevisionReasons(tenantId: string, policyId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    return this.prisma.policyRevisionReason.findMany({
      where: { policyId },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createRevisionReason(
    tenantId: string,
    policyId: string,
    dto: CreateRevisionReasonDto,
    userId: string,
  ) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const created = await this.prisma.policyRevisionReason.create({
      data: {
        policyId,
        kind: dto.kind ?? 'amendment',
        label: dto.label.trim(),
        reason: dto.reason ?? '',
        summary: dto.summary ?? null,
        promulgatedDate: coerceNullableDate(dto.promulgatedDate),
        effectiveDate: coerceNullableDate(dto.effectiveDate),
        createdBy: userId,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.revision_reason.create',
      entityType: 'PolicyRevisionReason',
      entityId: created.id,
      details: { policyId, kind: created.kind, label: created.label },
    });
    return created;
  }

  async updateRevisionReason(
    tenantId: string,
    policyId: string,
    reasonId: string,
    dto: UpdateRevisionReasonDto,
    userId: string,
  ) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const row = await this.prisma.policyRevisionReason.findFirst({
      where: { id: reasonId, policyId },
    });
    if (!row) throw new NotFoundException('Revision reason not found');

    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.summary !== undefined) data.summary = dto.summary || null;
    if (dto.promulgatedDate !== undefined) data.promulgatedDate = coerceNullableDate(dto.promulgatedDate);
    if (dto.effectiveDate !== undefined) data.effectiveDate = coerceNullableDate(dto.effectiveDate);

    const updated = await this.prisma.policyRevisionReason.update({
      where: { id: reasonId },
      data: data as any,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.revision_reason.update',
      entityType: 'PolicyRevisionReason',
      entityId: reasonId,
      details: { policyId, fields: Object.keys(data) },
    });
    return updated;
  }

  async removeRevisionReason(tenantId: string, policyId: string, reasonId: string, userId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const row = await this.prisma.policyRevisionReason.findFirst({
      where: { id: reasonId, policyId },
    });
    if (!row) throw new NotFoundException('Revision reason not found');
    await this.prisma.policyRevisionReason.delete({ where: { id: reasonId } });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.revision_reason.delete',
      entityType: 'PolicyRevisionReason',
      entityId: reasonId,
      details: { policyId },
    });
  }

  /**
   * 테넌트 경계 확인만 하는 가벼운 검사 (본문 전체를 끌어오는 findOne 대신). 소속 확인·파일·내보내기 같은 전문이 아닌 경로가 쓴다 —
   * findOne 은 요청마다 스냅숏 트랜잭션을 여니(T-180) 소속 확인에 쓰지 않는다
   */
  async assertPolicyInTenant(tenantId: string, policyId: string) {
    const policy = await this.prisma.policy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true, code: true, title: true },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  /** 규정 자리(요금제·등록 수·상한) — 등록 전 안내용(T-198) */
  policySlots(tenantId: string) {
    return readPolicySlots(this.prisma, tenantId);
  }

  async listImportLogs(tenantId: string, take = 30) {
    return this.prisma.policyImportLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(100, Number(take) || 30)),
    });
  }

  async createImportLog(tenantId: string, userId: string, dto: CreatePolicyImportLogDto) {
    return this.prisma.policyImportLog.create({
      data: {
        tenantId,
        userId,
        policyId: dto.policyId || null,
        sourceName: dto.sourceName || null,
        parseProfile: dto.parseProfile || 'mixed',
        chapterCount: dto.chapterCount ?? 0,
        articleCount: dto.articleCount ?? 0,
        cleanupOptions: (dto.cleanupOptions || null) as any,
        status: dto.status || 'success',
        message: dto.message || null,
      },
    });
  }
}
