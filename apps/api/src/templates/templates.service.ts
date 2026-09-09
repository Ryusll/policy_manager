import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanTier, Prisma } from '@prisma/client';
import * as sanitizeHtml from 'sanitize-html';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CloneTemplateDto, CreateTemplateDto, UpdateTemplateDto } from './templates.dto';

const MAX_TEMPLATE_NAME = 120;
const MAX_TEMPLATE_DESCRIPTION = 500;
const MAX_TEMPLATE_HTML = 200_000;
const MAX_TEMPLATE_CSS = 80_000;

/**
 * 템플릿 HTML sanitize (서버 = 보안 경계, 저장 시점에 정화).
 *
 * 과거 정규식 구현은 따옴표 없는 이벤트 핸들러(`<img src=x onerror=alert(1)>`)와
 * 허용목록에 없던 태그(`<svg onload=…>`)를 통과시켰다. 검증된 라이브러리로 교체했다.
 *
 * 클라이언트도 렌더 시 동일 정책으로 sanitize한다
 * (`apps/web/src/components/policy-template/templateSanitize.ts`).
 * 허용 목록을 바꿀 때는 **양쪽을 함께** 수정해야 한다.
 */
const TEMPLATE_ALLOWED_TAGS = [
  'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img', 'figure', 'figcaption', 'blockquote', 'pre', 'code',
  'header', 'footer', 'section', 'article', 'aside', 'main', 'nav',
  'mark', 'time', 'address', 'a',
];

const TEMPLATE_ALLOWED_ATTRS = [
  'class', 'id', 'style', 'title', 'lang', 'dir',
  'src', 'alt', 'width', 'height',
  'colspan', 'rowspan', 'span', 'align', 'valign',
  'datetime', 'cite',
  'href', 'target', 'rel',
];

function sanitizeHtmlText(html: string) {
  return sanitizeHtml(String(html ?? ''), {
    allowedTags: TEMPLATE_ALLOWED_TAGS,
    // 모든 허용 태그에 동일 속성 집합 적용. on* 이벤트 핸들러는 목록에 없어 제거된다
    allowedAttributes: { '*': TEMPLATE_ALLOWED_ATTRS },
    // 문서 양식용 이미지: data URI(로고) + http(s) 허용
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    // style 속성 내부의 위험 구문 제거는 sanitizeCssText와 동일 정책으로 후처리
    transformTags: {
      '*': (tagName, attribs) => {
        if (typeof attribs.style === 'string') {
          attribs.style = sanitizeCssText(attribs.style);
        }
        return { tagName, attribs };
      },
    },
  });
}

