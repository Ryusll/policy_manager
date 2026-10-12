#!/usr/bin/env node
// 검사 명령 자동 실행 hook (명령 목록: hooks.config.json의 checks).
//   PostToolUse (Edit·Write·MultiEdit): afterEdit 명령을 실행한다(이 저장소는 비워 둠 — 고치는 중간의 타입 오류가 소음이 된다).
//   Stop: 지난 통과 뒤 이 세션이 코드 파일을 고쳤으면 beforeStop 명령을 실행한다. 실패하면 마무리를 보류한다.
//         명령마다 when(경로 앞부분)이 있으면 그 아래 파일을 고쳤을 때만, {files}는 고친 파일 목록으로 바꿔 실행한다.
//         같은 트리의 다른 세션 변경으로도 실패할 수 있어, 출력에 이 세션의 파일이 보이는지 함께 알린다.
//         stopRetries번 연속 실패하면 멈추고 사용자에게 알린다 (무한 반복 방지).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readInput, projectRoot, loadConfig, isDocFile, statePath, readState, writeState, stopBudget, output,
} from './lib/hook-lib.mjs';
import { readEdits } from './lib/edits.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root);
const passFile = statePath(root, input.session_id, 'checks');
const timeoutSec = cfg.checks.timeoutSec;

const tail = (text, n = 40) => text.trim().split(/\r?\n/).slice(-n).join('\n');
const quote = (p) => `'${p.replace(/'/g, "'\\''")}'`;
const normalize = (c) => (typeof c === 'string' ? { run: c } : c);

// 실행할 명령 목록. changed: 지난 통과 뒤 고친(아직 있는) 파일
function plan(commands, changed) {
  const out = [];
  for (const c of commands.map(normalize)) {
    const scoped = c.when ? changed.filter((f) => c.when.some((w) => f.startsWith(w))) : changed;
    if (!scoped.length) continue;
    if (!c.run.includes('{files}')) {
      out.push(c.run);
      continue;
    }
    const files = c.files ? scoped.filter((f) => c.files.some((ext) => f.endsWith(ext))) : scoped;
    if (files.length) out.push(c.run.replace('{files}', files.map(quote).join(' ')));
  }
  return out;
}

// 명령을 차례로 실행하고 처음 실패한 명령을 돌려준다.
function runChecks(commands) {
  for (const cmd of commands) {
    const r = spawnSync(cmd, {
      cwd: root, shell: true, encoding: 'utf8', timeout: timeoutSec * 1000, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error && r.error.code === 'ETIMEDOUT') return { cmd, code: 'timeout', log: `${timeoutSec}초 안에 끝나지 않았습니다.`, full: '' };
    if (r.status !== 0) {
      const full = `${r.stdout || ''}\n${r.stderr || ''}`;
      return { cmd, code: r.status ?? r.signal, log: tail(full), full };
    }
  }
  return null;
}

function changedSinceLastPass() {
  const passedAt = readState(passFile, {}).passedAt || 0;
  const { files } = readEdits(root, input.session_id);
  return Object.entries(files)
    .filter(([rel, v]) => !isDocFile(rel) && (v.at || 0) > passedAt && fs.existsSync(path.join(root, rel)))
    .map(([rel]) => rel);
}

function whose(fail, changed) {
  const mine = changed.filter((f) => fail.full.includes(f) || fail.full.includes(path.basename(f)));
  return mine.length
    ? `출력에 이 세션이 고친 파일이 보입니다: ${mine.join(', ')}`
    : '출력에 이 세션이 고친 파일이 보이지 않습니다 — 같은 트리의 다른 세션 변경 때문일 수 있습니다. ' +
      '내 변경 때문이 아니면 고치지 말고 그 사실을 사용자에게 보고한 뒤 마치세요.';
}

function afterEdit() {
  const fail = runChecks(cfg.checks.afterEdit.map((c) => normalize(c).run));
  if (fail) {
    output({ decision: 'block', reason: `수정 후 검사 실패: ${fail.cmd} (종료 코드 ${fail.code})\n${fail.log}\n오류를 고친 뒤 계속하세요.` });
  }
}

function atStop() {
  const changed = changedSinceLastPass();
  if (!changed.length || !cfg.checks.beforeStop.length) return;
  const commands = plan(cfg.checks.beforeStop, changed);
  if (!commands.length) return;
  const budget = stopBudget(root, input, 'checks', cfg.stopRetries);
  const startedAt = Date.now();
  const fail = runChecks(commands);
  if (!fail) {
    writeState(passFile, { passedAt: startedAt });
    budget.reset();
    return;
  }
  if (budget.exhausted) {
    budget.reset();
    output({ systemMessage: `마무리 검사가 ${cfg.stopRetries}번 연속 실패해 멈췄습니다. 직접 확인하세요: ${fail.cmd}\n${whose(fail, changed)}` });
    return;
  }
  budget.recordBlock();
  output({
    decision: 'block',
    reason: `마무리 검사 실패: ${fail.cmd} (종료 코드 ${fail.code})\n${fail.log}\n${whose(fail, changed)}\n오류를 고친 뒤 다시 마무리하세요.`,
  });
}

const handlers = { PostToolUse: afterEdit, Stop: atStop };
handlers[input.hook_event_name]?.();
process.exit(0);
