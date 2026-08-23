import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class CheckoutDto {
  @ApiProperty({ enum: ['pro', 'enterprise'] })
  @IsIn(['pro', 'enterprise'])
  targetPlan: 'pro' | 'enterprise';
}

export class BillingWebhookDto {
  @ApiProperty({ example: 'payment.succeeded' })
  @IsString()
  type: string;

  @ApiProperty({
    example: {
      tenantSlug: 'demo',
      targetPlan: 'pro',
      paymentId: 'pay_123',
      orderId: 'ord_123',
      amount: 49000,
    },
  })
  data: {
    tenantSlug: string;
    targetPlan: 'starter' | 'pro' | 'enterprise';
    paymentId?: string;
    orderId?: string;
    /** 결제사가 알려 준 실제 금액. mock 결제는 무시하고 0으로 남긴다 (T-17) */
    amount?: number;
  };
}
