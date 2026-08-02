import {
  Controller, Get, Post, Put, Delete, Param, Body, Request, HttpCode,
  UseInterceptors, UploadedFile, Res, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Response } from 'express';
import { PoliciesService } from './policies.service';
import {
  CreatePolicyDto, UpdatePolicyDto,
  CreateChapterDto, UpdateChapterDto,
  CreateSectionDto, UpdateSectionDto,
  CreateArticleDto, UpdateArticleDto,
  CreatePolicyAppendixDto, UpdatePolicyAppendixDto,
  CreatePolicyImportLogDto,
} from './policies.dto';
import { Roles } from '../common/guards/decorators';

@ApiTags('policies')
@ApiBearerAuth()
@Controller('policies')
export class PoliciesController {
  constructor(private policiesService: PoliciesService) {}

  @Get()
  @ApiOperation({ summary: '규정 목록 조회' })
  findAll(@Request() req: any) {
    return this.policiesService.findAll(req.user.tenantId);
  }

  @Get('import-logs')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 가져오기 이력 조회' })
  listImportLogs(@Request() req: any) {
    return this.policiesService.listImportLogs(req.user.tenantId);
  }

  @Post('import-logs')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 가져오기 이력 기록' })
  createImportLog(@Request() req: any, @Body() dto: CreatePolicyImportLogDto) {
    return this.policiesService.createImportLog(req.user.tenantId, req.user.id, dto);
  }

  @Post(':id/appendices')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '부칙·별표·서식 추가' })
  createAppendix(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreatePolicyAppendixDto,
  ) {
    return this.policiesService.createAppendix(req.user.tenantId, id, dto);
  }

  @Put(':id/appendices/:appendixId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '부칙·별표·서식 수정' })
  updateAppendix(
    @Request() req: any,
    @Param('id') id: string,
    @Param('appendixId') appendixId: string,
    @Body() dto: UpdatePolicyAppendixDto,
  ) {
    return this.policiesService.updateAppendix(req.user.tenantId, id, appendixId, dto);
  }

  @Delete(':id/appendices/:appendixId')
  @Roles('admin', 'editor')
  @HttpCode(204)
  @ApiOperation({ summary: '부칙·별표·서식 삭제' })
  removeAppendix(
    @Request() req: any,
    @Param('id') id: string,
    @Param('appendixId') appendixId: string,
  ) {
    return this.policiesService.removeAppendix(req.user.tenantId, id, appendixId);
  }

  @Get(':id')
  @ApiOperation({ summary: '규정 상세 조회 (전체 구조)' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.policiesService.findOne(req.user.tenantId, id);
  }

  @Post()
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 생성' })
  create(@Request() req: any, @Body() dto: CreatePolicyDto) {
    return this.policiesService.create(req.user.tenantId, dto, req.user.id);
  }

  @Put(':id')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 수정' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdatePolicyDto) {
    return this.policiesService.update(req.user.tenantId, id, dto, req.user.id);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: '규정 삭제' })
  remove(@Request() req: any, @Param('id') id: string) {
    return this.policiesService.remove(req.user.tenantId, id, req.user.id);
  }

  @Post(':id/chapters')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '장 추가' })
  createChapter(@Request() req: any, @Param('id') id: string, @Body() dto: CreateChapterDto) {
    return this.policiesService.createChapter(req.user.tenantId, id, dto, req.user.id);
  }

  @Put(':id/chapters/:chapterId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '장 수정' })
  updateChapter(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Body() dto: UpdateChapterDto,
  ) {
    return this.policiesService.updateChapter(req.user.tenantId, id, chapterId, dto);
  }

  @Delete(':id/chapters/:chapterId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: '장 삭제' })
  removeChapter(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
  ) {
    return this.policiesService.removeChapter(req.user.tenantId, id, chapterId);
  }

  @Post(':id/chapters/:chapterId/sections')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '절 추가 (선택 계층)' })
  createSection(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Body() dto: CreateSectionDto,
  ) {
    return this.policiesService.createSection(req.user.tenantId, id, chapterId, dto, req.user.id);
  }

  @Put(':id/chapters/:chapterId/sections/:sectionId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '절 수정' })
  updateSection(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.policiesService.updateSection(req.user.tenantId, id, chapterId, sectionId, dto);
  }

  @Delete(':id/chapters/:chapterId/sections/:sectionId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: '절 삭제 (소속 조문은 보존되고 절 연결만 해제)' })
  removeSection(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.policiesService.removeSection(req.user.tenantId, id, chapterId, sectionId);
  }

  @Post(':id/chapters/:chapterId/articles')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '조문 추가' })
  createArticle(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Body() dto: CreateArticleDto,
  ) {
    return this.policiesService.createArticle(req.user.tenantId, id, chapterId, dto);
  }

  @Put(':id/chapters/:chapterId/articles/:articleId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '조문 수정' })
  updateArticle(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Param('articleId') articleId: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.policiesService.updateArticle(req.user.tenantId, id, chapterId, articleId, dto);
  }

  @Delete(':id/chapters/:chapterId/articles/:articleId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: '조문 삭제' })
  removeArticle(
    @Request() req: any,
    @Param('id') id: string,
    @Param('chapterId') chapterId: string,
    @Param('articleId') articleId: string,
  ) {
    return this.policiesService.removeArticle(req.user.tenantId, id, chapterId, articleId);
  }

  /* ───── 파일 업로드 ───── */

  @Post(':id/files')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 파일 업로드 (PDF, Word, Excel 등)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req: any, file, cb) => {
          const dir = join('/app/uploads', req.user?.tenantId || 'default', req.params.id);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
          cb(null, unique + extname(file.originalname));
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
      fileFilter: (req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/png', 'image/jpeg',
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('지원하지 않는 파일 형식입니다.'), false);
        }
      },
    }),
  )
  uploadFile(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new NotFoundException('파일이 없습니다.');
    return {
      id: file.filename,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      url: `/api/policies/${id}/files/${file.filename}`,
      uploadedAt: new Date().toISOString(),
    };
  }

  @Get(':id/files')
  @ApiOperation({ summary: '규정 파일 목록 조회' })
  listFiles(@Request() req: any, @Param('id') id: string) {
    const { readdirSync, statSync } = require('fs');
    const dir = join('/app/uploads', req.user.tenantId, id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).map((filename: string) => {
      const stat = statSync(join(dir, filename));
      return {
        id: filename,
        originalName: filename.replace(/^\d+-\d+-/, ''),
        size: stat.size,
        url: `/api/policies/${id}/files/${filename}`,
        uploadedAt: stat.birthtime,
      };
    });
  }

  @Get(':id/files/:filename')
  @ApiOperation({ summary: '파일 다운로드' })
  downloadFile(
    @Request() req: any,
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = join('/app/uploads', req.user.tenantId, id, filename);
    if (!existsSync(filePath)) throw new NotFoundException('파일을 찾을 수 없습니다.');
    res.download(filePath, filename.replace(/^\d+-\d+-/, ''));
  }

  @Delete(':id/files/:filename')
  @Roles('admin', 'editor')
  @HttpCode(204)
  @ApiOperation({ summary: '파일 삭제' })
  deleteFile(
    @Request() req: any,
    @Param('id') id: string,
    @Param('filename') filename: string,
  ) {
    const { unlinkSync } = require('fs');
    const filePath = join('/app/uploads', req.user.tenantId, id, filename);
    if (!existsSync(filePath)) throw new NotFoundException('파일을 찾을 수 없습니다.');
    unlinkSync(filePath);
  }
}
