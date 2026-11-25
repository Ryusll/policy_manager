#!/usr/bin/env node
// 상태바 (settings.json의 statusLine): 모델, git 브랜치, 미커밋 파일 수, 작업관리대장의 다음 번호를 한 줄로 보여준다.
// Claude Code가 새 응답이 올 때마다 다시 실행하므로, 다른 세션이 대장에 번호를 쓰면 다음 응답부터 반영된다.
import path from 'node:path';
import { readInput, loadConfig, run, readText, gitBranch } from './lib/hook-lib.mjs';
import { nextIds } from './lib/ledger.mjs';

const input = await readInput();
const workspace = input.workspace || {};
const root = path.resolve(workspace.project_dir || process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const cfg = loadConfig(root);
const paint = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const parts = [];

if (input.model && input.model.display_name) parts.push(paint('2', input.model.display_name));

const branch = gitBranch(root);
if (branch) {
  parts.push(`git ${branch}`);
  const dirty = run('git', ['status', '--porcelain'], root, 3000).raw.split('\n').filter(Boolean).length;
  if (dirty) parts.push(paint('33', `미커밋 ${dirty}`));
}

const ledger = readText(path.join(root, cfg.ledger));
if (ledger !== null) {
  const ids = nextIds(ledger);
  parts.push(paint('36', `다음 ${ids.T} · ${ids.C} · ${ids.D}`));
}

process.stdout.write(parts.join(' │ ') + '\n');
