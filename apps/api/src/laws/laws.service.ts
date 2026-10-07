import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LawEventChannel } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import type { LawDetailMeta } from '../lawgokr/lawgokr.types';
import type { RegulationArticleNode } from '../regulation-parse/regulation-tree.builder';
import { buildLawArticleRows } from './law-rows';
import { lawAggregateVersionKey } from './law-version-key';
import { detectLawArticleChanges, type ExistingLawArticleSnapshot } from './law-change-detect';

/** 법제처 DRF. 지금은 유일한 법령원이다 */
const DEFAULT_SOURCE = {
  code: 'law.go.kr',
  name: '국가법령정보센터 DRF',
  baseUrl: 'https://www.law.go.kr/DRF',
};

/** `YYYY-MM-DD` → Date(UTC 자정). 날짜 컬럼이라 시간대에 끌려가면 안 된다 */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * 조항 수백 건을 한 트랜잭션에서 upsert 한다(근로기준법 478건). Prisma 기본 5초는 작은
 * 서버(Oracle A1)에서 넘칠 수 있고, 넘치면 등록·동기화가 통째로 롤백된다.
 */
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

type LawArticleRows = ReturnType<typeof buildLawArticleRows>['rows'];

interface PreparedVersion {
  rows: LawArticleRows;
  skipped: number;
  versionKey: string;
  lawEffectiveDate: Date | null;
}

@Injectable()
export class LawsService {
  private readonly log = new Logger(LawsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lawGoKr: LawGoKrService,
  ) {}

  /**
   * ⚠️ 이 서비스의 어떤 메서드에도 tenantId 가 없다. 법령은 테넌트 공용이기 때문이다(ADR-0020).
   * 테넌트 경계는 법령조항을 사내 조문에 잇는 `LawLink`(T-101)에서 건다.
   */

  private async ensureSource(code?: string) {
    const wanted = (code || DEFAULT_SOURCE.code).trim();
    if (wanted !== DEFAULT_SOURCE.code) {
      const found = await this.prisma.lawSource.findUnique({ where: { code: wanted } });
      if (!found) throw new NotFoundException(`등록되지 않은 법령원입니다: ${wanted}`);
      if (!found.isActive) throw new BadRequestException(`비활성 법령원입니다: ${wanted}`);
      return found;
    }
    return this.prisma.lawSource.upsert({
      where: { code: DEFAULT_SOURCE.code },
      update: {},
      create: DEFAULT_SOURCE,
    });
  }

  /**
   * 법제처 MST 로 법령을 등록하고 조·항·호를 저장한다(추적 시작).
   *
   * 이미 등록된 법령이면 본문을 다시 받아 **nodeKey 기준으로 갱신**한다. 조문이 삭제된
   * 개정에서 옛 행이 남으면 변경 감지가 사라진 조문을 계속 살아 있는 것으로 보므로,
   * 새 응답에 없는 nodeKey 는 지운다. 재등록마다 조항별 versionKey 를 이전 값과 비교해
   * 달라진 조항만 `LawChangeEvent` 로 남긴다(T-103) — 공백만 다른 재등록은 versionKey
   * 정규화가 이미 흡수하므로 여기서 다시 걸러낼 필요가 없다.
   *
   * ⚠️ **`deleteMany` + `createMany` 로 통째로 갈아끼우면 안 된다** — T-100 초판은 그렇게
   * 했었다. 내용이 하나도 안 바뀐 재등록(예: T-104 주기 폴링)에서도 매번 새 uuid 가
   * 발급돼, `LawLink`(T-101)가 참조하는 `LawArticle.id` 가 재등록마다 통째로 바뀌고
   * 만든 연결이 전부 끊긴다. `nodeKey` 로 upsert 해 같은 자리는 id 를 유지한다.
   *
   * @param receivedVia 변경 이벤트의 수신경로. HTTP 로 오는 등록은 `manual`.
   *   주기 동기화(T-104)는 이 메서드가 아니라 `applyNewVersion()` 을 쓴다 — 새 MST 로
   *   이 메서드를 부르면 별도의 법령 행이 생긴다(그쪽 주석 참고).
   */
  async register(mst: string, sourceCode?: string, receivedVia: LawEventChannel = 'manual') {
    const source = await this.ensureSource(sourceCode);
    const { meta, tree } = await this.lawGoKr.getLaw(mst);
    const version = this.prepareVersion(mst, meta, tree);
    const fields = this.lawFields(meta, version);

    return this.prisma.$transaction(async (tx) => {
      const law = await tx.law.upsert({
        where: { sourceId_externalId: { sourceId: source.id, externalId: mst } },
        update: fields,
        create: { sourceId: source.id, externalId: mst, ...fields },
      });
      await this.saveArticles(tx, law.id, meta, version, receivedVia);
      return { ...law, articleCount: version.rows.length, skipped: version.skipped };
    }, TX_OPTIONS);
  }

