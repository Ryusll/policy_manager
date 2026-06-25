import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  parseRevisionNotifyFromMetadata,
  PolicyRevisionNotifyConfig,
} from './revision-notify.types';

@Injectable()
export class RevisionNotifyService {
  constructor(private prisma: PrismaService) {}

  async resolveRecipientIds(tenantId: string, cfg: PolicyRevisionNotifyConfig): Promise<string[]> {
    if (!cfg.enabled) return [];
    const ids = new Set<string>(cfg.userIds || []);
    if (cfg.groupIds?.length) {
      const members = await this.prisma.notificationGroupMember.findMany({
        where: {
          groupId: { in: cfg.groupIds },
          group: { tenantId },
        },
        select: { userId: true },
      });
      for (const m of members) ids.add(m.userId);
    }
    const users = await this.prisma.user.findMany({
      where: { tenantId, id: { in: [...ids] } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  async dispatchPolicyRevisionApproved(params: {
    tenantId: string;
    policyId: string;
    policyTitle: string;
    policyCode: string;
    articleId: string;
    articleLabel: string;
    versionId: string;
    changeNote: string;
    approvedByUserId: string;
    metadata: unknown;
  }) {
    const cfg = parseRevisionNotifyFromMetadata(params.metadata);
    const recipientIds = await this.resolveRecipientIds(params.tenantId, cfg);
    if (!recipientIds.length) return { sent: 0 };

    const title = `[개정 시행] ${params.policyTitle}`;
    const body = [
      `규정: ${params.policyCode} · ${params.policyTitle}`,
      `조문: ${params.articleLabel}`,
      `개정 사유: ${params.changeNote}`,
    ].join('\n');

    const rows = recipientIds
      .filter((uid) => uid !== params.approvedByUserId)
      .map((userId) => ({
        tenantId: params.tenantId,
        userId,
        kind: 'policy_revision',
        title,
        body,
        policyId: params.policyId,
        articleId: params.articleId,
        versionId: params.versionId,
      }));

    if (!rows.length) return { sent: 0 };

    await this.prisma.userNotification.createMany({ data: rows });
    return { sent: rows.length };
  }
}