function sanitizeCssText(css: string) {
  let out = String(css ?? '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/@import/gi, '');
  out = out.replace(/@charset/gi, '');
  out = out.replace(/@namespace/gi, '');
  out = out.replace(/expression\s*\(/gi, '');
  out = out.replace(/behavior\s*:/gi, '');
  out = out.replace(/-moz-binding\s*:/gi, '');
  out = out.replace(/url\(\s*['"]?\s*(javascript:|vbscript:|data:text\/html)/gi, 'url(about:blank');
  out = out.replace(/javascript:/gi, '');
  out = out.replace(/vbscript:/gi, '');
  out = out.replace(/data:text\/html/gi, '');
  // </style> 로 스타일 컨텍스트를 탈출해 스크립트를 여는 것을 방지
  out = out.replace(/<\/?style\b[^>]*>/gi, '');
  out = out.replace(/<\/?script\b[^>]*>/gi, '');
  return out;
}

function sanitizeLayoutJson(layoutJson: Record<string, unknown>): Prisma.InputJsonValue {
  const cloned = JSON.parse(JSON.stringify(layoutJson || {})) as Record<string, unknown>;
  if (typeof cloned.rawHtml === 'string') {
    cloned.rawHtml = sanitizeHtmlText(cloned.rawHtml);
  }
  return cloned as Prisma.InputJsonValue;
}

function normalizeTemplateName(name: string) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

function validateTemplateShape(input: {
  name?: string;
  description?: string;
  layoutJson?: Record<string, unknown>;
  cssText?: string;
}) {
  if (input.name !== undefined) {
    const normalized = normalizeTemplateName(input.name);
    if (!normalized) throw new BadRequestException('Template name is required');
    if (normalized.length > MAX_TEMPLATE_NAME) {
      throw new BadRequestException(`Template name must be <= ${MAX_TEMPLATE_NAME} characters`);
    }
  }
  if (input.description !== undefined && input.description.length > MAX_TEMPLATE_DESCRIPTION) {
    throw new BadRequestException(`Template description must be <= ${MAX_TEMPLATE_DESCRIPTION} characters`);
  }

  const layout = input.layoutJson;
  if (layout !== undefined) {
    const mode = layout.mode;
    if (mode !== undefined && mode !== 'basic' && mode !== 'html') {
      throw new BadRequestException('layoutJson.mode must be one of: basic, html');
    }
    const hasBasic = Object.prototype.hasOwnProperty.call(layout, 'basicConfig');
    const hasHtml = typeof layout.rawHtml === 'string';
    if (mode === 'basic' && !hasBasic) {
      throw new BadRequestException('basic mode requires layoutJson.basicConfig');
    }
    if (mode === 'html' && !hasHtml) {
      throw new BadRequestException('html mode requires layoutJson.rawHtml');
    }
    const serialized = JSON.stringify(layout);
    if (serialized.length > 400_000) {
      throw new BadRequestException('layoutJson is too large');
    }
  }

  if (input.cssText !== undefined && input.cssText.length > MAX_TEMPLATE_CSS) {
    throw new BadRequestException(`cssText must be <= ${MAX_TEMPLATE_CSS} characters`);
  }
  if (input.layoutJson && typeof input.layoutJson.rawHtml === 'string' && input.layoutJson.rawHtml.length > MAX_TEMPLATE_HTML) {
    throw new BadRequestException(`rawHtml must be <= ${MAX_TEMPLATE_HTML} characters`);
  }
}

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async getTenantPlan(tenantId: string): Promise<PlanTier> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant.plan;
  }

  private ensureAdvancedTemplateAllowed(plan: PlanTier, layoutJson?: Record<string, unknown>, cssText?: string) {
    if (plan === 'enterprise') return;
    const rawHtml = typeof layoutJson?.rawHtml === 'string' ? String(layoutJson.rawHtml).trim() : '';
    const css = String(cssText ?? '').trim();
    if (rawHtml || css) {
      throw new ForbiddenException('Custom HTML/CSS template editing requires enterprise plan');
    }
  }

  private snapshot(template: {
    name: string;
    description: string | null;
    isDefault: boolean;
    isActive: boolean;
    layoutJson: unknown;
    cssText: string;
  }) {
    return {
      name: template.name,
      description: template.description,
      isDefault: template.isDefault,
      isActive: template.isActive,
      layoutJson: template.layoutJson,
      cssText: template.cssText,
    };
  }

  async findAll(tenantId: string) {
    return this.prisma.policyTemplate.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.prisma.policyTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  private async ensureUniqueName(tenantId: string, name: string, excludeId?: string) {
    const found = await this.prisma.policyTemplate.findFirst({
      where: { tenantId, name, NOT: excludeId ? { id: excludeId } : undefined },
      select: { id: true },
    });
    if (found) throw new ConflictException('Template name already exists');
  }

  private async setDefaultIfNeeded(
    tenantId: string,
    templateId: string,
    tx: Prisma.TransactionClient,
    isDefault?: boolean,
  ) {
    if (!isDefault) return;
    await tx.policyTemplate.updateMany({
      where: { tenantId, isDefault: true, NOT: { id: templateId } },
      data: { isDefault: false },
    });
  }

  async create(tenantId: string, dto: CreateTemplateDto, userId: string) {
    validateTemplateShape(dto);
    const plan = await this.getTenantPlan(tenantId);
    this.ensureAdvancedTemplateAllowed(plan, dto.layoutJson, dto.cssText);
    const normalizedName = normalizeTemplateName(dto.name);
    await this.ensureUniqueName(tenantId, normalizedName);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.policyTemplate.create({
        data: {
          tenantId,
          name: normalizedName,
          description: dto.description?.trim(),
          isDefault: !!dto.isDefault,
          isActive: dto.isActive ?? true,
          layoutJson: sanitizeLayoutJson(dto.layoutJson),
          cssText: sanitizeCssText(dto.cssText || ''),
        },
      });
      await this.setDefaultIfNeeded(tenantId, row.id, tx, dto.isDefault);
      return row;
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'template.create',
      entityType: 'PolicyTemplate',
      entityId: created.id,
      details: { name: created.name, isDefault: created.isDefault, snapshot: this.snapshot(created) },
    });
    return created;
  }

  /**
   * 편집과 복원이 공유하는 실제 적용부.
   *
   * 검증(모양·플랜·이름 중복)을 여기 모아 둔 이유는 복원이 그 검사를 건너뛰기 쉬워서다.
   * 예전 스냅샷에는 지금 플랜으로는 만들 수 없는 자유 HTML 이 들어 있을 수 있고,
   * 그때의 이름을 지금 다른 템플릿이 쓰고 있을 수도 있다.
   */
  private async applyTemplateChange(
    tenantId: string,
    id: string,
    dto: UpdateTemplateDto,
    userId: string,
    audit: { action: string; details?: Record<string, unknown> },
  ) {
    validateTemplateShape(dto);
    const plan = await this.getTenantPlan(tenantId);
    this.ensureAdvancedTemplateAllowed(plan, dto.layoutJson, dto.cssText);
    const before = await this.findOne(tenantId, id);
    const normalizedName = dto.name !== undefined ? normalizeTemplateName(dto.name) : undefined;
    if (normalizedName) await this.ensureUniqueName(tenantId, normalizedName, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await this.setDefaultIfNeeded(tenantId, id, tx, true);
      }
      return tx.policyTemplate.update({
        where: { id },
        data: {
          ...(normalizedName ? { name: normalizedName } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.layoutJson ? { layoutJson: sanitizeLayoutJson(dto.layoutJson) } : {}),
          ...(dto.cssText !== undefined ? { cssText: sanitizeCssText(dto.cssText) } : {}),
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: audit.action,
      entityType: 'PolicyTemplate',
      entityId: id,
      details: {
        ...(audit.details ?? {}),
        fields: Object.keys(dto),
        before: this.snapshot(before),
        after: this.snapshot(updated),
      },
    });
    return updated;
  }

  async update(tenantId: string, id: string, dto: UpdateTemplateDto, userId: string) {
    return this.applyTemplateChange(tenantId, id, dto, userId, { action: 'template.update' });
  }

  /**
   * 이력 복원 (T-58).
   *
   * 예전에는 화면이 감사 로그에서 스냅샷을 읽어 `update` 를 호출했다. 그래서 감사 로그에
   * `template.update` 로만 남아 **평범한 편집과 구분되지 않았다** — 누가 언제 어느 시점으로
   * 되돌렸는지 추적할 수 없었다는 뜻이다.
   *
   * 스냅샷을 클라이언트가 보내는 대신 **서버가 이력에서 직접 읽는다**. 무엇을 복원할지
   * 화면이 정하면, 복원 기록에 적힌 시점과 실제로 들어간 내용이 어긋날 수 있다.
   */
  async restore(tenantId: string, id: string, revisionId: string, userId: string) {
    await this.findOne(tenantId, id);
    const revision = await this.prisma.auditLog.findFirst({
      where: { id: revisionId, tenantId, entityType: 'PolicyTemplate', entityId: id },
    });
    if (!revision) throw new NotFoundException('복원할 이력을 찾을 수 없습니다.');

    const details = (revision.details ?? {}) as Record<string, any>;
    const snap = details.after ?? details.snapshot;
    if (!snap || typeof snap !== 'object') {
      throw new BadRequestException('이 이력에는 복원할 내용이 없습니다.');
    }

    return this.applyTemplateChange(
      tenantId,
      id,
      {
        name: snap.name,
        description: snap.description ?? '',
        isDefault: !!snap.isDefault,
        isActive: snap.isActive !== false,
        layoutJson: snap.layoutJson ?? {},
        cssText: snap.cssText ?? '',
      },
      userId,
      {
        action: 'template.restore',
        details: {
          restoredFromRevisionId: revisionId,
          restoredFromAction: revision.action,
          restoredFromAt: revision.createdAt.toISOString(),
        },
      },
    );
  }

  async remove(tenantId: string, id: string, userId: string) {
    const target = await this.findOne(tenantId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.policy.updateMany({
        where: { tenantId, templateId: id },
        data: { templateId: null },
      });
      await tx.policyTemplate.delete({ where: { id } });
      if (target.isDefault) {
        const fallback = await tx.policyTemplate.findFirst({
          where: { tenantId, id: { not: id } },
          orderBy: { createdAt: 'asc' },
        });
        if (fallback) {
          await tx.policyTemplate.update({
            where: { id: fallback.id },
            data: { isDefault: true },
          });
        }
      }
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'template.delete',
      entityType: 'PolicyTemplate',
      entityId: id,
      details: { name: target.name, snapshot: this.snapshot(target) },
    });
  }

  async clone(tenantId: string, id: string, dto: CloneTemplateDto, userId: string) {
    const source = await this.findOne(tenantId, id);
    const newName = (dto.name || `${source.name} (복제)`).trim();
    await this.ensureUniqueName(tenantId, newName);

    const cloned = await this.prisma.policyTemplate.create({
      data: {
        tenantId,
        name: newName,
        description: source.description,
        isDefault: false,
        isActive: source.isActive,
        layoutJson: source.layoutJson as object,
        cssText: source.cssText,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'template.clone',
      entityType: 'PolicyTemplate',
      entityId: cloned.id,
      details: { sourceId: source.id, sourceName: source.name, snapshot: this.snapshot(cloned) },
    });
    return cloned;
  }

  async setDefault(tenantId: string, id: string, userId: string) {
    await this.findOne(tenantId, id);
    const template = await this.prisma.$transaction(async (tx) => {
      await tx.policyTemplate.updateMany({
        where: { tenantId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      return tx.policyTemplate.update({
        where: { id },
        data: { isDefault: true, isActive: true },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'template.setDefault',
      entityType: 'PolicyTemplate',
      entityId: id,
      details: { snapshot: this.snapshot(template) },
    });
    return template;
  }

  async listRevisions(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        entityType: 'PolicyTemplate',
        entityId: id,
        action: { startsWith: 'template.' },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      user: row.user,
      details: row.details,
    }));
  }
}
