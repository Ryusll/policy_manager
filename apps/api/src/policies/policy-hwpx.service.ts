import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import * as sanitizeHtml from 'sanitize-html';

/**
 * 전문 보기 HTML → HWPX (T-85).
 *
 * **`.hwp` 가 아니라 `.hwpx` 를 만든다.** `.hwp` 는 한컴의 독점 바이너리라 리눅스
 * 컨테이너에서 생성할 공개 수단이 없다. `.hwpx` 는 같은 한/글이 여는 KS X 6101(OWPML)
 * 표준이고 ZIP+XML 이라 만들 수 있다 — 판단 근거는 ADR-0016.
 *
 * 구조는 PDF(T-76)와 같다: 클라이언트가 렌더한 전문 HTML 을 받아 파이썬으로 변환한다.
 * 템플릿·토큰 치환·절 계층이 모두 프론트에 있어서 서버가 다시 조립하면 두 벌이 갈라진다.
 */

const MAX_HTML_BYTES = 4 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 60_000;

export type PolicyHwpxRequest = {
  html: string;
  title?: string;
};

@Injectable()
export class PolicyHwpxService {
  private scriptPath(): string {
    return join(__dirname, '..', '..', 'scripts', 'hwpx_render.py');
  }

  /** 변환기가 이해하는 태그만 남긴다. PDF 쪽과 같은 목록. */
  private sanitize(html: string): string {
    return sanitizeHtml(html, {
      allowedTags: [
        'div', 'section', 'article', 'header', 'span', 'p', 'br',
        'h1', 'h2', 'h3', 'h4', 'b', 'strong', 'i', 'em', 'u',
        'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'mark',
      ],
      allowedAttributes: { '*': ['class'] },
      allowedSchemes: [],
      disallowedTagsMode: 'discard',
    });
  }

  async render(dto: PolicyHwpxRequest): Promise<Buffer> {
    const html = String(dto?.html ?? '');
    if (!html.trim()) {
      throw new BadRequestException('출력할 본문이 없습니다.');
    }
    if (Buffer.byteLength(html, 'utf-8') > MAX_HTML_BYTES) {
      throw new BadRequestException('본문이 너무 큽니다. 장 단위로 나누어 출력해 주세요.');
    }

    const script = this.scriptPath();
    if (!existsSync(script)) {
      throw new InternalServerErrorException(`HWPX 변환기를 찾을 수 없습니다: ${script}`);
    }

    const payload = JSON.stringify({
      html: this.sanitize(html),
      title: String(dto.title ?? '').slice(0, 300),
    });

    const py = process.platform === 'win32' ? 'python' : 'python3';
    const hwpx = await new Promise<Buffer>((resolve, reject) => {
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
        reject(new InternalServerErrorException('HWPX 생성이 시간 내에 끝나지 않았습니다.'));
      }, RENDER_TIMEOUT_MS);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new InternalServerErrorException(`HWPX 변환기 실행 실패: ${err.message}`));
      };

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const message = Buffer.concat(stderr).toString('utf-8').trim();
          reject(new InternalServerErrorException(message || 'HWPX 생성에 실패했습니다.'));
          return;
        }
        resolve(Buffer.concat(stdout));
      });

      child.stdin.end(payload, 'utf-8');
    });

    // HWPX 는 ZIP 이다. `PK` 매직으로 파이썬이 경고를 stdout 에 섞지 않았는지 확인한다.
    if (!hwpx.length || hwpx.subarray(0, 2).toString('latin1') !== 'PK') {
      throw new InternalServerErrorException('HWPX 변환기가 올바른 출력을 반환하지 않았습니다.');
    }
    return hwpx;
  }
}
