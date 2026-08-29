import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportPoliciesDto } from './admin.dto';
import { VariablesService } from '../variables/variables.service';
import { maxPoliciesForPlan } from '../common/plan-limits';
import { validateImport, normalizeImportChapters, type ValidateResult } from './import-validate';
import { newChapterHeader } from '../policies/chapter-header';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private variablesService: VariablesService,
  ) {}

  /**
   * 넣기 전에 전부 훑어 문제를 모은다 (T-13).
   *
   * 예전에는 첫 충돌에서 트랜잭션째 멈춰, 규정 20건 중 17번째가 겹치면 오류 한 줄만
   * 돌아왔다. 무엇을 고쳐야 하는지 알려면 고치고 다시 올리기를 반복해야 했다.
   */
  async validateImportPolicies(tenantId: string, dto: ImportPoliciesDto): Promise<ValidateResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const [existing, currentCount] = await Promise.all([
      this.prisma.policy.findMany({ where: { tenantId }, select: { code: true } }),
      this.prisma.policy.count({ where: { tenantId } }),
    ]);

    return validateImport({
      policies: dto.policies ?? [],
      existingCodes: existing.map((p) => p.code),
      currentCount,
      maxPolicies: maxPoliciesForPlan(tenant.plan),
    });
  }

  async importPolicies(tenantId: string, userId: string, dto: ImportPoliciesDto) {
    // 화면이 사전 검사를 건너뛰거나 그 사이에 다른 사람이 규정을 만들었을 수 있다.
    // 넣기 직전에 한 번 더 본다 — 특히 플랜 상한은 여기서 막지 않으면 뚫린다.
    const check = await this.validateImportPolicies(tenantId, dto);
    if (!check.canImport) {
      const first = check.issues.find((i) => i.level === 'error');
      throw new BadRequestException({
        message: first?.message ?? '가져올 수 없는 데이터입니다.',
        issues: check.issues,
      });
    }

    const createdPolicyIds: string[] = [];
    const toSync: { versionId: string; content: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const p of dto.policies) {
        const exists = await tx.policy.findUnique({
          where: { tenantId_code: { tenantId, code: p.code } },
        });
        if (exists) {
          throw new ConflictException(`규정 코드가 이미 있습니다: ${p.code}`);
        }

        const policy = await tx.policy.create({
          data: {
            tenantId,
            code: p.code,
            title: p.title,
            description: p.description ?? undefined,
          },
        });
        createdPolicyIds.push(policy.id);

        // 최상위 `articles`(장 없는 규정)를 숨김 장으로 눕힌 목록. 사전 검사와
        // 같은 함수를 써서 "검사는 통과했는데 저장이 다르게 본" 상황을 막는다.
        for (const ch of normalizeImportChapters(p)) {
          const header = newChapterHeader(ch);
          const chapter = await tx.chapter.create({
            data: { policyId: policy.id, number: ch.number as number, ...header },
          });
          for (const ar of ch.articles || []) {
            const article = await tx.article.create({
              data: { chapterId: chapter.id, number: ar.number, title: ar.title },
            });
            const content = ar.content ?? '';
            const status = ar.publish ? 'published' : 'draft';
            const ver = await tx.articleVersion.create({
              data: {
                articleId: article.id,
                versionNum: 1,
                content,
                status,
                changeNote: status === 'published' ? '일괄 import' : undefined,
                createdBy: userId,
              },
            });
            toSync.push({ versionId: ver.id, content });
          }
        }
      }
    });

    for (const s of toSync) {
      await this.variablesService.syncVariableUsagesFromContent(tenantId, s.versionId, s.content);
    }

    await this.audit.log({
      tenantId,
      userId,
      action: 'admin.import_policies',
      entityType: 'Tenant',
      entityId: tenantId,
      details: { policyCount: dto.policies.length, policyIds: createdPolicyIds },
    });

    return { ok: true, importedPolicies: dto.policies.length, policyIds: createdPolicyIds };
  }
}
