#!/usr/bin/env node
// 한 작업 트리를 여러 Claude 세션이 함께 쓰는 저장소의 git 사고를 막는다 (스타터 패키지 backlog-guard 자리).
//   PreToolUse (Bash): 메인 트리에서
//     - 남의 변경까지 올리거나 지우는 명령(add -A·commit -a·stash·reset --hard·checkout·restore·clean·rebase·push -f)
//     - 로컬 전용 파일·줄, 공개되면 안 되는 값(공인 IP·키)을 올리는 add·commit
//     - 이 세션이 쓰지 않은 줄이 섞인 add·경로 커밋·인덱스 커밋
//     을 막는다. 연결된 worktree·다른 저장소의 명령, 임시 인덱스(GIT_INDEX_FILE)의 줄 판정은 건드리지 않는다.
//   PostToolUse (Bash): 방금 만든 커밋을 다시 훑어 새어 나간 것이 있으면 push 전에 고치게 하고, 커밋 해시를 기록한다.
import fs from 'node:fs';
import path from 'node:path';
import { readInput, projectRoot, loadConfig, statePath, readState, writeState, run, deny, output } from './lib/hook-lib.mjs';
import { gitCalls, splitArgs, hasShort, COMMIT_VALUE_OPTS } from './lib/git-cmd.mjs';
import { readEdits } from './lib/edits.mjs';
import {
  changedUnder, stagedFiles, diffOf, inspect, describe, isLocalOnly, pathspecFromFile,
} from './lib/git-checks.mjs';
import { scanDiff, describeLeaks } from './lib/leaks.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root);
const command = (input.tool_input || {}).command || '';
const commitsFile = statePath(root, input.session_id, 'commits');

const SHARED = '같은 작업 트리를 다른 Claude 세션도 쓰고 있어, 이 명령은 남의 미커밋 작업까지 바꾸거나 올립니다.';

// 임시 인덱스. 경로를 풀지 못했으면(모르는 변수) 커밋 전 검사는 건너뛰고 커밋 뒤 검사에 맡긴다.
function indexEnv(call) {
  const idx = call.env.GIT_INDEX_FILE;
  if (!idx) return undefined;
  return idx.includes('$') ? { unresolved: true } : { GIT_INDEX_FILE: path.resolve(call.dir, idx) };
}

function checkPaths(call, pathspecs, staged) {
  const env = indexEnv(call);
  if (env?.unresolved) return [];
  const edits = readEdits(root, input.session_id);
  const entries = staged ? stagedFiles(root, env) : changedUnder(root, call.dir, pathspecs, env);
  return entries.map((e) => inspect(root, e, diffOf(root, e, { staged, env }), cfg, edits));
}

function report(call, results) {
  const allowForeign = Boolean(indexEnv(call)) || call.raw.includes(cfg.git.mineOverride);
  return describe(results, { allowForeign, mineOverride: cfg.git.mineOverride });
}

function checkAdd(call) {
  const { opts, paths: listed } = splitArgs(call.args, ['--chmod', '--pathspec-from-file']);
  const paths = [...listed, ...pathspecFromFile(call.dir, opts, call.args)];
  if (opts.some((o) => ['--all', '--update', '-A', '-u'].includes(o)) || hasShort(opts, 'A') || hasShort(opts, 'u')) {
    return `git add ${opts.join(' ')} — ${SHARED} 내 파일 경로를 하나씩 적으세요.`;
  }
  if (paths.some((p) => ['.', ':/', '*', ':(top)'].includes(p) || path.resolve(call.dir, p) === root)) {
    return `git add ${paths.join(' ')} — ${SHARED} 내 파일 경로를 하나씩 적으세요.`;
  }
  if (!paths.length) return null;
  return report(call, checkPaths(call, paths, false));
}

function checkCommit(call) {
  const { opts, paths: listed } = splitArgs(call.args, [...COMMIT_VALUE_OPTS, '--pathspec-from-file']);
  const paths = [...listed, ...pathspecFromFile(call.dir, opts, call.args)];
  if (opts.includes('--all') || hasShort(opts, 'a')) {
    return `git commit -a — ${SHARED} 내 파일만 올린 뒤 커밋하세요.`;
  }
  if (opts.includes('--amend')) {
    const head = run('git', ['rev-parse', 'HEAD'], root).out;
    const mine = readState(commitsFile, { hashes: [] }).hashes;
    if (!mine.some((h) => head.startsWith(h) || h.startsWith(head))) {
      return 'git commit --amend — HEAD 가 이 세션이 만든 커밋이 아닙니다(다른 세션이 그 뒤에 커밋했을 수 있음). 고칠 것은 새 커밋으로 올리세요.';
    }
  }
  if (paths.length) {
    // 경로 커밋(--only)은 그 파일의 작업 트리 전체를 올린다 — 남의 줄이 섞였는지 본다
    const include = opts.includes('--include') || hasShort(opts, 'i');
    const results = checkPaths(call, paths, false);
    return report(call, include ? [...results, ...checkPaths(call, [], true)] : results);
  }
  // 같은 명령 앞쪽에서 이 인덱스를 read-tree 로 새로 만들었으면 지금 인덱스는 커밋될 내용이 아니다 — 커밋 뒤 검사에 맡긴다
  if (call.rebuiltIndex) return null;
  return report(call, checkPaths(call, [], true));
}

