import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { PoliciesService } from '../policies/policies.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { maxPoliciesForPlan } from '../common/plan-limits';
import {
  buildRegulationTreeFromLines,
  RegulationArticleNode,
  RegulationParseLine,
} from './regulation-tree.builder';
import { buildCommitRows } from './commit-rows';

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
  constructor(
    private prisma: PrismaService,
    private policiesService: PoliciesService,
    private lawGoKrService: LawGoKrService,
  ) {}

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
        fileName: file.originalname,
        mimeType: mime,
        status: 'processing',
      },
    });

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
      const extractMeta = {
        engine: extracted.engine,
        fallback_from: extracted.fallback_from,
        line_count: extracted.lines.length,
        full_text_length: (extracted.full_text || '').length,
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
      try {
        unlinkSync(file.path);
      } catch {
        /* ignore */
      }
    }

    return this.prisma.regulationParseSession.findUniqueOrThrow({ where: { id: session.id } });
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
    return this.prisma.regulationParseSession.update({
      where: { id },
      data: {
        parseTree: { roots } as object,
        status: 'ready',
      },
    });
  }

  async commit(
    tenantId: string,
    userId: string,
    id: string,
    dto: { code: string; title: string; description?: string },
  ) {
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

    // 트리를 조·항·목 행으로 변환한다(T-88). 예전엔 전부 조로 평탄화했다.
    const commitRows = buildCommitRows(tree.roots);
    if (!commitRows.length) {
      throw new BadRequestException('커밋할 조문이 없습니다.');
    }
    const isLawGoKr = (session.extractMeta as { source?: string } | null)?.source === 'lawgokr';
    const policy = await this.policiesService.create(
      tenantId,
      {
        code: dto.code.trim(),
        title: dto.title.trim(),
        description: dto.description?.trim(),
      },
      userId,
    );

    const chapter = await this.policiesService.createChapter(
      tenantId,
      policy.id,
      { number: 1, title: '본문', suppressHeader: true },
      userId,
    );

    const changeNote = isLawGoKr ? '법제처 가져오기 커밋 자동 게시' : 'PDF 파싱 커밋 자동 게시';
    for (const row of commitRows) {
      const createdArticle = await this.policiesService.createArticle(tenantId, policy.id, chapter.id, {
        number: row.number,
        title: row.title,
        content: row.content,
        clauseNumber: row.clauseNumber ?? undefined,
        itemNumber: row.itemNumber ?? undefined,
      });
      await this.prisma.articleVersion.updateMany({
        where: { articleId: createdArticle.id, versionNum: 1, status: 'draft' },
        data: {
          status: 'published',
          approvedBy: userId,
          approvedAt: new Date(),
          changeNote,
        },
      });
    }

    await this.prisma.regulationParseSession.update({
      where: { id },
      data: {
        committedPolicyId: policy.id,
        status: 'committed',
      },
    });

    return { policyId: policy.id, sessionId: id, articleCount: commitRows.length };
  }
}
