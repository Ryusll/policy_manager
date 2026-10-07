import { Body, Controller, Get, HttpCode, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  ResetPasswordDto,
  UpdateMyProfileDto,
  UpdateUserDto,
} from './users.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { AllowDuringPasswordChange, Roles } from '../common/guards/decorators';

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

  // `:id/password` 보다 먼저 선언해야 `me` 가 사용자 id 로 잡히지 않는다.
  // 비밀번호 변경이 필요한 사용자가 쓸 수 있는 몇 안 되는 경로다(T-122)
  @AllowDuringPasswordChange()
  @Post('me/password')
  @HttpCode(200)
  @ApiOperation({ summary: '내 비밀번호 변경 — 현재 비밀번호 필요, 모든 역할' })
  changeMyPassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeMyPassword(req.user.tenantId, req.user.id, dto);
  }

  @Post(':id/password')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({ summary: '같은 기관 사용자의 비밀번호 재설정 (관리자 전용, 본인 제외)' })
  resetPassword(@Request() req: any, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(req.user.tenantId, req.user.id, id, dto);
  }
}
