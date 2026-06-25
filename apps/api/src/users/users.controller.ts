import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './users.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/decorators';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '같은 기관 사용자 목록 (알림 수신자 선택용)' })
  list(@Request() req: any) {
    return this.usersService.list(req.user.tenantId);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: '같은 기관에 사용자 계정 생성 (관리자 전용)' })
  create(@Request() req: any, @Body() dto: CreateUserDto) {
    return this.usersService.create(req.user.tenantId, req.user.id, dto);
  }
}
