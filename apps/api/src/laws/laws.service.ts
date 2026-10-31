import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LawEventChannel } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { lawBibliography, prepareVersion, saveArticles, toDate } from './law-articles-save';
import { versionOrderKey } from './law-version-plan';
import { TX_OPTIONS } from './law-tx';
import { lockLawRowsForRegister } from '../common/row-locks';
import { fetchRegisterVersion } from './law-register-version';
import { readLawInForce } from './law-in-force.query';

/** 같은 법령의 옛 중복 행이 있으면 등록하지 않는다(고객 화면에 보이는 문구) */
const DUPLICATE_LAW_ROWS = '같은 법령이 여러 행으로 등록돼 있어(옛 중복) 정리될 때까지 등록할 수 없습니다 — 아스트룸에 문의하세요.';

/** 법제처 DRF. 지금은 유일한 법령원이다 */
const DEFAULT_SOURCE = {
  code: 'law.go.kr',
  name: '국가법령정보센터 DRF',
  baseUrl: 'https://www.law.go.kr/DRF',
};

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
   *   주기 동기화는 이 메서드가 아니라 판을 차례로 반영한다(law-version-sync, T-151) — 새 MST 로 이 메서드를 불러도
   *   같은 법령ID 의 행이 있으면 그 행을 돌려줄 뿐 판을 옮기지 않는다(아래).
   *
   * 등록한 판을 **기준판**으로 판 기록(law_versions)에 남긴다(T-151) — 동기화는 이 판 다음부터 걷는다.
   * 같은 판을 다시 등록해서 생긴 이벤트는 판이 바뀐 것이 아니라 판 칸을 비운다.
   *
   * **같은 법령ID 를 이미 다른 판으로 추적 중이면 새 행을 만들지 않고 그 행을 돌려준다**(`alreadyTracked`, T-151 검토).
   * 동기화가 법령 행을 시행 예정 판으로 옮겨 두면, 다른 회사가 현행 판(검색 결과)을 등록할 때 MST 로만 찾던 예전 방식은 같은
   * 법령의 둘째 행을 만들었고, 그 행의 동기화는 첫째 행이 가진 판에서 영영 막혔다. 행을 먼저 잠그고(`lockLawRowsForRegister`)
   * 정하므로 같은 법령 행을 잡는 판 반영(applyLawVersion)·표기 채우기와도 차례로 서고, 아직 행이 없는 법령의 첫 등록끼리도
   * 법령ID 로 줄 선다. 응답에 법령ID 가 없으면 같은 판 다시 등록만 받고 새 행은 만들지 않는다(502). 찾은 행이 둘 이상이면 같은 법령의
   * 옛 중복이라 어느 행인지 짐작하지 않고 409(정리는 T-154).
   */
  async register(requestedMst: string, sourceCode?: string, receivedVia: LawEventChannel = 'manual') {
    const source = await this.ensureSource(sourceCode);
    // 현행 판으로 등록한다 — 시행 예정 판이 기준판이 되면 그 개정이 이벤트 없이 묻힌다(T-150 ③)
    const { mst, meta, tree } = await fetchRegisterVersion(this.lawGoKr, requestedMst);
    const version = prepareVersion(mst, meta, tree);
    const fields = { ...lawBibliography(meta, version), lastCheckError: null };

    try {
      const result = await this.registerTx(source.id, mst, meta, version, fields, receivedVia);
      return mst === requestedMst ? result : { ...result, requestedMst };
    } catch (e) {
      // 잠근 뒤에 같은 판의 행이 생기는 일은 드물다(첫 등록끼리는 법령ID 열쇠로 줄 선다) — 그래도 (법령원, MST) 유일에 걸리면 500 이 아니라 409
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('같은 법령이 방금 다른 경로로 등록됐습니다. 목록을 다시 보세요.');
      }
      throw e;
    }
  }

  private registerTx(
    sourceId: string,
    mst: string,
    meta: Awaited<ReturnType<LawGoKrService['getLaw']>>['meta'],
    version: ReturnType<typeof prepareVersion>,
    fields: ReturnType<typeof lawBibliography> & { lastCheckError: null },
    receivedVia: LawEventChannel,
  ) {
    const source = { id: sourceId };
    return this.prisma.$transaction(async (tx) => {
      const rows = await lockLawRowsForRegister(tx, source.id, mst, meta.lawId);
      if (rows.length > 1) {
        // MST·법령ID 로 찾은 행이 둘 이상 = 같은 법령의 옛 중복. 어느 행이 판을 따라가는지 짐작하지 않는다 — 뒤처진 행은 앞선 행의 판에
        // 걸려 멈춰 있기 쉽고, 거기 건 새 연결은 개정을 받지 못한다(T-151 검토 6~9차). 정리(T-154) 전까지 등록하지 않는다
        this.log.warn(`MST ${mst}·법령ID ${meta.lawId} 로 찾은 법령 행이 ${rows.length}개입니다(MST ${rows.map((r) => r.external_id).join(', ')}) — 옛 중복, 런북 7-5·T-154 로 정리`);
        throw new ConflictException(DUPLICATE_LAW_ROWS);
      }
      const [found] = rows;
      const same = found?.external_id === mst ? found : undefined;
      if (found && !same) {
        // 이미 다른 판으로 추적 중 — 그 행을 그대로 돌려준다(동기화가 판을 따라간다). 본문·조항은 건드리지 않는다
        const law = await tx.law.findUniqueOrThrow({ where: { id: found.id } });
        const articleCount = await tx.lawArticle.count({ where: { lawId: law.id, deletedAt: null } });
        return { ...law, articleCount, skipped: 0, alreadyTracked: true };
      }
      if (!same && !meta.lawId) {
        // 법령ID 가 없으면 같은 법령을 다른 판으로 이미 추적 중인지 알 수 없다 — 새로 만들면 같은 법령의 둘째 행이 될 수 있고, 그 행은
        // 동기화가 판 목록을 찾지 못해 영영 멈춘다(T-151 검토). 같은 판 다시 등록(그 행 고치기)만 받는다
        throw new BadGatewayException(
          '법제처 응답에 법령ID가 없어 새로 등록하지 않았습니다 — 같은 법령을 이미 추적 중인지 확인할 수 없습니다. 잠시 뒤 다시 시도하고, 계속되면 아스트룸에 문의하세요.',
        );
      }
      // 새 법령은 확인 시각을 비워 다음 동기화의 맨 앞에 세운다 — 공포됐지만 시행 전인 판을 곧바로 변경으로 받게(T-150 ③).
      // 같은 판 다시 등록은 지금 확인한 것이라 시각을 찍는다
      const law = same
        ? await tx.law.update({ where: { id: same.id }, data: { ...fields, lastCheckedAt: new Date() } })
        : await tx.law.create({ data: { sourceId: source.id, externalId: mst, ...fields, lastCheckedAt: null } });
      await tx.lawVersion.upsert({
        where: { lawId_mst: { lawId: law.id, mst } },
        update: {},
        create: {
          lawId: law.id,
          mst,
          kind: 'baseline',
          orderKey: versionOrderKey({ mst, promulgationDate: meta.promulgationDate, promulgationNo: meta.promulgationNo }),
          lawType: meta.lawType,
          promulgatedDate: toDate(meta.promulgationDate),
          promulgationNo: meta.promulgationNo,
          revisionType: meta.revisionType,
          effectiveDate: version.lawEffectiveDate,
          versionKey: version.versionKey,
          receivedVia,
        },
      });
      await saveArticles(tx, {
        lawId: law.id,
        meta,
        version,
        receivedVia,
        beforeRules: same?.effective_notes_version ?? null,
        lawVersionId: null,
      });
      return { ...law, articleCount: version.rows.length, skipped: version.skipped, alreadyTracked: false };
    }, TX_OPTIONS);
  }

  /** 등록된 법령 목록 */
  async list() {
    const laws = await this.prisma.law.findMany({
      orderBy: [{ lawName: 'asc' }],
      include: {
        source: { select: { code: true, name: true } },
        // 법령에서 사라진 조항(T-124)은 세지 않는다
        _count: { select: { articles: { where: { deletedAt: null } } } },
      },
    });
    return laws.map(({ _count, ...law }) => ({ ...law, articleCount: _count.articles }));
  }

  async findOne(id: string) {
    const law = await this.prisma.law.findUnique({
      where: { id },
      include: {
        source: { select: { code: true, name: true } },
        _count: { select: { articles: { where: { deletedAt: null } } } },
      },
    });
    if (!law) throw new NotFoundException('법령을 찾을 수 없습니다.');
    const { _count, ...rest } = law;
    return { ...rest, articleCount: _count.articles };
  }

  /** 현행 본문과 시행 예정 개정(T-150 ②) — 법령조항 본문은 마지막 반영 판(시행 전일 수 있다)의 것이라 이벤트로 가른다 */
  async inForce(id: string) {
    await this.findOne(id);
    return readLawInForce(this.prisma, id);
  }

  /** 법령조항 목록 (원문 순서). 법령에서 사라진 조항(T-124)은 빠진다 — 걸어 둔 연결은 연결 쪽에서 보인다 */
  async articles(id: string) {
    await this.findOne(id);
    return this.prisma.lawArticle.findMany({
      where: { lawId: id, deletedAt: null },
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
    // 개정 후보(T-106)는 변경 이벤트를 개정의 원인으로 가리킨다. 법령을 지우면 이벤트가 함께 지워져
    // 후보·승인 이력의 원천이 사라진다 — 회사·상태와 무관하게 하나라도 있으면 막는다(FK 도 Restrict)
    const candidate = await this.prisma.amendmentCandidate.findFirst({
      where: { changeEvent: { lawId: id } },
      select: { id: true },
    });
    if (candidate) {
      throw new ConflictException(
        '이 법령의 개정으로 만든 개정 후보가 있어 추적을 해제할 수 없습니다. 개정 이력의 원천이 사라집니다.',
      );
    }
    await this.prisma.law.delete({ where: { id } });
    return { ok: true };
  }
}
