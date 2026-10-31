import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import * as sanitizeHtml from 'sanitize-html';

/** 클라이언트가 보낸 본문 HTML 상한 (A4 수백 쪽 규모까지 허용) */
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 60_000;

export type PolicyPdfRequest = {
  html: string;
  title?: string;
  metaLine?: string;
  footerText?: string;
  pageNumbers?: boolean;
};

/**
 * 전문 보기 HTML → PDF.
 *
 * 렌더 결과 HTML을 클라이언트에서 그대로 받는 이유: 템플릿(기본/HTML)·토큰 치환·절 계층이
 * 모두 프론트의 `buildEnterprisePolicyBodyHtml`에 있어서, 서버가 다시 조립하면 두 벌이 갈라진다.
 * 대신 받은 HTML은 여기서 반드시 sanitize한 뒤 렌더러에 넘긴다.
 */
@Injectable()
export class PolicyPdfService {
  private scriptPath(): string {
    return join(__dirname, '..', '..', 'scripts', 'pdf_render.py');
  }

  /** 렌더러가 이해하는 태그만 남긴다. 스크립트·외부 리소스는 전부 제거. */
  private sanitize(html: string): string {
    return sanitizeHtml(html, {
      allowedTags: [
        'div', 'section', 'article', 'header', 'span', 'p', 'br',
        'h1', 'h2', 'h3', 'h4', 'b', 'strong', 'i', 'em', 'u',
        'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'mark',
      ],
      allowedAttributes: { '*': ['class'] },
      // 이미지·링크·스타일 속성은 PDF 렌더러가 처리하지 못하거나 외부 요청을 유발한다
      allowedSchemes: [],
      disallowedTagsMode: 'discard',
    });
  }

  /**
   * 비동기 spawn을 쓰는 이유: 규정 한 건이 수백 쪽이면 렌더가 수 초 걸린다.
   * `spawnSync`면 그동안 Node 이벤트 루프가 멈춰 다른 테넌트 요청까지 전부 대기한다.
   */
  async render(dto: PolicyPdfRequest): Promise<Buffer> {
    const html = String(dto?.html ?? '');
    if (!html.trim()) {
      throw new BadRequestException('출력할 본문이 없습니다.');
    }
    if (Buffer.byteLength(html, 'utf-8') > MAX_HTML_BYTES) {
      throw new BadRequestException('본문이 너무 큽니다. 장 단위로 나누어 출력해 주세요.');
    }

    const script = this.scriptPath();
    if (!existsSync(script)) {
      throw new InternalServerErrorException(`PDF 렌더러를 찾을 수 없습니다: ${script}`);
    }

    const payload = JSON.stringify({
      html: this.sanitize(html),
      title: String(dto.title ?? '').slice(0, 300),
      metaLine: String(dto.metaLine ?? '').slice(0, 500),
      footerText: String(dto.footerText ?? '').slice(0, 500),
      pageNumbers: dto.pageNumbers !== false,
    });

    const py = process.platform === 'win32' ? 'python' : 'python3';
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(py, [script], {
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new InternalServerErrorException('PDF 생성이 시간 내에 끝나지 않았습니다.'));
      }, RENDER_TIMEOUT_MS);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new InternalServerErrorException(`PDF 렌더러 실행 실패: ${err.message}`));
      };

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', fail);
      // stdin이 닫힌 뒤 쓰면 EPIPE가 뜬다(파이썬이 먼저 죽은 경우)
      child.stdin.on('error', fail);
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const message = Buffer.concat(stderr).toString('utf-8').trim();
          reject(new InternalServerErrorException(message || 'PDF 생성에 실패했습니다.'));
          return;
        }
        resolve(Buffer.concat(stdout));
      });

      child.stdin.end(payload, 'utf-8');
    });

    // %PDF 매직으로 정상 산출물인지 확인 (파이썬이 경고를 stdout에 섞는 경우 방지)
    if (!pdf.length || pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new InternalServerErrorException('PDF 렌더러가 올바른 출력을 반환하지 않았습니다.');
    }
    return pdf;
  }
}
