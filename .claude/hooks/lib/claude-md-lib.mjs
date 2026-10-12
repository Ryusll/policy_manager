// CLAUDE.md 검사. claude-md-check hook과 테스트가 함께 쓴다.
// CLAUDE.md와 가져오는 파일(@경로)이 실제로 있는 명령·파일·skill만 가리키는지, 크기 기준을 지키는지,
// 공개 저장소에 올리면 안 되는 값(공인 IP·키)이 없는지 본다.
import fs from 'node:fs';
import path from 'node:path';
import { countLines } from './hook-lib.mjs';
import { leakKinds } from './leaks.mjs';

export const CLAUDE_MD = 'CLAUDE.md';
// Claude Code 내장 명령 — skill이 아니어도 적을 수 있다
const BUILTIN = new Set(['hooks', 'agents', 'context', 'doctor', 'clear', 'compact', 'exit', 'config', 'memory',
  'permissions', 'model', 'help', 'init', 'skills', 'status', 'resume', 'cost']);

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

// CLAUDE.md가 가져오는 파일(줄 머리의 @경로)
export function imports(text) {
  return String(text).split('\n').map((l) => l.trim().match(/^@(\S+)$/)).filter(Boolean).map((m) => m[1]);
}

// 코드 표기(`...`) 안에서 뽑은 것: 저장소 경로, npm 스크립트, /skill 호출
function references(text) {
  const refs = { paths: [], scripts: [], skills: [] };
  for (const [, code] of String(text).matchAll(/`([^`\n]+)`/g)) {
    for (const m of code.matchAll(/\bnpm run ([\w:-]+)/g)) refs.scripts.push(m[1]);
    const token = code.trim();
    if (/^\/[a-z][a-z0-9-]+$/.test(token)) refs.skills.push(token.slice(1));
    else if (!/\s|[*<>{}$]|:\/\//.test(token) && /^[\p{L}\p{N}_.@-]+(\/[\p{L}\p{N}_.@ -]+)+\/?$/u.test(token)) {
      refs.paths.push(token);
    }
  }
  for (const [, link] of String(text).matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)) {
    if (!/^[a-z]+:/.test(link)) refs.paths.push(link);
  }
  return refs;
}

// 결과: { problems: [...], warnings: [...] }
export function claudeMdProblems(root, cfg) {
  const problems = [];
  const warnings = [];
  const main = read(path.join(root, CLAUDE_MD));
  if (main === null) return { problems: ['CLAUDE.md가 없습니다'], warnings };
  const docs = [[CLAUDE_MD, main]];
  for (const imp of imports(main)) {
    const text = read(path.join(root, imp));
    if (text === null) problems.push(`가져오는 파일이 없습니다: @${imp}`);
    else docs.push([imp, text]);
  }
  const total = docs.reduce((n, [, t]) => n + countLines(t), 0);
  if (total > cfg.claudeMd.maxLines) {
    problems.push(`CLAUDE.md와 가져오는 파일이 합쳐 ${total}줄입니다 — 기준 ${cfg.claudeMd.maxLines}줄 이하로 줄이세요`);
  }
  const own = countLines(main);
  if (own > cfg.claudeMd.targetLines) {
    warnings.push(`CLAUDE.md가 ${own}줄입니다 — 권장 ${cfg.claudeMd.targetLines}줄 이하. 절차는 skill, 경로별 지침은 rules로 옮기세요`);
  }
  let scripts;
  try {
    scripts = JSON.parse(read(path.join(root, 'package.json')) || '{}').scripts || {};
  } catch {
    scripts = {};
  }
  for (const [name, text] of docs) {
    const refs = references(text);
    for (const s of refs.scripts) if (!scripts[s]) problems.push(`${name}: package.json에 없는 스크립트 npm run ${s}`);
    for (const k of refs.skills) {
      if (!BUILTIN.has(k) && !fs.existsSync(path.join(root, '.claude', 'skills', k, 'SKILL.md'))) {
        problems.push(`${name}: 없는 skill /${k}`);
      }
    }
    const base = name === CLAUDE_MD ? root : path.dirname(path.join(root, name));
    for (const p of refs.paths) {
      const decoded = decodeURI(p);
      const abs = path.resolve(decoded.startsWith('.') ? base : root, decoded);
      if (!fs.existsSync(abs)) problems.push(`${name}: 없는 경로 ${p}`);
    }
    text.split('\n').forEach((line, i) => {
      const kinds = leakKinds(line);
      if (kinds.length) problems.push(`${name}:${i + 1} 공개 저장소에 올리면 안 되는 값(${kinds.join(', ')})`);
      if (/<[가-힣][^>]*>/.test(line)) problems.push(`${name}:${i + 1} 채우지 않은 자리표시가 있습니다`);
    });
  }
  return { problems, warnings };
}
