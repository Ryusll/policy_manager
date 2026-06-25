import { Body, Controller, Delete, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/guards/decorators';
import { NotificationGroupsService } from './notification-groups.service';
import {
  CreateNotificationGroupDto,
  UpdateNotificationGroupDto,
} from './notifications.dto';

@ApiTags('notification-groups')
@ApiBearerAuth()
@Controller('notification-groups')
export class NotificationGroupsController {
  constructor(private readonly service: NotificationGroupsService) {}

  @Get()
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '알림 수신 팀 목록' })
  list(@Request() req: any) {
    return this.service.list(req.user.tenantId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: '알림 수신 팀 생성' })
  create(@Request() req: any, @Body() dto: CreateNotificationGroupDto) {
    return this.service.create(req.user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: '알림 수신 팀 수정' })
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateNotificationGroupDto,
  ) {
    return this.service.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: '알림 수신 팀 삭제' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.tenantId, id);
  }
}
