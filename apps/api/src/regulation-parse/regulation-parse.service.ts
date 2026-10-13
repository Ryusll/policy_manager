import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { AuditService } from '../audit/audit.service';
import { VariablesService } from '../variables/variables.service';
import { formatJo } from '../common/article-label';
import { policyUploadDir } from '../policies/upload-path';
import { buildStoredName, decodeMultipartFilename } from '../policies/upload-name';
import { regulationParseSourcePath } from './regulation-parse-paths';
import { parseDateOnly } from '../common/date-only';
import { lockParseSessionRow } from '../common/row-locks';
import { claimPolicySlots } from '../policies/policy-slots';
import {
  buildRegulationTreeFromLines,
  RegulationArticleNode,
  RegulationParseLine,
} from './regulation-tree.builder';
import { buildCommitPlan } from './commit-rows';
import { buildNewPolicyRecords, insertNewPolicy, newPolicyAudits } from '../policies/new-policy-records';
import type { AuditEntry } from '../audit/audit.service';
import { withoutEffectiveNotes } from '../common/effective-notes';

interface PdfExtractJson {
  ok: boolean;
  engine?: string;
  full_text?: string;
  lines?: RegulationParseLine[];
  error?: string;
  fallback_error?: string;
  fallback_from?: string;
}

