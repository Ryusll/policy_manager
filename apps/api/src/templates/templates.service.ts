import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanTier, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CloneTemplateDto, CreateTemplateDto, UpdateTemplateDto } from './templates.dto';

const MAX_TEMPLATE_NAME = 120;
const MAX_TEMPLATE_DESCRIPTION = 500;
const MAX_TEMPLATE_HTML = 200_000;
const MAX_TEMPLATE_CSS = 80_000;

function sanitizeHtmlText(html: string) {
  let out = String(html ?? '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<(iframe|object|embed|link|meta|base|form|input|button|textarea|select)[\s\S]*?>[\s\S]*?<\/\1>/gi, '');
  out = out.replace(/<(iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*\/?>/gi, '');
  out = out.replace(/\son\w+="[^"]*"/gi, '');
  out = out.replace(/\son\w+='[^']*'/gi, '');
  out = out.replace(/\son\w+=\{[^}]*\}/gi, '');
  out = out.replace(/\sxmlns(:\w+)?="[^"]*"/gi, '');
  out = out.replace(/\sstyle="[^"]*"/gi, (m) =>
    m
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/url\(\s*['"]?\s*(javascript:|vbscript:|data:text\/html)/gi, 'url(about:blank'),
  );
  out = out.replace(/\sstyle='[^']*'/gi, (m) =>
    m
      .replace(/expression\s*\([^)]*\)/gi, '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/url\(\s*['"]?\s*(javascript:|vbscript:|data:text\/html)/gi, 'url(about:blank'),
  );
  out = out.replace(/vbscript:/gi, '');
  out = out.replace(/data:text\/html/gi, '');
  out = out.replace(/javascript:/gi, '');
  return out;
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

  async update(tenantId: string, id: string, dto: UpdateTemplateDto, userId: string) {
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
      action: 'template.update',
      entityType: 'PolicyTemplate',
      entityId: id,
      details: { fields: Object.keys(dto), before: this.snapshot(before), after: this.snapshot(updated) },
    });
    return updated;
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
