import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportPoliciesDto } from './admin.dto';
import { VariablesService } from '../variables/variables.service';
import { maxPoliciesForPlan, planLabel } from '../common/plan-limits';
import { claimPolicySlots, policyLimitFields } from '../policies/policy-slots';
import { validateImport, normalizeImportChapters, type ValidateResult } from './import-validate';
import { newChapterHeader } from '../policies/chapter-header';
import { formatJo } from '../common/article-label';
import { parseDateOnly } from '../common/date-only';

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
  async validateImportPolicies(tenantId: string, dto: ImportPoliciesDto) {
    const { limitIssue: _limitIssue, ...result } = await this.checkImport(tenantId, dto);
    return result;
  }

  /**
   * 사전 검사와 저장 직전 검사가 함께 쓴다. 상한이면 다른 생성 경로의 403 과 같은 코드·값(`limit`)을 싣는다(T-198) —
   * 화면이 문구가 아니라 코드로 가른다. 상한 판정은 `validateImport` 한 곳이다
   */
  private async checkImport(
    tenantId: string,
    dto: ImportPoliciesDto,
  ): Promise<ValidateResult & { limit?: ReturnType<typeof policyLimitFields> }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const [existing, currentCount] = await Promise.all([
      this.prisma.policy.findMany({ where: { tenantId }, select: { code: true } }),
      this.prisma.policy.count({ where: { tenantId } }),
    ]);

    const maxPolicies = maxPoliciesForPlan(tenant.plan);
    const result = validateImport({
      policies: dto.policies ?? [],
      existingCodes: existing.map((p) => p.code),
      currentCount,
      maxPolicies,
      planName: planLabel(tenant.plan),
    });
    return result.limitIssue ? { ...result, limit: policyLimitFields(tenant.plan, maxPolicies, currentCount) } : result;
  }

  async importPolicies(tenantId: string, userId: string, dto: ImportPoliciesDto) {
    // 화면이 사전 검사를 건너뛰거나 그 사이에 다른 사람이 규정을 만들었을 수 있다.
    // 넣기 직전에 한 번 더 본다 — 특히 플랜 상한은 여기서 막지 않으면 뚫린다.
    const check = await this.checkImport(tenantId, dto);
    if (!check.canImport) {
      // 상한 코드를 실으면 문구도 상한 issue 의 것 — 코드와 문구가 서로 다른 실패를 가리키지 않게
      const first = check.limitIssue ?? check.issues.find((i) => i.level === 'error');
      throw new BadRequestException({
        message: first?.message ?? '가져올 수 없는 데이터입니다.',
        issues: check.issues,
        ...check.limit,
      });
    }

    // 바로 시행하는 조문에 변수 표식({{KEY}})이 남아 있으면 안 된다(T-109) — 초안으로 가져와 검토를 요청하면
    // 그날 값으로 바뀐다
    await this.variablesService.assertNoMarkers(
      this.prisma,
      tenantId,
      dto.policies.flatMap((p) =>
        normalizeImportChapters(p).flatMap((ch) =>
          (ch.articles || [])
            .filter((ar) => ar.publish)
            .map((ar) => ({ label: `${p.code} ${formatJo(ar.number)}`, content: ar.content ?? '' })),
        ),
      ),
    );
    const createdPolicyIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      // 사전 검사 뒤에 다른 사람이 규정을 만들었을 수 있다 — 회사 행을 잠근 뒤 상한·코드 중복을 다시 본다(T-135).
      // 이 잠금 없이 세면 새 규정·가져오기 확정과 마지막 한 자리를 함께 가져간다
      await claimPolicySlots(tx, tenantId, dto.policies.map((p) => p.code));
      for (const p of dto.policies) {
        // 사전 검사가 형식과 "발행하면 필수"를 이미 확인했다
        const effective = parseDateOnly(p.effectiveDate);
        const policy = await tx.policy.create({
          data: {
            tenantId,
            code: p.code,
            title: p.title,
            description: p.description ?? undefined,
            effectiveDate: effective ?? undefined,
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
            await tx.articleVersion.create({
              data: {
                articleId: article.id,
                versionNum: 1,
                content,
                status,
                changeNote: status === 'published' ? '일괄 import' : undefined,
                effectiveDate: status === 'published' ? effective : undefined,
                // 발행일(T-108) — 시스템에서 시행본으로 발행한 시각. 시행일과 다르다
                publishedAt: status === 'published' ? new Date() : undefined,
                createdBy: userId,
              },
            });
          }
        }
      }
      await this.audit.log(
        {
          tenantId,
          userId,
          action: 'admin.import_policies',
          entityType: 'Tenant',
          entityId: tenantId,
          details: { policyCount: dto.policies.length, policyIds: createdPolicyIds },
        },
        tx,
      );
    }, { maxWait: 10_000, timeout: 60_000 });

    return { ok: true, importedPolicies: dto.policies.length, policyIds: createdPolicyIds };
  }
}
