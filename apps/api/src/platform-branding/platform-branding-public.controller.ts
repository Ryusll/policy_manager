import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/guards/decorators';
import { PlatformBrandingService } from './platform-branding.service';

@ApiTags('platform-branding')
@Controller('platform-branding')
export class PlatformBrandingPublicController {
  constructor(private readonly branding: PlatformBrandingService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '서비스 운영사 푸터·로고(비로그인 공개)' })
  get() {
    return this.branding.getPublic();
  }
}
