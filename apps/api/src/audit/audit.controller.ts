import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/decorators';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(RolesGuard)
@Roles('admin')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '감사 로그 목록 (관리자)' })
  findAll(@Request() req: any, @Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);
    return this.prisma.auditLog.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }
}
