import { Module } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { VersionsController } from './versions.controller';
import { VariablesModule } from '../variables/variables.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [VariablesModule, AuditModule, NotificationsModule],
  providers: [VersionsService],
  controllers: [VersionsController],
  exports: [VersionsService],
})
export class VersionsModule {}