import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execFileSync, execSync } from 'child_process';
import { join } from 'path';
import { aiQaNotice } from '../apps/api/src/ask/ask-notice';
import { AI_QA_LOG_RETENTION_DAYS } from '../apps/api/src/ask/ask-retention';

/**
 * 보안·증빙 문구 기준표 (T-189) — 영업 자료에 쓸 수 있는 말이 코드·화면 고지와 어긋나지 않게 문서와 코드를 함께 읽는다.
 *
 * 막고 싶은 사고:
 * 1. 고지 문구나 보관 일수를 바꿨는데 기준표·대표용 요약은 옛 약속을 그대로 둔다(표시광고법 실증 책임)
 * 2. 고지 문장 뒤에 고지보다 넓은 말을 덧붙인다
 * 3. 'Zero-Retention'·'변조 불가'·'AES-256'·'Audit Trail' 같은 아직 사실이 아닌 말이 '쓸 수 있는 말'로 들어간다
 * 4. 근거가 빈 행, 없는 파일·이름을 근거로 댄 행이 생긴다
 * 5. 규정 질문 밖에 외부 AI 호출이 생겼는데 'VEDA 는 학습시키지 않습니다'의 근거('외부 AI 는 규정 질문 하나')를 그대로 둔다
 */
const ROOT = join(__dirname, '..');
const DOC = readFileSync(join(ROOT, 'docs', 'Deliverables', '15_보안검토서', '영업_문구_기준표.md'), 'utf8');
const COLUMNS = ['주제', '쓸 수 있는 말', '쓰면 안 되는 말', '풀리는 조건', '근거', '운영', 'develop'];

/** '## 기준표' 아래 첫 표의 행 — 칸 이름으로 */
function claimRows(): Record<string, string>[] {
  const lines = DOC.split('\n');
  const head = lines.findIndex((l) => l.startsWith('| 주제 |'));
  expect(head, '기준표 머리글').toBeGreaterThan(0);
  expect(lines[head].split('|').slice(1, -1).map((c) => c.trim())).toEqual(COLUMNS);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    expect(cells, line.slice(0, 40)).toHaveLength(COLUMNS.length);
    rows.push(Object.fromEntries(COLUMNS.map((k, i) => [k, cells[i]])));
  }
  return rows;
}
const rows = claimRows();
const row = (topic: string) => {
  const r = rows.find((x) => x['주제'] === topic);
  expect(r, topic).toBeDefined();
  return r!;
};
/** 칸이 큰따옴표 한 문장뿐이면 그 문장 — 따옴표 밖에 덧붙인 말이 있으면 null */
const quoteOnly = (cell: string) => cell.match(/^"([^"]+)"$/)?.[1] ?? null;

/** 대표용 한 장 요약의 '지금 써도 되는 말' 번호 목록 */
function summaryItems(): string[] {
  const lines = DOC.split('\n');
  const start = lines.findIndex((l) => l.startsWith('**지금 써도 되는 말**'));
  expect(start, '한 장 요약').toBeGreaterThan(0);
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('**')) break;
    const m = line.match(/^\d+\.\s+(.+)$/);
    if (m) items.push(m[1]);
  }
  return items;
}

const FORBIDDEN = [
  /zero.?retention/i, /무보관/, /무보존/, /\bZDR\b/, /변조\s*(불가|방지)/, /위변조/, /audit\s*trail/i, /자동\s*매핑/, /충돌\s*판정/,
  /무료/, /무제한/, /국내\s*(처리|서버)/, /AES-?256/i, /저장\s*(데이터\s*)?암호화/, /암호화\s*저장/, /열람\s*기록/, /접속\s*기록/, /로그인\s*기록/, /영구\s*보존/,
];

