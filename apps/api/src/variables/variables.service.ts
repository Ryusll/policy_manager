import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, VariableBindingOrigin } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import { formatJo } from '../common/article-label';
import {
  CreateBindingDto,
  CreateVariableDto,
  UpdateVariableDto,
  UpsertValueDto,
} from './variables.dto';
import {
  contextOf,
  coversDate,
  findMarkers,
  markerKeys,
  occurrenceOf,
  overlappingValueIds,
  reanchor,
  replaceSpans,
  selectValue,
  type ValuePick,
  type ValueRow,
} from './variable-binding';

type Db = Prisma.TransactionClient;

const dateOnly = (d: Date | null) => (d ? toDateOnlyString(d) : null);

/** 값을 고르지 못한 까닭 — 화면·오류 문구 */
export const PICK_REASON_TEXT: Record<Exclude<ValuePick, { ok: true }>['reason'], string> = {
  none: '그 날짜에 맞는 값이 없음',
  ambiguous: '그 날짜에 맞는 값이 둘 이상(기간 겹침)',
  unconfirmed: '기간을 아직 정하지 않은 값뿐',
};

const BINDING_SELECT = {
  id: true,
  variableId: true,
  articleId: true,
  versionId: true,
  start: true,
  end: true,
  text: true,
  contextBefore: true,
  contextAfter: true,
  occurrence: true,
  origin: true,
  state: true,
  reviewReason: true,
  valueId: true,
  parentId: true,
  createdAt: true,
} satisfies Prisma.VariableBindingSelect;

/** "제3조제2항" — 조문 표기 */
function articleLabel(a: { number: number; branchNumber: number | null; clauseNumber: number | null; itemNumber: number | null }) {
  return `${formatJo(a.number, a.branchNumber)}${a.clauseNumber ? `제${a.clauseNumber}항` : ''}${a.itemNumber ? `제${a.itemNumber}목` : ''}`;
}

/** 날짜 입력 — 비우면 null(처음부터·끝 없음), 형식이 틀리면 400 */
function optionalDate(v: string | null | undefined, name: string): Date | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const d = parseDateOnly(v);
  if (!d) throw new BadRequestException(`${name}은 YYYY-MM-DD 형식이어야 합니다.`);
  return d;
}

/**
 * 변수 마스터와 변수 연결(T-109, 특허 청구항 5·9, 도 9).
 *
 * - 값은 여러 개, 값마다 유효기간 [시작, 종료). 기간이 겹쳐도 저장은 받고 "검토 필요"로 보이며, 날짜에 맞는 값이
 *   정확히 하나일 때만 쓴다(사용자 지시로 코덱스 자문 — 결정 4)
 * - 연결은 조문 버전 본문의 한 구간이다. 발행 본문은 실제 문구이고, 본문의 `{{KEY}}` 표식은 입력용이다 — 검토
 *   요청 때 그날 값으로 바꾸고 그 자리를 연결로 남긴다(결정 1). 표식이 남은 본문은 새로 발행하지 않는다
 * - 새 버전이 발행되면 연결을 그 버전으로 옮긴다(옛 행은 남기고 새 행을 잇는다, 결정 8). 위치를 확정하지 못하면
 *   조용히 지우거나 옮기지 않고 "다시 이어야 함"으로 둔다
 */
@Injectable()
export class VariablesService {
  constructor(private prisma: PrismaService) {}

