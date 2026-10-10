import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { PoliciesService } from '../policies/policies.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { AuditService } from '../audit/audit.service';
import { VariablesService } from '../variables/variables.service';
import { formatJo } from '../common/article-label';
import { policyUploadDir } from '../policies/upload-path';
import { buildStoredName, decodeMultipartFilename } from '../policies/upload-name';
import { regulationParseSourcePath } from './regulation-parse-paths';
import { maxPoliciesForPlan } from '../common/plan-limits';
import { parseDateOnly } from '../common/date-only';
import {
  buildRegulationTreeFromLines,
  RegulationArticleNode,
  RegulationParseLine,
} from './regulation-tree.builder';
import { buildCommitPlan } from './commit-rows';

interface PdfExtractJson {
  ok: boolean;
  engine?: string;
  full_text?: string;
  lines?: RegulationParseLine[];
  error?: string;
  fallback_error?: string;
  fallback_from?: string;
}

function assertTree(roots: unknown): RegulationArticleNode[] {
  if (!Array.isArray(roots)) {
    throw new BadRequestException('parseTree.roots must be an array');
  }
  const stack: unknown[] = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') throw new BadRequestException('Invalid tree node');
    const o = n as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.articleNumber !== 'string' || typeof o.articleTitle !== 'string') {
      throw new BadRequestException('Tree node missing id, articleNumber, or articleTitle');
    }
    if (typeof o.content !== 'string') throw new BadRequestException('Tree node missing content');
    if (o.children && Array.isArray(o.children)) {
      for (const c of o.children) stack.push(c);
    }
  }
  return roots as RegulationArticleNode[];
}

@Injectable()
export class RegulationParseService {
  private readonly log = new Logger(RegulationParseService.name);

  constructor(
    private prisma: PrismaService,
    private policiesService: PoliciesService,
    private lawGoKrService: LawGoKrService,
    private audit: AuditService,
    private variables: VariablesService,
  ) {}

