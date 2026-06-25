import { Module } from '@nestjs/common';
import { PlatformBrandingService } from './platform-branding.service';
import { PlatformBrandingPublicController } from './platform-branding-public.controller';

@Module({
  controllers: [PlatformBrandingPublicController],
  providers: [PlatformBrandingService],
  exports: [PlatformBrandingService],
})
export class PlatformBrandingModule {}