  private presentValues(values: Array<ValueRow & { note: string | null; createdAt: Date; updatedAt: Date }>) {
    const overlaps = overlappingValueIds(values);
    const pick = selectValue(values, todayDateOnly());
    return {
      values: values.map((v) => ({
        id: v.id,
        value: v.value,
        validFrom: dateOnly(v.validFrom),
        validTo: dateOnly(v.validTo),
        periodConfirmed: v.periodConfirmed,
        note: v.note,
        overlapping: overlaps.has(v.id),
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
      /** 오늘 쓸 값 — 없으면 까닭 */
      current: 'value' in pick ? { id: pick.value.id, value: pick.value.value } : null,
      currentReason: 'reason' in pick ? pick.reason : null,
      needsReview: overlaps.size > 0 || values.some((v) => !v.periodConfirmed),
    };
  }

  private valuesOrder = [{ validFrom: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] satisfies Prisma.VariableValueOrderByWithRelationInput[];

  async findAll(tenantId: string) {
    const rows = await this.prisma.variable.findMany({
      where: { tenantId },
      include: {
        values: { orderBy: this.valuesOrder },
        // 지금 시행 중인 본문에 걸린 연결 수(다시 이어야 하는 것 포함)
        _count: {
          select: {
            bindings: { where: { state: { in: ['active', 'needs_review'] }, version: { status: 'published' } } },
          },
        },
      },
      orderBy: { key: 'asc' },
    });
    return rows.map(({ values, _count, ...v }) => ({ ...v, ...this.presentValues(values), bindingCount: _count.bindings }));
  }

  async findOne(tenantId: string, id: string) {
    const variable = await this.prisma.variable.findFirst({
      where: { id, tenantId },
      include: { values: { orderBy: this.valuesOrder } },
    });
    if (!variable) throw new NotFoundException('Variable not found');
    const bindings = await this.prisma.variableBinding.findMany({
      where: {
        tenantId,
        variableId: id,
        state: { in: ['active', 'needs_review'] },
        version: { status: 'published', article: { chapter: { policy: { tenantId } } } },
      },
      orderBy: [{ articleId: 'asc' }, { start: 'asc' }],
      select: {
        ...BINDING_SELECT,
        version: { select: { versionNum: true, effectiveDate: true } },
        article: {
          select: {
            number: true,
            branchNumber: true,
            clauseNumber: true,
            itemNumber: true,
            title: true,
            chapter: { select: { policy: { select: { id: true, code: true, title: true } } } },
          },
        },
      },
    });
    const { values, ...rest } = variable;
    return {
      ...rest,
      ...this.presentValues(values),
      bindings: bindings.map(({ article, version, ...b }) => ({
        ...b,
        versionNum: version.versionNum,
        effectiveDate: dateOnly(version.effectiveDate),
        policy: article.chapter.policy,
        article: { label: articleLabel(article), title: article.title },
      })),
    };
  }

  async create(tenantId: string, dto: CreateVariableDto, userId: string | null = null) {
    const existing = await this.prisma.variable.findUnique({
      where: { tenantId_key: { tenantId, key: dto.key } },
    });
    if (existing) {
      throw new ConflictException('Variable key ' + dto.key + ' already exists');
    }
    const firstValue = dto.value?.trim() ? dto.value.trim() : null;
    const validFrom = optionalDate(dto.validFrom, '시작일');
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.variable.create({
        data: { tenantId, key: dto.key, label: dto.label, description: dto.description },
      });
      if (firstValue) {
        await tx.variableValue.create({
          data: { tenantId, variableId: created.id, value: firstValue, validFrom, createdBy: userId },
        });
      }
      await this.auditLog(tx, tenantId, userId, 'variable.create', 'Variable', created.id, {
        key: created.key,
        value: firstValue,
        validFrom: dateOnly(validFrom),
      });
      return created;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateVariableDto) {
    await this.owned(tenantId, id);
    return this.prisma.variable.update({
      where: { id },
      data: { label: dto.label, description: dto.description },
    });
  }

  async remove(tenantId: string, id: string, userId: string | null = null) {
    const v = await this.owned(tenantId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.variable.delete({ where: { id } });
      await this.auditLog(tx, tenantId, userId, 'variable.delete', 'Variable', id, { key: v.key });
    });
  }

  private async owned(tenantId: string, id: string, db: Db = this.prisma) {
    const v = await db.variable.findFirst({ where: { id, tenantId }, select: { id: true, key: true, label: true } });
    if (!v) throw new NotFoundException('Variable not found');
    return v;
  }

  // ── 값과 유효기간 ──

  /**
   * 값 추가 — 유효기간 [시작, 종료). 시작을 비우면 처음부터, 종료를 비우면 끝 없음. 겹쳐도 저장은 받고 응답에
   * 겹침을 알린다(같은 날 두 값이면 그 날은 아무 값도 고르지 않는다). 변수 행을 잠가 승인의 값 재확인과 줄 세운다.
   */
  async addValue(tenantId: string, variableId: string, dto: UpsertValueDto, userId: string) {
    const value = dto.value?.trim();
    if (!value) throw new BadRequestException('값을 입력하세요.');
    const validFrom = optionalDate(dto.validFrom, '시작일');
    const validTo = optionalDate(dto.validTo, '종료일');
    if (validFrom && validTo && validFrom.getTime() >= validTo.getTime()) {
      throw new BadRequestException('종료일은 시작일보다 뒤여야 합니다(종료일 당일은 이 값에 들지 않습니다).');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockVariable(tx, tenantId, variableId);
      const row = await tx.variableValue.create({
        data: { tenantId, variableId, value, validFrom, validTo, note: dto.note?.trim() || null, createdBy: userId },
      });
      await this.auditLog(tx, tenantId, userId, 'variable.value.create', 'Variable', variableId, {
        valueId: row.id,
        value,
        validFrom: dateOnly(validFrom),
        validTo: dateOnly(validTo),
      });
      return this.valuesAfter(tx, variableId, row.id);
    });
  }

  /** 값 고치기 — 기간을 넣거나 `confirmPeriod` 를 주면 기간 미확정 값(옛 기본값)이 확정된다 */
  async updateValue(tenantId: string, variableId: string, valueId: string, dto: UpsertValueDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockVariable(tx, tenantId, variableId);
      const before = await tx.variableValue.findFirst({ where: { id: valueId, variableId, tenantId } });
      if (!before) throw new NotFoundException('Value not found');
      const value = dto.value !== undefined ? dto.value.trim() : before.value;
      if (!value) throw new BadRequestException('값을 입력하세요.');
      const validFrom = dto.validFrom !== undefined ? optionalDate(dto.validFrom, '시작일') : before.validFrom;
      const validTo = dto.validTo !== undefined ? optionalDate(dto.validTo, '종료일') : before.validTo;
      if (validFrom && validTo && validFrom.getTime() >= validTo.getTime()) {
        throw new BadRequestException('종료일은 시작일보다 뒤여야 합니다(종료일 당일은 이 값에 들지 않습니다).');
      }
      const periodConfirmed =
        before.periodConfirmed || dto.confirmPeriod === true || dto.validFrom !== undefined || dto.validTo !== undefined;
      await tx.variableValue.update({
        where: { id: valueId },
        data: { value, validFrom, validTo, periodConfirmed, note: dto.note !== undefined ? dto.note?.trim() || null : before.note },
      });
      await this.auditLog(tx, tenantId, userId, 'variable.value.update', 'Variable', variableId, {
        valueId,
        before: { value: before.value, validFrom: dateOnly(before.validFrom), validTo: dateOnly(before.validTo), periodConfirmed: before.periodConfirmed },
        after: { value, validFrom: dateOnly(validFrom), validTo: dateOnly(validTo), periodConfirmed },
      });
      return this.valuesAfter(tx, variableId, valueId);
    });
  }

