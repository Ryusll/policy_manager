import { Body, Controller, Get, Headers, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { BillingWebhookDto, CheckoutDto } from './billing.dto';
import { Public, Roles } from '../common/guards/decorators';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Post('checkout')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Checkout session 생성 (admin only)' })
  checkout(@Request() req: any, @Body() dto: CheckoutDto) {
    return this.billingService.startCheckout(
      req.user.tenantId,
      req.user.id,
      req.user.tenant?.slug || '',
      dto.targetPlan,
    );
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: '결제·구독 이력 (admin only)' })
  history(@Request() req: any) {
    return this.billingService.history(req.user.tenantId);
  }

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: '결제사 webhook 수신' })
  webhook(
    @Headers('x-billing-secret') secret: string | undefined,
    @Body() body: BillingWebhookDto,
  ) {
    return this.billingService.handleWebhook(secret, body);
  }
}
