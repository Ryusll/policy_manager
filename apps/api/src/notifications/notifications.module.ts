import { Module } from '@nestjs/common';
import { NotificationGroupsController } from './notification-groups.controller';
import { NotificationGroupsService } from './notification-groups.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RevisionNotifyService } from './revision-notify.service';

@Module({
  controllers: [NotificationGroupsController, NotificationsController],
  providers: [NotificationGroupsService, NotificationsService, RevisionNotifyService],
  exports: [RevisionNotifyService, NotificationsService],
})
export class NotificationsModule {}
