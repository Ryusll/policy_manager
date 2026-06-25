import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportPoliciesDto } from './admin.dto';
import { VariablesService } from '../variables/variables.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private variablesService: VariablesService,
  ) {}

  async importPolicies(tenantId: string, userId: string, dto: ImportPoliciesDto) {
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

        for (const ch of p.chapters || []) {
          const chapter = await tx.chapter.create({
            data: { policyId: policy.id, number: ch.number, title: ch.title },
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