  async removeValue(tenantId: string, variableId: string, valueId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockVariable(tx, tenantId, variableId);
      const before = await tx.variableValue.findFirst({ where: { id: valueId, variableId, tenantId } });
      if (!before) throw new NotFoundException('Value not found');
      await tx.variableValue.delete({ where: { id: valueId } });
      await this.auditLog(tx, tenantId, userId, 'variable.value.delete', 'Variable', variableId, {
        valueId,
        value: before.value,
        validFrom: dateOnly(before.validFrom),
        validTo: dateOnly(before.validTo),
      });
      return this.valuesAfter(tx, variableId, null);
    });
  }

  private async valuesAfter(tx: Db, variableId: string, changedId: string | null) {
    const values = await tx.variableValue.findMany({ where: { variableId }, orderBy: this.valuesOrder });
    const presented = this.presentValues(values);
    return { ...presented, changedOverlaps: changedId ? presented.values.some((v) => v.id === changedId && v.overlapping) : false };
  }

  /** 변수 행 잠금 — 값 고치기와 승인 때 값 재확인이 겹치지 않게 */
  private async lockVariable(tx: Db, tenantId: string, variableId: string) {
    await this.owned(tenantId, variableId, tx);
    await tx.$queryRaw`SELECT id FROM variables WHERE id = ${variableId} FOR UPDATE`;
  }

  // ── 연결(바인딩) ──

  /** 이 버전 본문의 연결(풀지 않은 것) */
  async listForVersion(tenantId: string, versionId: string) {
    const version = await this.prisma.articleVersion.findFirst({
      where: { id: versionId, article: { chapter: { policy: { tenantId } } } },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('Version not found');
    return this.prisma.variableBinding.findMany({
      where: { versionId, tenantId, state: { in: ['active', 'needs_review'] } },
      orderBy: { start: 'asc' },
      select: { ...BINDING_SELECT, variable: { select: { id: true, key: true, label: true } } },
    });
  }

  /**
   * 지금 시행 중인 버전의 문구를 골라 변수에 잇는다(관리자·편집자). 고른 문구가 본문 그 자리와 같아야 하고
   * (화면이 본 뒤 본문이 바뀌었으면 409), 다른 연결과 겹치면 안 된다. 조문을 잠가 발행(연결 옮기기)과 줄 세운다.
   */
  async createBinding(tenantId: string, versionId: string, dto: CreateBindingDto, userId: string) {
    const head = await this.prisma.articleVersion.findFirst({
      where: { id: versionId, article: { chapter: { policy: { tenantId } } } },
      select: { articleId: true },
    });
    if (!head) throw new NotFoundException('Version not found');
    const variable = await this.prisma.variable.findFirst({
      where: { id: dto.variableId, tenantId },
      select: { id: true, key: true, values: true },
    });
    if (!variable) throw new NotFoundException('Variable not found');
    const { start, end } = dto;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
      throw new BadRequestException('연결할 구간이 올바르지 않습니다.');
    }
    if (dto.text.trim() !== dto.text || !dto.text) {
      throw new BadRequestException('앞뒤 공백 없이 문구만 골라 주세요.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM articles WHERE id = ${head.articleId} FOR UPDATE`;
      const version = await tx.articleVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: { id: true, articleId: true, status: true, content: true, effectiveDate: true },
      });
      if (version.status !== 'published') {
        throw new ConflictException('지금 시행 중인 버전에만 이을 수 있습니다 — 화면을 새로 고쳐 확인하세요.');
      }
      if (end > version.content.length || version.content.slice(start, end) !== dto.text) {
        throw new ConflictException('본문이 그 사이 바뀌었습니다 — 화면을 새로 고쳐 다시 골라 주세요.');
      }
      const others = await tx.variableBinding.findMany({
        where: { versionId, state: { in: ['active', 'needs_review'] }, NOT: { start: 0, end: 0 } },
        select: { start: true, end: true },
      });
      if (others.some((o) => o.start < end && start < o.end)) {
        throw new ConflictException('이미 이어 둔 구간과 겹칩니다.');
      }
      // 그 문구가 이 버전 시행일에 맞는 값과 같으면 "직전 적용값"으로 적어 둔다 — 다음에 값을 반영할 때 확인한다
      const same = variable.values.filter(
        (v) => v.value === dto.text && v.periodConfirmed && (!version.effectiveDate || coversDate(v, version.effectiveDate)),
      );
      const row = await tx.variableBinding.create({
        data: {
          tenantId,
          variableId: variable.id,
          articleId: version.articleId,
          versionId,
          start,
          end,
          text: dto.text,
          ...contextOf(version.content, start, end),
          occurrence: occurrenceOf(version.content, dto.text, start),
          origin: 'manual',
          valueId: same.length === 1 ? same[0].id : null,
          createdBy: userId,
        },
        select: BINDING_SELECT,
      });
      await this.auditLog(tx, tenantId, userId, 'variable.binding.create', 'ArticleVersion', versionId, {
        bindingId: row.id,
        variableId: variable.id,
        key: variable.key,
        start,
        end,
        text: dto.text,
      });
      return row;
    });
  }

  /** 연결 풀기 — 지우지 않고 released 로 남긴다(이력) */
  async releaseBinding(tenantId: string, bindingId: string, userId: string) {
    const b = await this.prisma.variableBinding.findFirst({
      where: { id: bindingId, tenantId, state: { not: 'released' }, article: { chapter: { policy: { tenantId } } } },
      select: { id: true, versionId: true, variableId: true, text: true },
    });
    if (!b) throw new NotFoundException('Binding not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.variableBinding.update({ where: { id: bindingId }, data: { state: 'released' } });
      await this.auditLog(tx, tenantId, userId, 'variable.binding.release', 'ArticleVersion', b.versionId, {
        bindingId,
        variableId: b.variableId,
        text: b.text,
      });
    });
    return { released: true };
  }

  // ── 다른 서비스가 쓰는 것(같은 트랜잭션 안에서) ──

  /**
   * 본문의 표식(등록된 변수의 `{{KEY}}`)을 그 날 값으로 바꾼다 — 검토 요청 때(결정 1). 값을 고를 수 없는 표식이
   * 하나라도 있으면 아무것도 바꾸지 않고 400(어느 표식이 왜 안 되는지). 바꾼 자리는 연결로 돌려준다.
   */
  async resolveMarkers(db: Db, tenantId: string, content: string, date: Date) {
    const keys = markerKeys(content);
    if (!keys.size) return { content, applied: [] as AppliedMarker[] };
    const variables = await db.variable.findMany({
      where: { tenantId, key: { in: [...keys] } },
      select: { id: true, key: true, label: true },
    });
    const byKey = new Map(variables.map((v) => [v.key, v]));
    const markers = findMarkers(content, new Set(byKey.keys()));
    if (!markers.length) return { content, applied: [] as AppliedMarker[] };
    // 값 고치기와 줄 세운다 — 잠근 뒤에 값을 읽는다
    await db.$queryRaw`SELECT id FROM variables WHERE id = ANY(${variables.map((v) => v.id)}::text[]) FOR SHARE`;
    const values = await db.variableValue.findMany({ where: { variableId: { in: variables.map((v) => v.id) } } });
    const failures: string[] = [];
    const picks = markers.map((m) => {
      const v = byKey.get(m.key)!;
      const pick = selectValue(values.filter((x) => x.variableId === v.id), date);
      if ('reason' in pick) failures.push(`{{${m.key}}}(${v.label}) — ${PICK_REASON_TEXT[pick.reason]}`);
      return { m, v, pick };
    });
    if (failures.length) {
      throw new BadRequestException(
        `${toDateOnlyString(date)} 기준으로 값을 정할 수 없는 변수 표식이 있습니다 — ${[...new Set(failures)].join(', ')}. ` +
          '변수 관리에서 값과 유효기간을 확인하세요.',
      );
    }
    const replaced = replaceSpans(
      content,
      picks.map(({ m, pick }) => ({ start: m.start, end: m.end, text: (pick as { ok: true; value: ValueRow }).value.value })),
    );
    const applied: AppliedMarker[] = picks.map(({ m, v, pick }, i) => ({
      variableId: v.id,
      key: m.key,
      valueId: (pick as { ok: true; value: ValueRow }).value.id,
      value: (pick as { ok: true; value: ValueRow }).value.value,
      start: replaced.spans[i].start,
      end: replaced.spans[i].end,
    }));
    return { content: replaced.content, applied };
  }

  /** 표식을 바꾼 자리들을 그 버전의 연결로 남긴다 */
  async createMarkerBindings(
    db: Db,
    tenantId: string,
    version: { id: string; articleId: string; content: string },
    applied: AppliedMarker[],
    userId: string | null,
  ) {
    if (!applied.length) return;
    await db.variableBinding.createMany({
      data: applied.map((a) => ({
        tenantId,
        variableId: a.variableId,
        articleId: version.articleId,
        versionId: version.id,
        start: a.start,
        end: a.end,
        text: a.value,
        ...contextOf(version.content, a.start, a.end),
        occurrence: occurrenceOf(version.content, a.value, a.start),
        origin: 'marker' as VariableBindingOrigin,
        valueId: a.valueId,
        createdBy: userId,
      })),
    });
  }

  /**
   * 발행되는 본문에 등록된 변수의 표식이 남아 있으면 거부한다(결정 1) — 표식은 검토 요청 때 값으로 바뀐다.
   * 검토를 거치지 않는 발행(한꺼번에 시행·일괄 가져오기·문서 가져오기 확정)은 초안으로 두고 검토를 요청하게 한다.
   */
  async assertNoMarkers(db: Db, tenantId: string, items: Array<{ label: string; content: string }>) {
    const keys = new Set(items.flatMap((i) => [...markerKeys(i.content)]));
    if (!keys.size) return;
    const registered = new Set(
      (await db.variable.findMany({ where: { tenantId, key: { in: [...keys] } }, select: { key: true } })).map((v) => v.key),
    );
    const hit = items.filter((i) => findMarkers(i.content, registered).length > 0).map((i) => i.label);
    if (hit.length) {
      throw new BadRequestException(
        `변수 표식({{…}})이 남은 본문은 바로 시행할 수 없습니다 — ${hit.slice(0, 5).join(', ')}${hit.length > 5 ? ` 외 ${hit.length - 5}건` : ''}. ` +
          '초안으로 두고 검토를 요청하면 그날 값으로 바뀝니다.',
      );
    }
  }

  /**
   * 승인 때 — 검토 요청 때 표식을 바꿔 넣은 값이 그 시행일에도 맞는 값인지 다시 본다. 다르면 400(초안으로 되돌려
   * 고치거나 시행일을 다시 정한다). 변수 행을 잠가 값 고치기와 줄 세운다.
   */
  async assertMarkerValuesAt(db: Db, versionId: string, effective: Date) {
    const bindings = await db.variableBinding.findMany({
      where: { versionId, origin: 'marker', state: 'active' },
      select: { text: true, valueId: true, variable: { select: { id: true, label: true } } },
    });
    if (!bindings.length) return;
    await db.$queryRaw`SELECT id FROM variables WHERE id = ANY(${[...new Set(bindings.map((b) => b.variable.id))]}::text[]) FOR SHARE`;
    const fresh = await db.variableValue.findMany({ where: { variableId: { in: bindings.map((b) => b.variable.id) } } });
    const diffs: string[] = [];
    for (const b of bindings) {
      const pick = selectValue(fresh.filter((v) => v.variableId === b.variable.id), effective);
      if ('reason' in pick) diffs.push(`${b.variable.label} "${b.text}" → ${PICK_REASON_TEXT[pick.reason]}`);
      else if (pick.value.id !== b.valueId) diffs.push(`${b.variable.label} "${b.text}" → "${pick.value.value}"`);
    }
    if (diffs.length) {
      throw new BadRequestException(
        `시행일(${toDateOnlyString(effective)})에 쓸 변수 값이 검토 요청 때와 다릅니다 — ${[...new Set(diffs)].join(', ')}. ` +
          '반려해 초안에서 고치거나 시행일을 다시 정하세요.',
      );
    }
  }

  /** 초안 본문을 고쳤을 때 그 버전의 연결 위치를 옮긴다(옮기지 못하면 "다시 이어야 함") */
  async reanchorVersion(db: Db, versionId: string, oldContent: string, newContent: string) {
    if (oldContent === newContent) return;
    const bindings = await db.variableBinding.findMany({ where: { versionId, state: 'active' }, select: BINDING_SELECT });
    for (const b of bindings) {
      const r = reanchor(oldContent, newContent, b);
      await db.variableBinding.update({
        where: { id: b.id },
        data: r.ok
          ? {
              start: r.start,
              end: r.end,
              ...contextOf(newContent, r.start, r.end),
              occurrence: occurrenceOf(newContent, b.text, r.start),
            }
          : { state: 'needs_review', reviewReason: 'reason' in r ? r.reason : 'span_changed', start: 0, end: 0 },
      });
    }
  }

  /**
   * 발행 때 앞 버전의 연결을 새 버전으로 옮긴다(결정 8) — 옛 행은 그 버전의 이력으로 두고, 새 버전에 위치를 옮긴
   * 행을 만들어 parentId 로 잇는다. 위치를 확정하지 못하면 "다시 이어야 함"으로 옮긴다. 옮긴 연결은 옛 문구가 그대로인
   * 자리에만 놓이고, 검토 요청 때 표식을 바꿔 넣은 연결은 새로 들어간 문구에만 있어 둘은 겹치지 않는다.
   */
  async inheritBindings(
    db: Db,
    tenantId: string,
    from: { id: string; content: string } | null,
    to: { id: string; articleId: string; content: string },
    userId: string | null,
  ) {
    if (!from || from.id === to.id) return;
    const olds = await db.variableBinding.findMany({
      where: { versionId: from.id, state: { in: ['active', 'needs_review'] } },
      select: BINDING_SELECT,
    });
    if (!olds.length) return;
    const rows: Prisma.VariableBindingCreateManyInput[] = [];
    for (const b of olds) {
      const base = {
        tenantId,
        variableId: b.variableId,
        articleId: to.articleId,
        versionId: to.id,
        text: b.text,
        origin: 'inherited' as VariableBindingOrigin,
        valueId: b.valueId,
        parentId: b.id,
        createdBy: userId,
      };
      const r = b.state === 'active' ? reanchor(from.content, to.content, b) : null;
      if (r && 'start' in r) {
        rows.push({
          ...base,
          start: r.start,
          end: r.end,
          ...contextOf(to.content, r.start, r.end),
          occurrence: occurrenceOf(to.content, b.text, r.start),
        });
      } else {
        rows.push({
          ...base,
          start: 0,
          end: 0,
          contextBefore: b.contextBefore,
          contextAfter: b.contextAfter,
          occurrence: b.occurrence,
          state: 'needs_review',
          reviewReason: r && 'reason' in r ? r.reason : b.reviewReason,
        });
      }
    }
    await db.variableBinding.createMany({ data: rows });
  }

  private async auditLog(
    db: Db,
    tenantId: string,
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown>,
  ) {
    await db.auditLog.create({
      data: { tenantId, userId: userId ?? undefined, action, entityType, entityId, details: details as Prisma.InputJsonValue },
    });
  }
}

export type AppliedMarker = { variableId: string; key: string; valueId: string; value: string; start: number; end: number };
