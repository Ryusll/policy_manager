// hook 스크립트 공통 기능: 입력 읽기, 설정, 경로 비교, 세션 상태, 출력.
// Claude Code는 hook 입력을 stdin JSON으로 넘기고, stdout JSON으로 결정을 받는다.
// 바이브코딩 스타터 패키지의 hook-lib을 이 저장소에 맞춘 것이다 — backlog.json 대신 작업관리대장,
// 한 작업 트리를 여러 Claude 세션이 함께 쓰는 사정(git-guard)을 다룬다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const DEFAULT_CONFIG = {
  size: {
    maxLines: 300,
    warnRatio: 0.8,
    legacyGrowth: 150,
    include: ['apps/api/src/', 'apps/web/src/', 'scripts/', '.claude/hooks/'],
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.sh'],
    exclude: ['/node_modules/', '/dist/', '/i18n/', '.d.ts'],
  },
  checks: { afterEdit: [], beforeStop: [], timeoutSec: 180 },
  stopRetries: 2,
  git: { protectedBranches: ['main'], localOnly: [], localOnlyLines: [], mineOverride: 'GIT_GUARD_MINE=1' },
  ledger: 'docs/Deliverables/17_작업관리대장/작업관리대장.md',
  migrations: 'apps/api/prisma/migrations/',
  agents: {},
  agentModels: {},
  readNudge: { threshold: 6 },
  doneGate: { requireReview: true, reviewer: 'adversarial-reviewer' },
  rules: { dir: '.claude/rules/', newFile: 'deny' },
  claudeMd: { maxLines: 200, targetLines: 100 },
};

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// 프로젝트 루트: Claude Code가 넘기는 CLAUDE_PROJECT_DIR를 우선하고, 없으면 입력의 cwd.
export function projectRoot(input) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(root) {
  const file = path.join(root, '.claude', 'hooks', 'hooks.config.json');
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  try {
    return merge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    process.stderr.write(`hooks.config.json을 읽지 못해 기본값을 씁니다: ${e.message}\n`);
    return DEFAULT_CONFIG;
  }
}

// 입력 경로를 절대 경로로 바꾼다. 상대 경로는 입력의 cwd 기준.
export function absPath(p, input) {
  if (!p) return null;
  return path.resolve(input.cwd || process.cwd(), p);
}

// 프로젝트 루트 기준 상대 경로(/ 구분). 루트 밖이면 null.
export function relPosix(root, abs) {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  // macOS 파일 이름은 한글이 NFD로 올 수 있다 — 설정의 경로(NFC)와 비교되게 맞춘다
  return rel.split(path.sep).join('/').normalize('NFC');
}

export function isCodeFile(rel, cfg) {
  if (!rel) return false;
  const size = cfg.size;
  const slashed = '/' + rel;
  if (!size.extensions.some((ext) => rel.toLowerCase().endsWith(ext.toLowerCase()))) return false;
  if (size.exclude.some((token) => slashed.includes(token))) return false;
  return size.include.some((dir) => rel.startsWith(dir));
}

// 문서가 아닌 파일 — 검사·검토 대상이 되는 수정
export const isDocFile = (rel) => /\.(md|txt)$/i.test(rel || '');

export function countLines(text) {
  if (!text) return 0;
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// 도구 입력으로 수정 후 파일 내용을 계산한다. 계산할 수 없으면 null (판단 보류).
export function predictText(toolName, toolInput, current) {
  if (toolName === 'Write') return toolInput.content ?? '';
  if (current === null) return null;
  const edits = toolName === 'MultiEdit' ? toolInput.edits || [] : [toolInput];
  let text = current;
  for (const e of edits) {
    if (!e || typeof e.old_string !== 'string' || !text.includes(e.old_string)) return null;
    const next = e.new_string ?? '';
    text = e.replace_all ? text.split(e.old_string).join(next) : text.replace(e.old_string, () => next);
  }
  return text;
}

// 세션별 상태 파일 (OS 임시 폴더). hook마다 이름을 달리해 동시에 써도 겹치지 않게 한다.
export function statePath(root, sessionId, name) {
  const hash = crypto.createHash('sha1').update(root).digest('hex').slice(0, 10);
  const dir = path.join(os.tmpdir(), 'policy-manager-hooks');
  fs.mkdirSync(dir, { recursive: true });
  const sid = String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(dir, `${hash}-${sid}-${name}.json`);
}

export function readState(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// 다른 hook이 같은 파일을 읽는 중일 수 있어 임시 파일에 쓴 뒤 바꿔 넣는다.
export function writeState(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// Stop hook의 무한 반복 방지: 같은 세션에서 연속으로 막은 횟수를 센다.
export function stopBudget(root, input, name, limit) {
  const file = statePath(root, input.session_id, `${name}-stop`);
  const state = readState(file, { blocked: 0 });
  const count = input.stop_hook_active ? state.blocked : 0;
  return {
    exhausted: count >= limit,
    count,
    recordBlock() { writeState(file, { blocked: count + 1 }); },
    reset() { writeState(file, { blocked: 0 }); },
  };
}

export function output(obj) {
  process.stdout.write(JSON.stringify(obj));
}

export function deny(reason) {
  output({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

export function addContext(eventName, text) {
  output({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });
}

export function run(cmd, args, root, timeoutMs = 5000, env = undefined) {
  const r = spawnSync(cmd, args, {
    cwd: root, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: r.status, out: (r.stdout || '').trim(), raw: r.stdout || '', err: (r.stderr || '').trim(), error: r.error };
}

export function gitBranch(root) {
  const r = run('git', ['branch', '--show-current'], root, 3000);
  if (r.code !== 0) return null;
  return r.out || '(detached HEAD)';
}

// HEAD에 있는 파일 내용. 새 파일이거나 git 밖이면 null.
export function headText(root, rel) {
  const r = run('git', ['show', `HEAD:${rel}`], root, 5000);
  return r.code === 0 ? r.raw : null;
}

// ;, &&, ||, |, 줄바꿈으로 구간을 나눈다.
export function shellSegments(command) {
  return String(command || '').split(/\|\||&&|[;|\n]/);
}

// 따옴표를 고려해 단어로 나누고 바깥 따옴표를 뗀다.
export function words(segment) {
  return (segment.trim().match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}
