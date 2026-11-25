// hook 테스트 공용 준비물: 임시 git 저장소(sandbox), 결과 해석 도우미. .claude/hooks의 테스트들이 함께 쓴다.
import { spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const hooksDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const root = path.resolve(hooksDir, '..', '..');
export const LEDGER = 'docs/Deliverables/17_작업관리대장/작업관리대장.md';

export const lines = (n) => Array.from({ length: n }, (_, i) => `// line ${i + 1}`).join('\n') + '\n';
export const decision = (r) => r.json?.hookSpecificOutput?.permissionDecision;
export const reason = (r) => r.json?.hookSpecificOutput?.permissionDecisionReason || r.json?.reason || '';
export const context = (r) => r.json?.hookSpecificOutput?.additionalContext;

export const ledgerText = (rows) => [
  '# 작업 관리 대장',
  '',
  '| ID | 제목 | 우선순위 | 담당 | 완료 정의(DoD) | 출처 | 상태 |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  '| ID | 제목 | 완료일 | 비고 |',
  '|----|------|---|---|',
  '| C-07 | 예전 일 | 2026-07-21 | — |',
  '',
  '| ID | 안건 | 결정 시 영향 | 출처 |',
  '|----|------|------|---|',
  '| D-03 | 결정 | 보류 | — |',
  '',
].join('\n');

// 임시 폴더에 작은 저장소를 만든다. hook은 Claude Code와 같은 형식의 stdin JSON으로 실행한다.
export function sandbox({ config = {}, git = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hooks-')));
  fs.cpSync(hooksDir, path.join(dir, '.claude', 'hooks'), { recursive: true });
  const cfgFile = path.join(dir, '.claude', 'hooks', 'hooks.config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')), ...config }));
  const writeText = (rel, text) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  writeText('package.json', JSON.stringify({ name: 'sandbox', scripts: { test: 'vitest run', typecheck: 'tsc' } }, null, 2) + '\n');
  writeText(LEDGER, ledgerText(['| T-001 | 첫 작업 | P1 | 개발 | 된다 | — | 진행 |']));
  writeText('apps/api/src/app.ts', 'export const app = 1;\n');
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  if (git) {
    g('init', '-q', '-b', 'develop');
    g('config', 'user.email', 'hook@test.local');
    g('config', 'user.name', 'hook test');
    g('config', 'commit.gpgsign', 'false');
    g('add', '.');
    g('commit', '-q', '-m', 'init');
  }
  const sid = `test-${crypto.randomUUID()}`;
  const hook = (name, payload) => {
    const r = spawnSync(process.execPath, [path.join(dir, '.claude', 'hooks', name)], {
      input: JSON.stringify({ session_id: sid, cwd: dir, ...payload }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8',
    });
    let json;
    try { json = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { json = null; }
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  };
  // Claude가 Write·Edit 도구로 고친 것처럼: 파일을 바꾸고 edit-log에 기록한다
  const claudeWrite = (rel, text) => {
    const file = writeText(rel, text);
    hook('edit-log.mjs', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file, content: text } });
    return file;
  };
  const claudeEdit = (rel, oldString, newString) => {
    const file = path.join(dir, rel);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(oldString, newString));
    hook('edit-log.mjs', {
      hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: oldString, new_string: newString },
    });
    return file;
  };
  const bash = (command, event = 'PreToolUse', extra = {}) =>
    hook('git-guard.mjs', { hook_event_name: event, tool_name: 'Bash', tool_input: { command }, ...extra });
  return { dir, sid, hook, g, writeText, claudeWrite, claudeEdit, bash, write: (rel, n) => writeText(rel, lines(n)) };
}