/** 원문을 이미 다른 반영·새 규정 등록에 썼다 — 재파싱 반영(T-110)이 원문을 쓸 때와 같은 문구 */
const SESSION_USED_MESSAGE = '이 원문은 이미 다른 반영이나 새 규정 등록에 썼습니다 — 원문을 다시 가져오세요.';
/** 저장 전에 새 규정 첨부 자리로 복사해 둔 원문 PDF(T-135) */
type StagedPdf = { src: string; dest: string; dir: string; storedName: string; fileName: string; size: number };

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
   * 가져온 원문 PDF를 새 규정의 첨부 자리로 **저장 전에** 복사해 둔다(T-135) — 상세 화면의 "원문 PDF"로 바로 보이고, 웹 본문과
   * 나란히 놓고 대조할 수 있다. 규정 id 를 미리 정해 두므로 바로 그 자리에 놓는다(규정 행이 생기기 전에는 첨부 목록·내려받기가 규정을
   * 찾지 못해 보이지 않는다). 복사하지 못하면 확정하지 않는다 — 예전에는 등록만 되고 첨부가 빠진 채 오류를 삼켰다.
   * 원문이 없는 세션(법제처 가져오기, 보관에 실패했거나 오래돼 청소된 원문)은 첨부 없이 등록한다(예전과 같다).
   * 원본은 확정이 끝난 뒤에 지운다 — 저장이 실패하면 이 복사본만 지우고 원본으로 다시 시도한다.
   */
  private stageSourcePdf(
    tenantId: string,
    policyId: string,
    session: { id: string; extractMeta: unknown; fileName: string | null },
  ): StagedPdf | null {
    const src = regulationParseSourcePath(tenantId, (session.extractMeta as { sourceFile?: unknown } | null)?.sourceFile);
    if (!src) return null;
    if (!existsSync(src)) {
      this.log.warn(`원문 PDF가 없어 첨부 없이 등록합니다 [${session.id}]`);
      return null;
    }
    const dir = policyUploadDir(tenantId, policyId);
    const fileName = session.fileName || '원문.pdf';
    const storedName = buildStoredName(fileName);
    const dest = join(dir, storedName);
    try {
      mkdirSync(dir, { recursive: true });
      copyFileSync(src, dest);
      return { src, dest, dir, storedName, fileName, size: statSync(dest).size };
    } catch (e: any) {
      this.log.error(`원문 PDF를 첨부 자리로 복사하지 못했습니다 [${session.id}]: ${e?.message || e}`);
      this.discardStagedPdf({ dest, dir });
      throw new InternalServerErrorException('원문 PDF를 첨부하지 못해 등록하지 않았습니다 — 잠시 뒤 다시 시도하세요.');
    }
  }

  /** 저장하지 못한 확정의 복사본만 지운다(새 규정 자리라 다른 파일은 없다) */
  private discardStagedPdf(pdf: Pick<StagedPdf, 'dest' | 'dir'>) {
    try {
      if (existsSync(pdf.dest)) unlinkSync(pdf.dest);
      if (existsSync(pdf.dir) && !readdirSync(pdf.dir).length) rmdirSync(pdf.dir);
    } catch (e: any) {
      this.log.warn(`복사해 둔 원문 PDF를 지우지 못했습니다 [${pdf.dest}]: ${e?.message || e}`);
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
        parseTree: { ...tree, roots: withoutEffectiveNotes(tree.roots) } as unknown as object,
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
    const roots = withoutEffectiveNotes(assertTree(body.roots));
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

  /**
   * 원문 미리보기로 새 규정을 등록한다 — 규정·장·절·조문·첫 버전·부칙·감사 기록·원문 사용 표시를 **트랜잭션 하나**로(T-135).
   *
   * 예전에는 서비스 함수로 하나씩 저장해 중간에 실패하면 반쪽 규정이 남았고, 같은 원문을 동시에 두 번 확정하면 규정이 둘 생겼다.
   * 이제 무거운 일(트리 변환·검사·행 만들기·원문 PDF 복사)은 밖에서 끝내고, 안에서는 회사 → 원문 세션 순으로 잠근 뒤 다시 보고
   * 넣기만 한다. 회사 잠금 아래에서 플랜 상한·코드 중복을 다시 세므로 다른 경로(새 규정·일괄 등록)와도 마지막 자리를 다투지 않는다.
   */
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
    if (session.committedPolicyId) throw new ConflictException(SESSION_USED_MESSAGE);
    if (session.status !== 'ready' || !session.parseTree) {
      throw new BadRequestException('미리보기가 준비된 세션만 커밋할 수 있습니다.');
    }
    const tree = session.parseTree as { roots?: RegulationArticleNode[] };
    if (!tree.roots?.length) {
      throw new BadRequestException('조항 트리가 비어 있습니다.');
    }

    // 트리를 장·절·조·항·목 구조로 변환한다(T-88·T-89). 예전엔 전부 조로 평탄화했다.
    const plan = buildCommitPlan(tree.roots);
    if (!plan.rows.length) {
      throw new BadRequestException('커밋할 조문이 없습니다.');
    }
    const isLawGoKr = (session.extractMeta as { source?: string } | null)?.source === 'lawgokr';
    const records = buildNewPolicyRecords(plan, {
      tenantId,
      userId,
      code: dto.code,
      title: dto.title,
      description: dto.description?.trim() || preambleAsDescription(plan.preamble, dto.title),
      effective,
      changeNote: isLawGoKr ? '법제처 가져오기 커밋 자동 게시' : 'PDF 파싱 커밋 자동 게시',
      now: new Date(),
    });
    const policyId = records.policy.id;
    const pdf = this.stageSourcePdf(tenantId, policyId, session);
    const audits: AuditEntry[] = [
      ...newPolicyAudits(records, { tenantId, userId, details: { sessionId: id } }),
      ...(pdf
        ? [
            {
              tenantId,
              userId,
              action: 'policy.file.upload',
              entityType: 'Policy',
              entityId: policyId,
              details: { fileName: pdf.fileName, storedName: pdf.storedName, size: pdf.size, source: 'regulation-parse', sessionId: id },
            },
          ]
        : []),
    ];

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await claimPolicySlots(tx, tenantId, [records.policy.code]);
          await lockParseSessionRow(tx, id);
          // 잠근 뒤 다시 본다 — 그 사이 다른 확정·재파싱 반영이 원문을 썼거나 미리보기를 고쳤으면 읽어 둔 트리로 만들지 않는다
          const fresh = await tx.regulationParseSession.findFirst({
            where: { id, tenantId },
            select: { status: true, committedPolicyId: true, parseTree: true },
          });
          if (!fresh) throw new NotFoundException('Parse session not found');
          if (fresh.committedPolicyId || fresh.status === 'committed') throw new ConflictException(SESSION_USED_MESSAGE);
          if (fresh.status !== 'ready' || JSON.stringify(fresh.parseTree) !== JSON.stringify(session.parseTree)) {
            throw new ConflictException('등록하는 사이 원문 미리보기가 바뀌었습니다 — 미리보기를 다시 확인하고 등록하세요.');
          }
          // 바로 시행하는 본문이라 변수 표식이 남아 있으면 안 된다(T-109)
          await this.variables.assertNoMarkers(
            tx,
            tenantId,
            plan.rows.map((r) => ({ label: formatJo(r.number, r.branchNumber ?? null), content: r.content })),
          );

          await insertNewPolicy(tx, records);
          await this.audit.logMany(audits, tx);

          const used = await tx.regulationParseSession.updateMany({
            where: { id, tenantId, status: 'ready', committedPolicyId: null },
            data: { committedPolicyId: policyId, status: 'committed' },
          });
          if (used.count !== 1) throw new ConflictException(SESSION_USED_MESSAGE);
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (e) {
      // 확정 응답만 잃었을 수 있다 — 새 규정이 있으면 저장은 끝난 것이다(복사본을 지우면 그 규정의 원문이 사라진다).
      // 확인조차 못 하면 복사본을 남긴다(지우는 쪽이 더 나쁘다)
      const saved = await this.prisma.policy.findUnique({ where: { id: policyId }, select: { id: true } }).then(
        (row) => !!row,
        () => null,
      );
      if (saved !== true) {
        if (pdf && saved === false) this.discardStagedPdf(pdf);
        throw e;
      }
      this.log.warn(`확정 응답을 잃었지만 저장은 끝났습니다 [${id} → ${policyId}]: ${(e as Error)?.message || e}`);
    }

    if (pdf) {
      try {
        unlinkSync(pdf.src);
      } catch (e: any) {
        // 첨부는 이미 새 자리에 있다 — 남은 원본은 업로드 때 청소(7일)가 지운다
        this.log.warn(`등록한 원문 PDF의 원본을 지우지 못했습니다 [${id}]: ${e?.message || e}`);
      }
    }

    return { policyId, sessionId: id, articleCount: plan.rows.length };
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
