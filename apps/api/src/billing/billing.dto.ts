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
    },
  })
  data: {
    tenantSlug: string;
    targetPlan: 'starter' | 'pro' | 'enterprise';
    paymentId?: string;
  };
}
