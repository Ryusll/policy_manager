import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PlanTier } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  nextPeriod,
  planSubscriptionTransition,
  resolvePaymentAmount,
  type PlanTierName,
} from './billing-records';

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
      {
        providerPaymentId: paymentId,
        providerOrderId: body?.data?.orderId,
        amount: body?.data?.amount,
      },
    );
    return { ok: true };
  }

  /**
   * 요금제 변경 + 결제·구독 기록 (T-17).
   *
   * 예전에는 `tenant.plan` 한 칸만 바꿨다. 누가 언제 무엇을 샀는지, 이 요금제가 언제까지인지
   * 남는 곳이 없었고 결제 이력 테이블 셋은 만들어만 두고 쓰이지 않았다.
   *
   * 한 트랜잭션으로 처리한다 — 요금제만 올라가고 기록이 빠지면 정확히 지금까지의 상태가
   * 되고, 기록만 남고 요금제가 그대로면 돈을 받고 기능을 안 준 셈이 된다.
   */
  private async updateTenantPlanByTenantId(
    tenantId: string,
    userId: string | null,
    targetPlan: PlanTier,
    source: string,
    payment?: { providerPaymentId?: string; providerOrderId?: string; amount?: unknown },
  ) {
    const provider = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
    const now = new Date();
    const period = nextPeriod(now);
    const { amount, mock } = resolvePaymentAmount(provider, payment?.amount);

    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.billingCustomer.upsert({
        where: { tenantId },
        create: { tenantId, provider },
        update: { provider },
      });

      const current = await tx.billingSubscription.findFirst({
        where: { tenantId, status: { in: ['active', 'trial'] } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, plan: true, status: true },
      });

      const move = planSubscriptionTransition(
        current
          ? { id: current.id, plan: current.plan as PlanTierName, status: current.status as any }
          : null,
        targetPlan as PlanTierName,
      );

      let subscriptionId: string;
      if (move.kind === 'extend') {
        const updated = await tx.billingSubscription.update({
          where: { id: move.subscriptionId },
          data: { currentPeriodStart: period.start, currentPeriodEnd: period.end, status: 'active' },
        });
        subscriptionId = updated.id;
      } else {
        if (move.kind === 'replace') {
          await tx.billingSubscription.update({
            where: { id: move.cancelSubscriptionId },
            data: { status: 'canceled', canceledAt: now },
          });
        }
        const created = await tx.billingSubscription.create({
          data: {
            tenantId,
            billingCustomerId: customer.id,
            provider,
            plan: targetPlan,
            status: 'active',
            startedAt: now,
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
          },
        });
        subscriptionId = created.id;
      }

      await tx.billingPayment.create({
        data: {
          tenantId,
          billingCustomerId: customer.id,
          subscriptionId,
          provider,
          providerPaymentId: payment?.providerPaymentId ?? null,
          providerOrderId: payment?.providerOrderId ?? null,
          amount,
          status: 'succeeded',
          paidAt: now,
          metadata: { source, targetPlan, mock },
        },
      });

      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          plan: targetPlan,
          // 구독 기간이 곧 요금제 유효기간이다. 예전에는 플랫폼 관리자가 손으로 넣어야 했다.
          planExpiresAt: period.end,
          billingStatus: 'active',
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'tenant.plan_changed',
      entityType: 'tenant',
      entityId: tenantId,
      details: { targetPlan, source, provider, amount, mock, periodEnd: period.end.toISOString() },
    });
  }

  /** 결제·구독 이력 조회 (T-17). 기록이 보이지 않으면 남기는 의미가 없다. */
  async history(tenantId: string) {
    const [subscriptions, payments] = await Promise.all([
      this.prisma.billingSubscription.findMany({
        where: { tenantId },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      this.prisma.billingPayment.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const currentSubscription = subscriptions.find((s) => s.status === 'active') ?? null;
    return { currentSubscription, subscriptions, payments };
  }
}
