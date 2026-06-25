import { Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: '내 알림 목록' })
  list(@Request() req: any, @Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 40;
    return this.service.listForUser(req.user.tenantId, req.user.id, Number.isFinite(n) ? n : 40);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '읽지 않은 알림 수' })
  unreadCount(@Request() req: any) {
    return this.service.unreadCount(req.user.tenantId, req.user.id).then((count) => ({ count }));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '알림 읽음 처리' })
  markRead(@Request() req: any, @Param('id') id: string) {
    return this.service.markRead(req.user.tenantId, req.user.id, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: '모든 알림 읽음 처리' })
  markAllRead(@Request() req: any) {
    return this.service.markAllRead(req.user.tenantId, req.user.id);
  }
}
