import { Controller, Get, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MinPlan } from '../common/guards/decorators';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  @Get('api-access')
  @MinPlan('enterprise')
  @ApiOperation({ summary: 'Enterprise 전용 API 연동 정보 조회' })
  getApiAccess(@Request() req: any) {
    return {
      enabled: true,
      plan: req.user?.tenant?.plan,
      tenant: {
        id: req.user?.tenant?.id,
        slug: req.user?.tenant?.slug,
        name: req.user?.tenant?.name,
      },
      api: {
        basePath: '/api',
        auth: 'Bearer access token',
        examples: {
          policiesList: 'GET /api/policies',
          policySearch: 'GET /api/search?q=keyword',
          variablesList: 'GET /api/variables',
        },
      },
      note:
        'Use enterprise account access token in Authorization header. Consider issuing service users per system integration.',
    };
  }
}
