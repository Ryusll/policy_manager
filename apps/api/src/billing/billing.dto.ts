import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CheckoutDto {
  @ApiProperty({ enum: ['pro', 'enterprise'] })
  @IsIn(['pro', 'enterprise'])
  targetPlan: 'pro' | 'enterprise';
}

/**
 * 웹훅 본문의 `data`. 예전에는 검증 데코레이터가 없어 전역 ValidationPipe
 * (`forbidNonWhitelisted`)가 `data` 를 통째로 거부했다 — 결제사가 보낸 웹훅이 한 번도 처리될 수
 * 없는 상태였다(T-125 점검). 받아들이는 대신 서비스가 결제 사용·비밀키를 먼저 확인한다.
 */
export class BillingWebhookDataDto {
  @ApiProperty({ example: 'demo' })
  @IsString()
  @IsNotEmpty()
  tenantSlug: string;

  @ApiProperty({ enum: ['starter', 'pro', 'enterprise'], example: 'pro' })
  @IsIn(['starter', 'pro', 'enterprise'])
  targetPlan: 'starter' | 'pro' | 'enterprise';

  @ApiProperty({ required: false, example: 'pay_123' })
  @IsOptional()
  @IsString()
  paymentId?: string;

  @ApiProperty({ required: false, example: 'ord_123' })
  @IsOptional()
  @IsString()
  orderId?: string;

  /** 결제사가 알려 준 실제 금액. mock 결제는 무시하고 0으로 남긴다 (T-17) */
  @ApiProperty({ required: false, example: 49000 })
  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class BillingWebhookDto {
  @ApiProperty({ example: 'payment.succeeded' })
  @IsString()
  type: string;

  @ApiProperty({ required: false, type: BillingWebhookDataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BillingWebhookDataDto)
  data?: BillingWebhookDataDto;
}