  /**
   * 추적 중인 법령을 **새 판(MST)** 으로 갈아끼운다 — T-104 주기 동기화가 부른다.
   *
   * `register(새MST)` 를 부르면 안 된다. 등록은 `(법령원, MST)` 로 행을 찾으므로 새 MST 는
   * **별도의 법령 행**을 만들고, 회사들이 옛 행의 조항에 걸어 둔 `LawLink` 는 옛 판에 남아
   * 개정이 영향 분석(T-105)에 닿지 않는다. 같은 `Law` 행의 MST 만 바꾸고 조항은 nodeKey 로
   * 갱신해야 연결이 이어지고, 달라진 조항이 `LawChangeEvent` 로 남는다.
   *
   * @returns 만들어진 변경 이벤트 수
   */
  async applyNewVersion(lawId: string, mst: string, receivedVia: LawEventChannel = 'poll') {
    const { meta, tree } = await this.lawGoKr.getLaw(mst);
    const version = this.prepareVersion(mst, meta, tree);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const law = await tx.law.update({
          where: { id: lawId },
          data: { externalId: mst, ...this.lawFields(meta, version) },
        });
        const events = await this.saveArticles(tx, law.id, meta, version, receivedVia);
        return { law, events };
      }, TX_OPTIONS);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `이 법령의 새 판(MST ${mst})이 이미 별도 법령으로 등록돼 있습니다. 중복 등록을 정리한 뒤 다시 확인하세요.`,
        );
      }
      throw e;
    }
  }

  private prepareVersion(
    mst: string,
    meta: LawDetailMeta,
    tree: { roots: RegulationArticleNode[] },
  ): PreparedVersion {
    const { rows, skipped } = buildLawArticleRows(tree.roots);
    if (!rows.length) {
      throw new BadRequestException(
        `법제처 응답에 조문이 없어 등록할 수 없습니다 (MST=${mst}). 별표·서식만 있는 문서일 수 있습니다.`,
      );
    }
    if (skipped) {
      this.log.warn(`MST=${mst}: 조 번호를 읽을 수 없는 ${skipped}건을 건너뛰었습니다.`);
    }
    return {
      rows,
      skipped,
      versionKey: lawAggregateVersionKey(rows.map((r) => r.versionKey)),
      lawEffectiveDate: toDate(meta.effectiveDate),
    };
  }

  /** 법령 행의 서지 값. 등록·동기화가 같은 함수를 써야 두 경로가 갈라지지 않는다 */
  private lawFields(meta: LawDetailMeta, version: PreparedVersion) {
    return {
      // 응답에 법령ID 가 빠지는 일이 있어도 저장된 값을 null 로 덮지 않는다 — 동기화의 열쇠다
      externalLawId: meta.lawId ?? undefined,
      lawName: meta.title,
      lawNo: meta.promulgationNo,
      lawType: meta.lawType,
      ministry: meta.ministry,
      promulgatedDate: toDate(meta.promulgationDate),
      effectiveDate: version.lawEffectiveDate,
      versionKey: version.versionKey,
      lastCheckedAt: new Date(),
      lastCheckError: null,
      sourceUrl: meta.sourceUrl,
    };
  }

  /**
   * 조항을 nodeKey 기준으로 갱신하고, 달라진 조항을 `LawChangeEvent` 로 남긴다(T-103).
   * @returns 만들어진 변경 이벤트 수
   */
  private async saveArticles(
    tx: Prisma.TransactionClient,
    lawId: string,
    meta: LawDetailMeta,
    version: PreparedVersion,
    receivedVia: LawEventChannel,
  ): Promise<number> {
    const { rows, lawEffectiveDate } = version;

    // T-103: 변경 감지의 "이전" 스냅샷 — 아래 upsert 루프가 값을 갈아끼우기 전에 찍는다
    const existingBefore = await tx.lawArticle.findMany({
      where: { lawId },
      select: { id: true, nodeKey: true, content: true, versionKey: true },
    });
    const existingArticles: ExistingLawArticleSnapshot[] = existingBefore.map((a) => ({
      lawArticleId: a.id,
      nodeKey: a.nodeKey,
      content: a.content,
      versionKey: a.versionKey,
    }));

    const articleIdByNodeKey = new Map<string, string>();
    for (const row of rows) {
      const saved = await tx.lawArticle.upsert({
        where: { lawId_nodeKey: { lawId, nodeKey: row.nodeKey } },
        update: {
          articleNo: row.articleNo,
          clauseNo: row.clauseNo,
          itemNo: row.itemNo,
          label: row.label,
          title: row.title,
          content: row.content,
          versionKey: row.versionKey,
          // 법제처는 조문별 시행일을 따로 주기도 하지만 매퍼가 아직 옮기지 않는다.
          // 법령 시행일을 그대로 쓴다 — T-103 에서 조문별 값이 들어오면 거기서 갈린다.
          effectiveDate: lawEffectiveDate,
          sortOrder: row.sortOrder,
        },
        create: {
          lawId,
          nodeKey: row.nodeKey,
          articleNo: row.articleNo,
          clauseNo: row.clauseNo,
          itemNo: row.itemNo,
          label: row.label,
          title: row.title,
          content: row.content,
          versionKey: row.versionKey,
          effectiveDate: lawEffectiveDate,
          sortOrder: row.sortOrder,
        },
      });
      articleIdByNodeKey.set(row.nodeKey, saved.id);
    }

    // T-103: 이전 스냅샷과 이번 응답을 견줘 실제로 달라진 조항만 이벤트로 남긴다
    // (최초 등록은 비교 대상이 없어 빈 결과 — detectLawArticleChanges 주석 참고).
    // deleteMany(아래) 보다 반드시 먼저다 — 삭제될 조문의 lawArticleId 가 아직 살아
    // 있어야 이벤트에 담을 수 있다(그 뒤 deleteMany 가 SetNull 로 FK 만 끊는다).
    const changes = detectLawArticleChanges(existingArticles, rows, articleIdByNodeKey);
    if (changes.length) {
      await tx.lawChangeEvent.createMany({
        data: changes.map((change) => ({
          lawId,
          lawArticleId: change.lawArticleId,
          nodeKey: change.nodeKey,
          changeType: change.type,
          beforeContent: change.type === 'created' ? null : change.before.content,
          afterContent: change.type === 'deleted' ? null : change.after.content,
          beforeVersionKey: change.type === 'created' ? null : change.before.versionKey,
          afterVersionKey: change.type === 'deleted' ? null : change.after.versionKey,
          promulgatedDate: toDate(meta.promulgationDate),
          lawEffectiveDate,
          receivedVia,
        })),
      });
    }

    // 새 응답에 없는 nodeKey — 조문이 실제로 삭제된 개정. LawLink 가 있었다면 함께
    // 지워진다(FK onDelete: Cascade) — T-101 은 이 경우를 "연결 끊김"으로 감지하지
    // 않는다. 재등록 자체가 드물고, 흔한 경로(내용만 바뀐 재등록)는 위 upsert 로 유지된다.
    // 위에서 만든 deleted LawChangeEvent 의 lawArticleId 는 여기서 SetNull 로 끊긴다 —
    // 본문은 이미 이벤트에 스냅샷으로 있으므로 잃는 정보가 없다.
    await tx.lawArticle.deleteMany({
      where: { lawId, nodeKey: { notIn: rows.map((r) => r.nodeKey) } },
    });

    return changes.length;
  }

  /** 등록된 법령 목록 */
  async list() {
    const laws = await this.prisma.law.findMany({
      orderBy: [{ lawName: 'asc' }],
      include: {
        source: { select: { code: true, name: true } },
        _count: { select: { articles: true } },
      },
    });
    return laws.map(({ _count, ...law }) => ({ ...law, articleCount: _count.articles }));
  }

  async findOne(id: string) {
    const law = await this.prisma.law.findUnique({
      where: { id },
      include: { source: { select: { code: true, name: true } }, _count: { select: { articles: true } } },
    });
    if (!law) throw new NotFoundException('법령을 찾을 수 없습니다.');
    const { _count, ...rest } = law;
    return { ...rest, articleCount: _count.articles };
  }

  /** 법령조항 목록 (원문 순서) */
  async articles(id: string) {
    await this.findOne(id);
    return this.prisma.lawArticle.findMany({
      where: { lawId: id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * 추적 해제.
   *
   * **법령 관계 정보(`LawLink`, T-101)가 하나라도 걸려 있으면 거부한다**(설계안 6절).
   * `LawArticle`의 FK 는 `onDelete: Cascade`라 그냥 지우면 링크가 조용히 함께 사라지는데,
   * 그건 어느 회사가 이 법에 걸어 둔 대응을 통째로 날리는 일이다 — 조용히 벌어지면 안 된다.
   * 테넌트 무관하게 **하나라도** 있으면 막는다(법령은 공용이므로 다른 테넌트의 연결도 본다).
   */
  async remove(id: string) {
    await this.findOne(id);
    const linked = await this.prisma.lawLink.findFirst({
      where: { lawArticle: { lawId: id } },
      select: { id: true },
    });
    if (linked) {
      throw new ConflictException(
        '이 법령의 조항에 연결된 법령 관계 정보가 있어 추적을 해제할 수 없습니다. 먼저 연결을 정리하세요.',
      );
    }
    await this.prisma.law.delete({ where: { id } });
    return { ok: true };
  }
}
