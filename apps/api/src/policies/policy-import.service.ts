import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { VariablesService } from '../variables/variables.service';
import { formatJo } from '../common/article-label';
import { parseDateOnly } from '../common/date-only';
import { claimPolicySlots } from './policy-slots';
import { buildNewPolicyRecords, insertNewPolicy, newPolicyAudits, type NewPolicyPlan } from './new-policy-records';
import { ImportPolicyDocumentDto } from './policy-import.dto';

/** 관리자가 가져와 바로 시행할 때의 시행 사유 — 예전 화면이 한꺼번에 시행에 넣던 문구 그대로 */
const IMPORT_CHANGE_NOTE = '기존 규정 가져오기 자동 게시';

@Injectable()
export class PolicyImportService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private variables: VariablesService,
  ) {}

  /**
   * 텍스트 가져오기를 한 번에 저장한다(T-135, PAT-03) — 규정·장·조문·첫 버전·가져오기 이력·감사 기록을 트랜잭션 하나로.
   *
   * 예전에는 브라우저가 규정 만들기 → 장마다 → 조문마다 → (관리자면) 한꺼번에 시행 → 규정 시행일 → 가져오기 이력을 차례로 불러,
   * 중간에 하나라도 실패하면 반쪽 규정이 남았다. 권한·시행 의미는 서버가 정한다 — 편집자는 초안만(관리자가 상세 화면에서 한꺼번에
   * 시행), 관리자는 시행일을 받아 바로 시행한다(한꺼번에 시행과 같은 검사 — 변수 표식이 남은 본문은 400). 새 규정이라 개정 알림
   * 설정이 아직 없으므로, 한꺼번에 시행이 보내던 시행 알림은 받을 사람이 없어 보내지 않는다.
   */
  async importDocument(tenantId: string, user: { id: string; role: string }, dto: ImportPolicyDocumentDto) {
    const publish = user.role === 'admin';
    const effective = publish ? parseDateOnly(dto.effectiveDate) : null;
    if (publish && !effective) {
      throw new BadRequestException('시행일(YYYY-MM-DD)을 입력하세요 — 관리자가 가져오면 바로 시행됩니다. 가져오는 본문이 실제로 시행된 날입니다.');
    }
    const plan: NewPolicyPlan = {
      chapters: dto.chapters.map((ch) => ({ number: ch.number, title: ch.title ?? '', suppressHeader: ch.suppressHeader === true, sections: [] })),
      rows: dto.chapters.flatMap((ch, chapterIndex) =>
        ch.articles.map((a) => ({
          number: a.number,
          branchNumber: a.branchNumber ?? null,
          clauseNumber: a.clauseNumber ?? null,
          itemNumber: a.itemNumber ?? null,
          title: a.title ?? '',
          content: a.content ?? '',
          chapterIndex,
          sectionIndex: null,
        })),
      ),
      appendices: [],
    };
    const department = dto.department?.trim();
    const category = dto.category?.trim();
    const metadata = { ...(department ? { department } : {}), ...(category ? { category } : {}) };
    const records = buildNewPolicyRecords(plan, {
      tenantId,
      userId: user.id,
      code: dto.code,
      title: dto.title,
      description: dto.description?.trim() || undefined,
      metadata: Object.keys(metadata).length ? metadata : undefined,
      effective,
      changeNote: IMPORT_CHANGE_NOTE,
      now: new Date(),
    });
    const policyId = records.policy.id;
    const audits: AuditEntry[] = newPolicyAudits(records, { tenantId, userId: user.id, details: { source: 'text-import' } });
    if (publish && records.versions.length) {
      audits.push({
        tenantId,
        userId: user.id,
        action: 'version.bulk_publish',
        entityType: 'Policy',
        entityId: policyId,
        details: { count: records.versions.length, changeNote: IMPORT_CHANGE_NOTE, articleIds: records.versions.slice(0, 200).map((v) => v.articleId) },
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 플랜 상한·코드 중복은 회사 행을 잠근 뒤 센다 — 새 규정·가져오기 확정·일괄 등록과 같은 줄
        await claimPolicySlots(tx, tenantId, [records.policy.code]);
        if (publish) {
          // 바로 시행하는 본문이라 변수 표식이 남아 있으면 안 된다(T-109, 한꺼번에 시행과 같다)
          await this.variables.assertNoMarkers(
            tx,
            tenantId,
            plan.rows
              .filter((r) => r.content)
              .map((r) => ({
                label: `${formatJo(r.number, r.branchNumber)}${r.clauseNumber ? ` 제${r.clauseNumber}항` : ''}${r.itemNumber ? ` 제${r.itemNumber}목` : ''}`,
                content: r.content,
              })),
          );
        }
        const policy = await insertNewPolicy(tx, records);
        await this.audit.logMany(audits, tx);
        await tx.policyImportLog.create({
          data: {
            tenantId,
            userId: user.id,
            policyId,
            sourceName: dto.log?.sourceName || null,
            parseProfile: dto.log?.parseProfile || 'mixed',
            chapterCount: records.chapters.length,
            // 원문에서 나눈 조 수(항·목으로 펼치기 전) — 화면이 세어 보낸다
            articleCount: dto.log?.articleCount ?? records.articles.length,
            cleanupOptions: dto.log?.cleanupOptions as Prisma.InputJsonValue | undefined,
            status: 'success',
          },
        });
        return { ...policy, articleCount: records.articles.length, published: publish ? records.versions.length : 0 };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }
}
