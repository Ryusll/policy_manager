import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateMyProfileDto, UpdateUserDto } from './users.dto';
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

  // `:id` 보다 먼저 선언해야 `me` 가 사용자 id 로 잡히지 않는다
  @Patch('me')
  @ApiOperation({ summary: '내 정보(이름) 수정 — 모든 역할' })
  updateMe(@Request() req: any, @Body() dto: UpdateMyProfileDto) {
    return this.usersService.updateMe(req.user.tenantId, req.user.id, dto);
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: '같은 기관 사용자 정보(이름·이메일·역할) 수정 (관리자 전용)' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(req.user.tenantId, req.user.id, id, dto);
  }
}