  /** 등록하지 않고 버려진 세션의 원문 PDF를 지운다(업로드할 때마다 가볍게 청소) */
  private removeStaleSources(dir: string, keepPath: string) {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (path === keepPath || !name.toLowerCase().endsWith('.pdf')) continue;
        if (statSync(path).mtimeMs < weekAgo) unlinkSync(path);
      }
    } catch {
      /* 청소 실패는 업로드를 막지 않는다 */
    }
  }

  private scriptPath(): string {
    return join(__dirname, '..', '..', 'scripts', 'pdf_extract.py');
  }

  private runPythonExtract(absPdfPath: string): PdfExtractJson {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const script = this.scriptPath();
    if (!existsSync(script)) {
      return { ok: false, error: `Extractor script not found: ${script}` };
    }
    const r = spawnSync(py, [script, absPdfPath], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    if (r.error) {
      return { ok: false, error: `Python 실행 실패: ${r.error.message}` };
    }
    const raw = (r.stdout || '').trim();
    if (!raw) {
      return { ok: false, error: r.stderr || '추출기가 출력을 반환하지 않았습니다.' };
    }
    try {
      const parsed = JSON.parse(raw) as PdfExtractJson;
      return parsed;
    } catch {
      return { ok: false, error: '추출기 JSON 파싱 실패' };
    }
  }

  async uploadAndParse(
    tenantId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.path) {
      throw new BadRequestException('파일이 없습니다.');
    }
    const mime = file.mimetype || 'application/octet-stream';
    if (!mime.includes('pdf') && !file.originalname.toLowerCase().endsWith('.pdf')) {
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
      throw new BadRequestException('PDF 파일만 업로드할 수 있습니다.');
    }

    const session = await this.prisma.regulationParseSession.create({
      data: {
        tenantId,
        userId,
        // multer 는 한글 파일명을 latin1 로 읽는다 — 그대로 두면 미리보기·원문 첨부 이름이 깨진다
        fileName: decodeMultipartFilename(file.originalname),
        mimeType: mime,
        status: 'processing',
      },
    });
    this.removeStaleSources(dirname(file.path), file.path);
    // 파싱에 성공하면 원문을 지우지 않고 세션 이름으로 보관했다가, 규정을 등록할 때 첨부파일로 옮긴다
    let keptSource = false;

    try {
      const extracted = this.runPythonExtract(file.path);
      if (!extracted.ok || !extracted.lines) {
        const msg =
          extracted.error ||
          extracted.fallback_error ||
          'PDF 텍스트 추출에 실패했습니다.';
        await this.prisma.regulationParseSession.update({
          where: { id: session.id },
          data: {
            status: 'failed',
            errorMessage: msg,
            extractMeta: {
              engine: extracted.engine,
              fallback_from: extracted.fallback_from,
            } as object,
          },
        });
        return this.prisma.regulationParseSession.findUniqueOrThrow({ where: { id: session.id } });
      }

      const { roots } = buildRegulationTreeFromLines(extracted.lines);
      let sourceFile: string | undefined;
      try {
        sourceFile = `${session.id}.pdf`;
        renameSync(file.path, join(dirname(file.path), sourceFile));
        keptSource = true;
      } catch (e: any) {
        sourceFile = undefined;
        this.log.warn(`원문 PDF를 보관하지 못했습니다 [${session.id}]: ${e?.message || e}`);
      }
      const extractMeta = {
        engine: extracted.engine,
        fallback_from: extracted.fallback_from,
        line_count: extracted.lines.length,
        full_text_length: (extracted.full_text || '').length,
        ...(sourceFile ? { sourceFile } : {}),
      };

      await this.prisma.regulationParseSession.update({
        where: { id: session.id },
        data: {
          status: 'ready',
          extractedText: extracted.full_text ?? null,
          extractMeta: extractMeta as object,
          parseTree: { roots } as object,
          errorMessage: null,
        },
      });
    } catch (e: any) {
      await this.prisma.regulationParseSession.update({
        where: { id: session.id },
        data: {
          status: 'failed',
          errorMessage: e?.message || String(e),
        },
      });
    } finally {
      if (!keptSource) {
        try {
          unlinkSync(file.path);
        } catch {
          /* ignore */
        }
      }
    }

    return this.prisma.regulationParseSession.findUniqueOrThrow({ where: { id: session.id } });
  }

  /**
   * 가져온 원문 PDF를 규정 첨부파일로 옮긴다 — 상세 화면의 "원문 PDF"로 바로 보이고,
   * 웹 본문과 나란히 놓고 대조할 수 있다. 실패해도 규정 등록은 그대로 둔다(첨부는 나중에 올릴 수 있다).
   */
  private async attachSourcePdf(
    tenantId: string,
    userId: string,
    policyId: string,
    sourceFile: unknown,
    fileName: string | null,
  ) {
    const src = regulationParseSourcePath(tenantId, sourceFile);
    if (!src || !existsSync(src)) return;
    try {
      const dir = policyUploadDir(tenantId, policyId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const storedName = buildStoredName(fileName || '원문.pdf');
      copyFileSync(src, join(dir, storedName));
      const size = statSync(src).size;
      unlinkSync(src);
      await this.audit.log({
        tenantId,
        userId,
        action: 'policy.file.upload',
        entityType: 'Policy',
        entityId: policyId,
        details: { fileName: fileName || '원문.pdf', storedName, size, source: 'regulation-parse' },
      });
    } catch (e: any) {
      this.log.warn(`원문 PDF를 첨부하지 못했습니다 [${policyId}]: ${e?.message || e}`);
    }
  }

  /**
   * 법제처 법령 본문으로 파싱 세션을 만든다 (T-55).
   *
   * 업로드 경로와 **같은 세션**을 만드는 것이 요점이다. 그래야 미리보기·수동수정
   * (`PATCH :id/tree`)·커밋(`POST :id/commit`)을 그대로 재사용하고, 화면도 한 벌로 끝난다.
   * 법제처 매퍼가 내보내는 `tree.roots`는 PDF 파서와 동일한 `RegulationArticleNode` 형식이다.
   *
   * 서지사항(법령ID·공포일자·시행일자·원문링크·제개정이유)은 `extractMeta`에 남긴다.
   * 커밋 시점에 규정 메타로 옮겨쓸 수 있고, 나중에 출처를 되짚을 때도 필요하다.
   */
  async createFromLawGoKr(tenantId: string, userId: string, mst: string) {
    const { meta, tree } = await this.lawGoKrService.getLaw(mst);
    if (!tree.roots.length) {
      throw new BadRequestException(
        `법제처 응답에 조문이 없습니다 (${meta.title}). 다른 법령을 선택해 주세요.`,
      );
    }

    return this.prisma.regulationParseSession.create({
      data: {
        tenantId,
        userId,
        // 업로드가 아니므로 확장자를 붙이지 않는다. 목록에서 출처가 바로 읽히도록 법령명을 쓴다.
        fileName: meta.title,
        mimeType: 'application/vnd.lawgokr+json',
        status: 'ready',
        parseTree: tree as unknown as object,
        extractMeta: { source: 'lawgokr', ...meta } as unknown as object,
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const row = await this.prisma.regulationParseSession.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Parse session not found');
    return row;
  }

  async updateTree(tenantId: string, id: string, body: { roots: unknown[] }) {
    const row = await this.findOne(tenantId, id);
    if (row.committedPolicyId) {
      throw new BadRequestException('커밋된 세션의 트리는 수정할 수 없습니다.');
    }
    const roots = assertTree(body.roots);
    // 조건부로 고친다(T-131) — 확인한 뒤 반영·등록이 원문을 쓰면 고치지 않는다(쓴 원문의 트리가 바뀌면 반영한 묶음과 어긋난다)
    const changed = await this.prisma.regulationParseSession.updateMany({
      where: { id, tenantId, committedPolicyId: null, status: { not: 'committed' } },
      data: {
        parseTree: { roots } as object,
        status: 'ready',
      },
    });
    if (changed.count !== 1) throw new ConflictException('이 원문은 그 사이 반영이나 새 규정 등록에 썼습니다 — 원문을 다시 가져오세요.');
    return this.prisma.regulationParseSession.findUniqueOrThrow({ where: { id } });
  }

  async commit(
    tenantId: string,
    userId: string,
    id: string,
    dto: { code: string; title: string; description?: string; effectiveDate: string },
  ) {
    // 무엇이든 만들기 전에 본다 — 규정만 생기고 조문이 안 들어가는 반쪽 상태를 피한다
    const effective = parseDateOnly(dto.effectiveDate);
    if (!effective) {
      throw new BadRequestException('시행일(YYYY-MM-DD)을 입력하세요 — 가져오는 본문이 시행된 날짜입니다.');
    }
    const session = await this.findOne(tenantId, id);
    if (session.committedPolicyId) {
      throw new BadRequestException('이미 커밋된 세션입니다.');
    }
    if (session.status !== 'ready' || !session.parseTree) {
      throw new BadRequestException('미리보기가 준비된 세션만 커밋할 수 있습니다.');
    }
    const tree = session.parseTree as { roots?: RegulationArticleNode[] };
    if (!tree.roots?.length) {
      throw new BadRequestException('조항 트리가 비어 있습니다.');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const count = await this.prisma.policy.count({ where: { tenantId } });
    const max = maxPoliciesForPlan(tenant.plan);
    if (count >= max) {
      throw new ForbiddenException(
        `현재 플랜(${tenant.plan})에서 등록 가능한 규정은 최대 ${max}건입니다.`,
      );
    }

    // 트리를 장·절·조·항·목 구조로 변환한다(T-88·T-89). 예전엔 전부 조로 평탄화했다.
    const plan = buildCommitPlan(tree.roots);
    if (!plan.rows.length) {
      throw new BadRequestException('커밋할 조문이 없습니다.');
    }
    // 바로 시행하는 본문이라 변수 표식이 남아 있으면 안 된다(T-109)
    await this.variables.assertNoMarkers(
      this.prisma,
      tenantId,
      plan.rows.map((r) => ({ label: formatJo(r.number, r.branchNumber ?? null), content: r.content })),
    );
    const isLawGoKr = (session.extractMeta as { source?: string } | null)?.source === 'lawgokr';
    const policy = await this.policiesService.create(
      tenantId,
      {
        code: dto.code.trim(),
        title: dto.title.trim(),
        description: dto.description?.trim() || preambleAsDescription(plan.preamble, dto.title),
      },
      userId,
    );
    // 새 규정이라 규정 단위 시행일은 비어 있다 — 가져오기 시행일로 채운다
    await this.prisma.policy.update({ where: { id: policy.id }, data: { effectiveDate: effective } });

    // 원문의 장·절을 실제 Chapter/Section 으로 만든다. 장 표기가 없는 문서면
    // buildCommitPlan 이 숨김 장 한 개(`본문`)만 넣어 주므로 예전과 같은 결과가 된다.
    const chapterIds: string[] = [];
    const sectionIds: (string | null)[][] = [];
    for (const ch of plan.chapters) {
      const created = await this.policiesService.createChapter(
        tenantId,
        policy.id,
        { number: ch.number, title: ch.title, suppressHeader: ch.suppressHeader },
        userId,
      );
      chapterIds.push(created.id);
      const ids: (string | null)[] = [];
      for (const sec of ch.sections) {
        const createdSection = await this.policiesService.createSection(
          tenantId,
          policy.id,
          created.id,
          { number: sec.number, title: sec.title },
          userId,
        );
        ids.push(createdSection.id);
      }
      sectionIds.push(ids);
    }

    const changeNote = isLawGoKr ? '법제처 가져오기 커밋 자동 게시' : 'PDF 파싱 커밋 자동 게시';
    for (const row of plan.rows) {
      const chapterId = chapterIds[row.chapterIndex];
      const sectionId =
        row.sectionIndex == null ? undefined : sectionIds[row.chapterIndex]?.[row.sectionIndex] ?? undefined;
      const createdArticle = await this.policiesService.createArticle(tenantId, policy.id, chapterId, {
        number: row.number,
        ...(row.branchNumber ? { branchNumber: row.branchNumber } : {}),
        title: row.title,
        content: row.content,
        clauseNumber: row.clauseNumber ?? undefined,
        itemNumber: row.itemNumber ?? undefined,
        sectionId: sectionId ?? undefined,
      });
      await this.prisma.articleVersion.updateMany({
        where: { articleId: createdArticle.id, versionNum: 1, status: 'draft' },
        data: {
          status: 'published',
          approvedBy: userId,
          approvedAt: new Date(),
          publishedAt: new Date(), // 발행일(T-108) — 시행일과 다르다
          effectiveDate: effective,
          changeNote,
        },
      });
    }

    // 부칙·별표·서식은 조문이 아니라 규정의 부칙·별표 탭으로 보낸다
    for (const [sortOrder, appendix] of plan.appendices.entries()) {
      await this.policiesService.createAppendix(tenantId, policy.id, {
        kind: appendix.kind,
        title: appendix.title.slice(0, 200),
        body: appendix.body,
        sortOrder,
      });
    }

    await this.attachSourcePdf(
      tenantId,
      userId,
      policy.id,
      (session.extractMeta as { sourceFile?: unknown } | null)?.sourceFile,
      session.fileName,
    );

    await this.prisma.regulationParseSession.update({
      where: { id },
      data: {
        committedPolicyId: policy.id,
        status: 'committed',
      },
    });

    return { policyId: policy.id, sessionId: id, articleCount: plan.rows.length };
  }
}

/**
 * 첫 조 앞의 글을 규정 설명으로 쓴다. 문서 제목만 있는 흔한 경우(규정명과 같다)는 버린다 —
 * 설명 칸에 규정명이 한 번 더 들어가 봐야 쓸모가 없다.
 */
function preambleAsDescription(preamble: string, title: string): string | undefined {
  const squash = (s: string) => s.replace(/\s+/g, '');
  const seen = new Set([squash(title)]);
  const lines = preamble
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || seen.has(squash(l))) return false;
      seen.add(squash(l));
      return true;
    });
  return lines.length ? lines.join('\n').slice(0, 2000) : undefined;
}
