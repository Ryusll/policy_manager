import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Request,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegulationParseService } from './regulation-parse.service';
import { CommitRegulationParseDto, UpdateRegulationParseTreeDto } from './regulation-parse.dto';
import { Roles } from '../common/guards/decorators';

@ApiTags('regulation-parse')
@ApiBearerAuth()
@Controller('regulation-parse')
export class RegulationParseController {
  constructor(private readonly regulationParseService: RegulationParseService) {}

  @Post('upload')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 PDF 업로드 → 추출·조항 트리 생성' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 },
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const tid = req.user?.tenantId || 'default';
          const dir = join(process.cwd(), 'uploads', tid, 'regulation-parse');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname || '.pdf')}`);
        },
      }),
    }),
  )
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.regulationParseService.uploadAndParse(req.user.tenantId, req.user.id, file);
  }

  @Get(':id')
  @Roles('admin', 'editor', 'viewer')
  @ApiOperation({ summary: '파싱 세션 조회 (트리 미리보기 JSON)' })
  async getOne(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.regulationParseService.findOne(req.user.tenantId, id);
  }

  @Patch(':id/tree')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '파싱 트리 수동 수정 반영' })
  async patchTree(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegulationParseTreeDto,
  ) {
    return this.regulationParseService.updateTree(req.user.tenantId, id, dto);
  }

  @Post(':id/commit')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '현재 트리로 규정(Policy) 생성·커밋' })
  async commit(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommitRegulationParseDto,
  ) {
    return this.regulationParseService.commit(req.user.tenantId, req.user.id, id, dto);
  }
}