function checkReset(call) {
  const { opts, paths, dashdash } = splitArgs(call.args, []);
  if (opts.some((o) => ['--hard', '--merge', '--keep', '--soft'].includes(o))) {
    return `git reset ${opts.join(' ')} — ${SHARED} 인덱스만 맞추려면 git reset -q -- <내 경로> 를 쓰세요. ` +
      '분리된 worktree 에서는 막지 않습니다.';
  }
  const rest = dashdash ? call.args.slice(call.args.indexOf('--') + 1) : paths;
  // 경로가 아니라 커밋(HEAD~1, develop, origin/develop 등)이면 HEAD를 옮기는 reset 이다
  const isCommit = (arg) => !fs.existsSync(path.resolve(call.dir, arg)) && (/^(HEAD|@|[0-9a-f]{7,40})([~^]\d*)+$/.test(arg) ||
    run('git', ['rev-parse', '--verify', '--quiet', `${arg}^{commit}`], call.dir).code === 0);
  const revision = dashdash ? call.args.slice(0, call.args.indexOf('--')).find((a) => !a.startsWith('-')) : paths.find(isCommit);
  if (!rest.length || (revision && revision !== 'HEAD' && isCommit(revision))) {
    return `git reset ${call.args.join(' ')} — 경로 없는 reset 은 다른 세션이 올려 둔 인덱스까지 비웁니다. git reset -q -- <내 경로> 를 쓰세요.`;
  }
  return null;
}

function checkOther(call) {
  const { opts, paths } = splitArgs(call.args, []);
  switch (call.sub) {
    case 'stash':
      return ['list', 'show'].includes(call.args[0]) ? null
        : `git stash — ${SHARED} 내 변경만 잠시 치우려면 git diff <내 파일> > 패치 후 git apply -R 을 쓰세요.`;
    case 'checkout':
    case 'switch':
      return `git ${call.sub} — ${SHARED} 다른 브랜치·커밋이 필요하면 git worktree add <scratchpad 경로> <커밋> 으로 따로 꺼내세요.`;
    case 'restore':
      return opts.some((o) => o === '--staged' || o === '-S') && !opts.some((o) => o === '--worktree' || o === '-W') ? null
        : `git restore ${paths.join(' ')} — 작업 트리의 변경을 버립니다. ${SHARED} 내 hunk 만 되돌리려면 git diff <파일> 로 패치를 만들어 git apply -R 을 쓰세요.`;
    case 'clean':
      return opts.includes('--force') || hasShort(opts, 'f') ? `git clean — ${SHARED} 지울 파일을 하나씩 확인해 rm 하세요.` : null;
    case 'read-tree':
      return call.env.GIT_INDEX_FILE ? null
        : 'git read-tree — 공용 인덱스를 통째로 바꿉니다. 임시 인덱스로 하세요: GIT_INDEX_FILE=<scratchpad 경로> git read-tree HEAD';
    case 'rebase':
      return `git rebase — 메인 트리의 develop 은 다른 세션이 계속 커밋합니다. 이력을 바꾸지 마세요(worktree 에서 하세요).`;
    case 'push':
      return opts.some((o) => o === '--force' || o.startsWith('--force-with-lease') || o === '-f') || hasShort(opts, 'f')
        ? 'git push --force — 공용 브랜치의 이력을 덮어씁니다.' : null;
    default:
      return null;
  }
}

const CHECKS = { add: checkAdd, commit: checkCommit, reset: checkReset };

function beforeBash() {
  const problems = [];
  const rebuilt = new Set();
  for (const call of gitCalls(command, root, input.cwd)) {
    if (!call.mainTree) continue;
    const index = indexEnv(call)?.GIT_INDEX_FILE || 'main';
    if (call.sub === 'read-tree') rebuilt.add(index);
    call.rebuiltIndex = rebuilt.has(index) || (index !== 'main' && !fs.existsSync(index));
    const problem = (CHECKS[call.sub] || checkOther)(call);
    if (problem) problems.push(problem);
  }
  if (problems.length) deny(`git-guard: ${problems.join('\n')}`);
}

// 커밋 출력의 "[develop 1a2b3c4] 제목" 에서 해시를 읽는다.
function afterBash() {
  const resp = input.tool_response || {};
  const stdout = typeof resp === 'string' ? resp : `${resp.stdout || ''}\n${resp.output || ''}`;
  const commitCall = gitCalls(command, root, input.cwd).find((c) => c.sub === 'commit' && c.mainTree);
  const m = stdout.match(/^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\]/m);
  if (!commitCall || !m) return;
  const hash = m[1];
  const state = readState(commitsFile, { hashes: [] });
  writeState(commitsFile, { hashes: [...state.hashes.slice(-50), hash] });
  const files = run('git', ['show', '--name-only', '--format=', hash], root).out.split('\n').filter(Boolean);
  const local = files.filter((f) => isLocalOnly(f, cfg.git.localOnly));
  const leaks = scanDiff(run('git', ['show', '--format=', '--no-color', hash], root, 15000).raw);
  if (!local.length && !leaks.length) return;
  const parts = [`git-guard: 커밋 ${hash} 에 공개 저장소에 올리면 안 되는 것이 들어갔습니다. push 하지 말고 먼저 고치세요.`];
  if (local.length) parts.push(`로컬 전용 파일: ${local.join(', ')}`);
  if (leaks.length) parts.push(describeLeaks(leaks));
  parts.push('HEAD 가 아직 이 커밋이면 git commit --amend 로, 아니면 되돌리는 새 커밋으로 고치고 사용자에게 알리세요.');
  output({ decision: 'block', reason: parts.join('\n') });
}

const handlers = { PreToolUse: beforeBash, PostToolUse: afterBash };
if (input.tool_name === 'Bash') handlers[input.hook_event_name]?.();
process.exit(0);
