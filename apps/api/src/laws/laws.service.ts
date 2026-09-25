import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { buildLawArticleRows } from './law-rows';
import { lawAggregateVersionKey } from './law-version-key';

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
   * 이미 등록된 법령이면 본문을 다시 받아 조항을 **통째로 갈아끼운다**. 조문이 삭제된
   * 개정에서 옛 행이 남으면 변경 감지가 사라진 조문을 계속 살아 있는 것으로 본다.
   * 지금은 갈아끼우기만 하고 변경 이벤트는 만들지 않는다 — 그건 T-103 의 몫이다.
   */
  async register(mst: string, sourceCode?: string) {
    const source = await this.ensureSource(sourceCode);
    const { meta, tree } = await this.lawGoKr.getLaw(mst);
    const { rows, skipped } = buildLawArticleRows(tree.roots);

    if (!rows.length) {
      throw new BadRequestException(
        `법제처 응답에 조문이 없어 등록할 수 없습니다 (MST=${mst}). 별표·서식만 있는 문서일 수 있습니다.`,
      );
    }
    if (skipped) {
      this.log.warn(`MST=${mst}: 조 번호를 읽을 수 없는 ${skipped}건을 건너뛰었습니다.`);
    }

    const versionKey = lawAggregateVersionKey(rows.map((r) => r.versionKey));
    const lawEffectiveDate = toDate(meta.effectiveDate);

    return this.prisma.$transaction(async (tx) => {
      const law = await tx.law.upsert({
        where: { sourceId_externalId: { sourceId: source.id, externalId: mst } },
        update: {
          externalLawId: meta.lawId,
          lawName: meta.title,
          lawNo: meta.promulgationNo,
          lawType: meta.lawType,
          ministry: meta.ministry,
          promulgatedDate: toDate(meta.promulgationDate),
          effectiveDate: lawEffectiveDate,
          versionKey,
          lastCheckedAt: new Date(),
          sourceUrl: meta.sourceUrl,
        },
        create: {
          sourceId: source.id,
          externalId: mst,
          externalLawId: meta.lawId,
          lawName: meta.title,
          lawNo: meta.promulgationNo,
          lawType: meta.lawType,
          ministry: meta.ministry,
          promulgatedDate: toDate(meta.promulgationDate),
          effectiveDate: lawEffectiveDate,
          versionKey,
          lastCheckedAt: new Date(),
          sourceUrl: meta.sourceUrl,
        },
      });

      await tx.lawArticle.deleteMany({ where: { lawId: law.id } });
      await tx.lawArticle.createMany({
        data: rows.map((row) => ({
          lawId: law.id,
          nodeKey: row.nodeKey,
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
        })),
      });

      return { ...law, articleCount: rows.length, skipped };
    });
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
   * T-101 의 `LawLink` 가 아직 없으므로 지금은 조항만 함께 지운다. 연결이 생기면
   * **연결이 남아 있을 때 거부**해야 한다(설계안 6절) — 그 검사는 T-101 에서 추가한다.
   * 지금 지워도 되는 이유: 이 법령을 가리키는 다른 테이블이 아직 없다.
   */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.law.delete({ where: { id } });
    return { ok: true };
  }
}
