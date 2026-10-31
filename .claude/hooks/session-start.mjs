#!/usr/bin/env node
// SessionStart hook: 브랜치, 미커밋 변경, 작업관리대장의 다음 번호, 최근 마이그레이션을 Claude의 컨텍스트에 넣는다.
// 같은 트리를 여러 세션이 쓰므로 "이 변경이 내 것이 아닐 수 있다"는 것과 번호·마이그레이션 이름 충돌을 먼저 알린다.
import fs from 'node:fs';
import path from 'node:path';
import { readInput, projectRoot, loadConfig, run, readText, addContext, gitBranch } from './lib/hook-lib.mjs';
import { nextIds } from './lib/ledger.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root);
const lines = ['[프로젝트 상태 · session-start hook]'];

const branch = gitBranch(root);
if (branch === null) {
  lines.push('- git: 저장소가 아니거나 git이 없습니다.');
} else {
  lines.push(`- git 브랜치: ${branch}`);
  if (cfg.git.protectedBranches.includes(branch)) {
    lines.push(`- 주의: ${branch}에서 작업 중입니다. 이 저장소는 develop 단일 운영입니다 — 사용자에게 확인하세요.`);
  }
  const status = run('git', ['status', '--porcelain'], root, 8000).raw.split('\n').filter(Boolean);
  const untracked = status.filter((l) => l.startsWith('??')).length;
  if (status.length) {
    lines.push(`- 미커밋 변경: 수정 ${status.length - untracked} · 새 파일 ${untracked}. 다른 세션의 작업일 수 있습니다 — ` +
      '내가 고친 파일·줄만 커밋합니다(git-guard가 검사).');
  }
}

const ledger = readText(path.join(root, cfg.ledger));
if (ledger !== null) {
  const ids = nextIds(ledger);
  lines.push(`- 작업관리대장 다음 번호: ${ids.T} · ${ids.C} · ${ids.D} (다른 세션도 쓰므로 쓰기 직전에 다시 확인)`);
}

try {
  const dirs = fs.readdirSync(path.join(root, cfg.migrations)).filter((d) => /^\d{14}_/.test(d)).sort();
  if (dirs.length) lines.push(`- 최근 마이그레이션: ${dirs[dirs.length - 1]} (새 이름은 이보다 뒤 시각으로, 다른 세션 것과 겹치지 않게)`);
} catch {
  // 마이그레이션 폴더가 없으면 알릴 것이 없다
}

addContext('SessionStart', lines.join('\n'));
process.exit(0);