describe('보안·증빙 문구 기준표 (T-189)', () => {
  const notice = aiQaNotice();

  it('고지에 묶인 행의 쓸 수 있는 말은 고지 문장 그대로다 — 따옴표 밖에 고지보다 넓은 말을 덧붙이지 않는다', () => {
    expect(quoteOnly(row('Anthropic 보관')['쓸 수 있는 말'])).toBe(notice.retention[0]);
    expect(quoteOnly(row('VEDA 질문 기록 보관')['쓸 수 있는 말'])).toBe(notice.retention[1]);
    expect(quoteOnly(row('Anthropic 의 AI 학습')['쓸 수 있는 말'])).toBe(notice.training);
    const geo = quoteOnly(row('처리 지역')['쓸 수 있는 말']);
    expect(geo).not.toBeNull();
    expect(notice.country).toContain(geo!);
  });

  it('보관 일수는 표와 대표용 요약 모두 코드 상수·고지와 같고, 백업에는 남는다는 단서를 뺄 수 없다', () => {
    const veda = row('VEDA 질문 기록 보관')['쓸 수 있는 말'];
    expect(veda).toContain(`${AI_QA_LOG_RETENTION_DAYS}일 보관`);
    expect(veda).toContain('백업 보관 기간 동안 남습니다');
    const summary = summaryItems().join(' ');
    expect([...summary.matchAll(/질문 기록은 (\d+)일/g)].map((m) => Number(m[1]))).toEqual([AI_QA_LOG_RETENTION_DAYS]);
    expect(summary).toContain('백업 보관 기간 동안 남습니다');
    const [, days, years] = notice.retention[0].match(/(\d+)일 안에.*최대 (\d+)년/)!;
    expect(summary).toContain(`${days}일 안에`);
    expect(summary).toContain(`최대 ${years}년`);
    // 금지 목록·표 칸까지 문서 어디서든 'VEDA … N일'·'Anthropic … N일'은 상수·고지와 같다(표 칸 경계는 넘지 않는다)
    const vedaDays = [...DOC.matchAll(/VEDA[^.\n|]{0,20}?(\d+)일/g)];
    const anthropicDays = [...DOC.matchAll(/Anthropic[^.\n|]{0,20}?(\d+)일/g)];
    expect(vedaDays.length, 'VEDA N일').toBeGreaterThanOrEqual(2);
    expect(anthropicDays.length, 'Anthropic N일').toBeGreaterThanOrEqual(3);
    for (const m of vedaDays) expect(Number(m[1]), m[0]).toBe(AI_QA_LOG_RETENTION_DAYS);
    for (const m of anthropicDays) expect(m[1], m[0]).toBe(days);
  });

  it("외부 AI 를 부르는 코드는 규정 질문(apps/api/src/ask) 밖에 없다 — 'VEDA 의 AI 학습' 문장의 근거", () => {
    // 알려진 SDK·주소 — 목록에 없는 방법으로 부르는 것까지 막지는 못한다(기준표 '이 표를 지키는 시험')
    const AI_CLIENT = [
      String.raw`@anthropic-ai/`, String.raw`api\.anthropic\.com`, String.raw`^\s*(import|from) (anthropic|openai)([^A-Za-z0-9_]|$)`,
      String.raw`api\.openai\.com`, String.raw`['"]openai['"]`, String.raw`@azure/openai`,
      String.raw`@google/genai`, String.raw`@google/generative-ai`, String.raw`generativelanguage\.googleapis`, 'vertexai',
      'bedrock', String.raw`cohere-ai|cohere\.(ai|com)`, 'mistral', 'langchain', 'ollama', 'huggingface',
    ].join('|');
    const hits = execFileSync('git', ['grep', '-liE', AI_CLIENT, '--', 'apps', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(hits.some((f) => f.startsWith('apps/api/src/ask/')), '규정 질문의 AI 호출').toBe(true);
    expect(hits.filter((f) => !f.startsWith('apps/api/src/ask/') && !f.endsWith('/package.json'))).toEqual([]);
  });

  it("표의 '쓸 수 있는 말'과 대표용 요약의 '지금 써도 되는 말'에는 아직 사실이 아닌 말이 없다", () => {
    const usable = [...rows.map((r) => [`표 ${r['주제']}`, r['쓸 수 있는 말']]), ...summaryItems().map((s, i) => [`요약 ${i + 1}`, s])];
    expect(usable.length).toBeGreaterThanOrEqual(20);
    for (const [where, text] of usable) for (const f of FORBIDDEN) expect(text, `${where} — ${f}`).not.toMatch(f);
    // 금지 목록은 '쓰면 안 되는 말' 칸에 실제로 있다(시험이 빈 표를 통과시키지 않게)
    const banned = rows.map((r) => r['쓰면 안 되는 말']).join(' ');
    for (const f of [/Zero-Retention/, /변조 불가/, /AES-256/, /국내 처리/, /직원 무료/, /열람 기록/, /접속 기록/, /Audit Trail/, /자동 매핑/]) expect(banned).toMatch(f);
  });

  it('모든 행의 근거·풀리는 조건·운영·develop 칸이 채워져 있고, 근거의 파일#이름은 추적 중인 파일 안에 있다', () => {
    expect(rows.length).toBeGreaterThanOrEqual(17);
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const byName = new Map<string, string[]>();
    for (const f of tracked) {
      const base = f.split('/').pop()!;
      byName.set(base, [...(byName.get(base) ?? []), f]);
    }
    let cited = 0;
    for (const r of rows) {
      for (const k of ['근거', '풀리는 조건', '운영', 'develop']) expect(r[k], `${r['주제']} ${k}`).not.toBe('');
      for (const m of r['근거'].matchAll(/`([\w.-]+\.(?:ts|md|py|sh|prisma|js))(?:#([^`]+))?`/g)) {
        const [, file, name] = m;
        const paths = byName.get(file) ?? [];
        expect(paths.length, `${r['주제']} 근거 ${file} — 추적 중인 파일`).toBeGreaterThan(0);
        if (name) expect(paths.some((p) => readFileSync(join(ROOT, p), 'utf8').includes(name)), `${r['주제']} 근거 ${file}#${name}`).toBe(true);
        cited++;
      }
    }
    expect(cited).toBeGreaterThanOrEqual(20);
  });
});
