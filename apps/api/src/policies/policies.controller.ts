import {
  Controller, Get, Post, Put, Delete, Param, Body, Query, Request, HttpCode,
  UseInterceptors, UploadedFile, Res, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { Response } from 'express';
import { PoliciesService } from './policies.service';
import { PolicyPdfService } from './policy-pdf.service';
import { PolicyHwpxService } from './policy-hwpx.service';
import {
  CreatePolicyDto, UpdatePolicyDto,
  CreateChapterDto, UpdateChapterDto,
  CreateSectionDto, UpdateSectionDto,
  CreateArticleDto, UpdateArticleDto,
  CreatePolicyAppendixDto, UpdatePolicyAppendixDto,
  CreatePolicyImportLogDto,
  CreateRevisionReasonDto, UpdateRevisionReasonDto,
  ExportPolicyPdfDto,
  ExportPolicyHwpxDto,
  ReorderArticlesDto,
} from './policies.dto';
import { Roles } from '../common/guards/decorators';
import { AuditService } from '../audit/audit.service';
import {
  UnsafeUploadPathError,
  policyUploadDir,
  policyUploadFilePath,
} from './upload-path';

@ApiTags('policies')
@ApiBearerAuth()
@Controller('policies')
export class PoliciesController {
  constructor(
    private policiesService: PoliciesService,
    private policyPdfService: PolicyPdfService,
    private policyHwpxService: PolicyHwpxService,
    private audit: AuditService,
  ) {}

  /**
   * 경로 조립 실패를 400으로 바꾼다.
   *
   * `UnsafeUploadPathError` 를 그대로 두면 Nest 가 500으로 내보내고, 무엇이 걸렸는지가
   * 스택과 함께 새어 나간다. 잘못 온 요청이지 서버 오류가 아니다.
   */
  private safe<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof UnsafeUploadPathError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Get()
  @ApiOperation({ summary: '규정 목록 조회' })
  findAll(@Request() req: any) {
    return this.policiesService.findAll(req.user.tenantId);
  }

  @Get('hierarchy')
  @ApiOperation({
    summary: '규정 체계도 (상·하위 트리)',
    description: '규정 > 세칙 > 지침 관계를 트리로 돌려준다. 상위가 지워진 규정은 최상위로 올라온다.',
  })
  findHierarchy(@Request() req: any) {
    return this.policiesService.findHierarchy(req.user.tenantId);
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

  @Get(':id/revision-reasons')
  @ApiOperation({ summary: '제정·개정 이유 목록' })
  listRevisionReasons(@Request() req: any, @Param('id') id: string) {
    return this.policiesService.listRevisionReasons(req.user.tenantId, id);
  }

  @Post(':id/revision-reasons')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '제정·개정 이유 추가' })
  createRevisionReason(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateRevisionReasonDto,
  ) {
    return this.policiesService.createRevisionReason(req.user.tenantId, id, dto, req.user.id);
  }

  @Put(':id/revision-reasons/:reasonId')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '제정·개정 이유 수정' })
  updateRevisionReason(
    @Request() req: any,
    @Param('id') id: string,
    @Param('reasonId') reasonId: string,
    @Body() dto: UpdateRevisionReasonDto,
  ) {
    return this.policiesService.updateRevisionReason(
      req.user.tenantId,
      id,
      reasonId,
      dto,
      req.user.id,
    );
  }

  @Delete(':id/revision-reasons/:reasonId')
  @Roles('admin', 'editor')
  @HttpCode(204)
  @ApiOperation({ summary: '제정·개정 이유 삭제' })
  removeRevisionReason(
    @Request() req: any,
    @Param('id') id: string,
    @Param('reasonId') reasonId: string,
  ) {
    return this.policiesService.removeRevisionReason(req.user.tenantId, id, reasonId, req.user.id);
  }

  @Get(':id/three-way')
  @ApiOperation({
    summary: '3단비교 — 규정·세칙·지침을 나란히',
    description:
      '하위 2단계까지 본다. 짝짓기는 하위 조문 본문의 상위 규정 인용("규정 제5조")으로 하며, ' +
      '짝을 못 찾은 조문은 unmatched 로 따로 나온다.',
  })
  threeWay(@Request() req: any, @Param('id') id: string) {
    return this.policiesService.threeWay(req.user.tenantId, id);
  }

  @Get(':id/effective-dates')
  @ApiOperation({ summary: '시점 조회용 — 본문이 바뀐 시행일 목록' })
  listEffectiveDates(@Request() req: any, @Param('id') id: string) {
    return this.policiesService.listEffectiveDates(req.user.tenantId, id);
  }

  @Get(':id/compare')
  @ApiOperation({ summary: '신구조문대비표 — 두 시점의 본문을 조문 단위로 대비' })
  compareAsOf(
    @Request() req: any,
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.policiesService.compareAsOf(req.user.tenantId, id, from, to);
  }

  @Get(':id/as-of')
  @ApiOperation({ summary: '시점 조회 — 기준일에 시행 중이던 본문' })
  findOneAsOf(@Request() req: any, @Param('id') id: string, @Query('date') date: string) {
    return this.policiesService.findOneAsOf(req.user.tenantId, id, date);
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

  @Get(':id/jo-order')
  @ApiOperation({ summary: '조 재정렬 시작점 — 현재 조 차례' })
  listJoOrder(@Request() req: any, @Param('id') id: string) {
    return this.policiesService.listJoOrder(req.user.tenantId, id);
  }

  @Put(':id/jo-order')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '조 순서 일괄 재정렬 · 번호 재부여 (T-60)' })
  reorderArticles(@Request() req: any, @Param('id') id: string, @Body() dto: ReorderArticlesDto) {
    return this.policiesService.reorderArticles(req.user.tenantId, id, dto.order, req.user.id);
  }

  @Post(':id/files')
  @Roles('admin', 'editor')
  @ApiOperation({ summary: '규정 파일 업로드 (PDF, Word, Excel 등)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req: any, file, cb) => {
          // multer 옵션은 DI 밖이라 여기서는 경로만 검증한다. 규정 소유 확인은 핸들러에서.
          try {
            const dir = policyUploadDir(req.user?.tenantId, req.params.id);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            cb(null, dir);
          } catch (e) {
            cb(e as Error, '');
          }
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
  async uploadFile(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new NotFoundException('파일이 없습니다.');
    // multer 는 핸들러보다 먼저 디스크에 쓴다. 소유가 아니면 남기지 않고 지운다.
    try {
      await this.policiesService.findOne(req.user.tenantId, id);
    } catch (e) {
      try { unlinkSync(file.path); } catch { /* 이미 없으면 그만 */ }
      throw e;
    }
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
  async listFiles(@Request() req: any, @Param('id') id: string) {
    await this.policiesService.findOne(req.user.tenantId, id);
    const dir = this.safe(() => policyUploadDir(req.user.tenantId, id));
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

  @Post(':id/export/pdf')
  @HttpCode(200) // 리소스를 만드는 게 아니라 파일을 돌려주므로 201이 아니다
  @ApiOperation({ summary: '전문 PDF 내보내기 (전문 보기 렌더 결과를 그대로 PDF로)' })
  async exportPdf(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ExportPolicyPdfDto,
    @Res() res: Response,
  ) {
    // 테넌트 밖 규정으로 파일명을 만들지 못하도록 먼저 소유 확인
    const policy = await this.policiesService.findOne(req.user.tenantId, id);
    const pdf = await this.policyPdfService.render({
      html: dto.html,
      title: dto.title ?? policy.title,
      metaLine: dto.metaLine,
      footerText: dto.footerText,
      pageNumbers: dto.pageNumbers,
    });

    /**
     * 내보내기를 감사 로그에 남긴다 (T-16).
     *
     * 예전에는 `ExportJob` 테이블이 이 자리를 노렸지만 한 번도 쓰이지 않았다(ADR-0015).
     * 규정 PDF 는 회사 밖으로 나가는 문서라 "누가 언제 무엇을 뽑았나"는 남을 이유가 있고,
     * 그 기록의 자리는 별도 테이블이 아니라 감사 로그다.
     */
    await this.audit.log({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'policy.export.pdf',
      entityType: 'Policy',
      entityId: id,
      details: { code: policy.code, title: policy.title, bytes: pdf.length },
    });

    const base = `${policy.code || 'policy'}_${policy.title || ''}`
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
      .slice(0, 80);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="policy.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`,
    );
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  }

  @Post(':id/export/hwpx')
  @HttpCode(200) // 리소스를 만드는 게 아니라 파일을 돌려준다
  @ApiOperation({
    summary: '전문 HWPX 내보내기 (한/글) — T-85',
    description:
      '`.hwp` 가 아니라 `.hwpx` 다. `.hwp` 는 한컴 독점 바이너리라 서버에서 생성할 수 없고, `.hwpx` 는 같은 한/글이 여는 KS X 6101 표준이다(ADR-0016).',
  })
  async exportHwpx(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ExportPolicyHwpxDto,
    @Res() res: Response,
  ) {
    const policy = await this.policiesService.findOne(req.user.tenantId, id);
    const hwpx = await this.policyHwpxService.render({
      html: dto.html,
      title: dto.title ?? policy.title,
    });

    await this.audit.log({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      action: 'policy.export.hwpx',
      entityType: 'Policy',
      entityId: id,
      details: { code: policy.code, title: policy.title, bytes: hwpx.length },
    });

    const base = `${policy.code || 'policy'}_${policy.title || ''}`
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
      .slice(0, 80);
    res.setHeader('Content-Type', 'application/hwp+zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="policy.hwpx"; filename*=UTF-8''${encodeURIComponent(base)}.hwpx`,
    );
    res.setHeader('Content-Length', String(hwpx.length));
    res.end(hwpx);
  }

  @Get(':id/files/:filename')
  @ApiOperation({ summary: '파일 다운로드' })
  async downloadFile(
    @Request() req: any,
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    await this.policiesService.findOne(req.user.tenantId, id);
    const filePath = this.safe(() => policyUploadFilePath(req.user.tenantId, id, filename));
    if (!existsSync(filePath)) throw new NotFoundException('파일을 찾을 수 없습니다.');
    res.download(filePath, filename.replace(/^\d+-\d+-/, ''));
  }

  @Delete(':id/files/:filename')
  @Roles('admin', 'editor')
  @HttpCode(204)
  @ApiOperation({ summary: '파일 삭제' })
  async deleteFile(
    @Request() req: any,
    @Param('id') id: string,
    @Param('filename') filename: string,
  ) {
    await this.policiesService.findOne(req.user.tenantId, id);
    const filePath = this.safe(() => policyUploadFilePath(req.user.tenantId, id, filename));
    if (!existsSync(filePath)) throw new NotFoundException('파일을 찾을 수 없습니다.');
    unlinkSync(filePath);
  }
}
