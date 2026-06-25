import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PlanTier } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private normalizeTargetPlan(plan: string): PlanTier {
    if (plan === 'pro' || plan === 'enterprise') return plan;
    throw new BadRequestException('Only pro or enterprise can be purchased');
  }

  async startCheckout(tenantId: string, userId: string, tenantSlug: string, targetPlanRaw: string) {
    const targetPlan = this.normalizeTargetPlan(targetPlanRaw);
    const provider = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

    // 개발/데모 환경: 결제 성공을 즉시 시뮬레이션
    if (provider === 'mock') {
      await this.updateTenantPlanByTenantId(tenantId, userId, targetPlan, 'mock_checkout_auto');
      return {
        provider,
        upgraded: true,
        targetPlan,
        message: 'Mock checkout completed. Plan upgraded immediately.',
      };
    }

    const checkoutBase = process.env.PAYMENT_HOSTED_CHECKOUT_URL;
    if (!checkoutBase) {
      throw new BadRequestException(
        'PAYMENT_HOSTED_CHECKOUT_URL is not configured for non-mock provider',
      );
    }

    const params = new URLSearchParams({
      tenantSlug,
      targetPlan,
    });
    return {
      provider,
      upgraded: false,
      targetPlan,
      checkoutUrl: `${checkoutBase}?${params.toString()}`,
    };
  }

  async handleWebhook(secretHeader: string | undefined, body: any) {
    const expected = process.env.PAYMENT_WEBHOOK_SECRET || '';
    if (expected && secretHeader !== expected) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    if (body?.type !== 'payment.succeeded') {
      return { ok: true, ignored: true };
    }

    const tenantSlug = body?.data?.tenantSlug as string | undefined;
    const targetPlan = body?.data?.targetPlan as string | undefined;
    const paymentId = body?.data?.paymentId as string | undefined;
    if (!tenantSlug || !targetPlan) {
      throw new BadRequestException('tenantSlug and targetPlan are required');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new BadRequestException('Tenant not found');

    await this.updateTenantPlanByTenantId(
      tenant.id,
      null,
      this.normalizeTargetPlan(targetPlan),
      paymentId || 'webhook',
    );
    return { ok: true };
  }

  private async updateTenantPlanByTenantId(
    tenantId: string,
    userId: string | null,
    targetPlan: PlanTier,
    source: string,
  ) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan: targetPlan },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'tenant.plan_changed',
      entityType: 'tenant',
      entityId: tenantId,
      details: { targetPlan, source },
    });
  }
}
