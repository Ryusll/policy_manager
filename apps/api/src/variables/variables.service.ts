import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateVariableDto, UpdateVariableDto } from './variables.dto';

@Injectable()
export class VariablesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.variable.findMany({
      where: { tenantId },
      include: { _count: { select: { usages: true } } },
      orderBy: { key: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const variable = await this.prisma.variable.findFirst({
      where: { id, tenantId },
      include: {
        usages: {
          include: {
            version: {
              include: { article: { include: { chapter: { include: { policy: true } } } } },
            },
          },
          take: 20,
        },
      },
    });
    if (!variable) throw new NotFoundException('Variable not found');
    return variable;
  }

  async create(tenantId: string, dto: CreateVariableDto) {
    const existing = await this.prisma.variable.findUnique({
      where: { tenantId_key: { tenantId, key: dto.key } },
    });
    if (existing) {
      throw new ConflictException('Variable key ' + dto.key + ' already exists');
    }
    return this.prisma.variable.create({
      data: { tenantId, ...dto },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateVariableDto) {
    await this.findOne(tenantId, id);
    return this.prisma.variable.update({
      where: { id },
      data: dto,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.variable.delete({ where: { id } });
  }

  /**
   * 조문 본문에서 `{{VAR_KEY}}` 패턴을 찾아, 테넌트에 등록된 변수와 매칭되는 variable_usages 를 갱신합니다.
   */
  async syncVariableUsagesFromContent(tenantId: string, versionId: string, content: string) {
    const re = /\{\{([A-Za-z0-9_]+)\}\}/g;
    const keys = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      keys.add(m[1]);
    }
    const keyList = [...keys];
    if (keyList.length === 0) {
      await this.prisma.variableUsage.deleteMany({ where: { versionId } });
      return { synced: 0, keys: keyList };
    }
    const variables = await this.prisma.variable.findMany({
      where: { tenantId, key: { in: keyList } },
    });
    await this.prisma.variableUsage.deleteMany({ where: { versionId } });
    if (variables.length === 0) {
      return { synced: 0, keys: keyList };
    }
    await this.prisma.variableUsage.createMany({
      data: variables.map((v) => ({ versionId, variableId: v.id })),
      skipDuplicates: true,
    });
    return { synced: variables.length, keys: keyList };
  }

  async trackUsage(tenantId: string, versionId: string, variableIds: string[]) {
    const version = await this.prisma.articleVersion.findFirst({
      where: {
        id: versionId,
        article: { chapter: { policy: { tenantId } } },
      },
    });
    if (!version) throw new NotFoundException('Version not found');

    await this.prisma.variableUsage.deleteMany({ where: { versionId } });

    if (variableIds.length > 0) {
      await this.prisma.variableUsage.createMany({
        data: variableIds.map((variableId) => ({ versionId, variableId })),
        skipDuplicates: true,
      });
    }

    return { tracked: variableIds.length };
  }
}