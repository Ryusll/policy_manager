// git-guard 검증 테스트. 실행: node --test .claude/hooks/git-guard.test.mjs
// 같은 작업 트리를 여러 세션이 쓸 때의 사고(남의 줄 커밋, 남의 작업 지우기, 공개 저장소 노출)를 막는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { segmentsOf } from './lib/git-cmd.mjs';
import { decision, reason, sandbox } from './lib/test-kit.mjs';

const PUBLIC_IP = ['8', '8', '4', '4'].join('.'); // 테스트 원문에 주소 모양을 그대로 두지 않는다

test('01 명령 분리: 여러 줄 커밋 메시지(heredoc·명령 치환)는 경로로 읽지 않는다', () => {
  const cmd = 'git add a.ts && git commit -m "$(cat <<\'EOF\'\nfeat: 제목 (T-1)\n\n본문 b.ts\nEOF\n)"\ngit status';
  assert.deepEqual(segmentsOf(cmd), ['git add a.ts', 'git commit -m "SUBST"', 'git status']);
  assert.deepEqual(segmentsOf("cat <<EOF > x.txt\nrm -rf /\nEOF\necho ok"), ['cat  > x.txt', 'echo ok']);
});

test('02 남의 작업까지 바꾸는 명령은 메인 트리에서 막는다', () => {
  const { bash } = sandbox();
  for (const cmd of ['git add -A', 'git add .', 'git add --all', 'git commit -am "x"', 'git commit -a -m x', 'git stash',
    'git stash pop', 'git reset --hard', 'git reset --hard HEAD~1', 'git reset', 'git reset HEAD~1', 'git checkout -- apps',
    'git checkout develop', 'git switch -c x', 'git restore apps/api/src/app.ts', 'git clean -fd', 'git rebase develop',
    'git push --force', 'git push -f origin develop', 'ls && git add -u', 'git reset --hard develop', 'git reset develop', 'git reset --hard HEAD', 'git reset --merge HEAD',
    'git reset --soft HEAD~1', 'git reset HEAD~1 -- apps/api/src/app.ts', 'git read-tree HEAD']) {
    assert.equal(decision(bash(cmd)), 'deny', cmd);
  }
});

test('03 조회와 경로를 지정한 인덱스 정리는 그대로 둔다', () => {
  const { bash } = sandbox();
  for (const cmd of ['git status', 'git log --oneline -5', 'git diff HEAD -- apps', 'git stash list', 'git show HEAD:package.json',
    'git restore --staged apps/api/src/app.ts', 'git reset -q -- apps/api/src/app.ts', 'git reset HEAD apps/api/src/app.ts',
    'git push origin develop', 'npm test', 'git worktree add --detach /tmp/x HEAD']) {
    assert.equal(bash(cmd).out, '', cmd);
  }
});

test('04 연결된 worktree·다른 저장소에서는 reset --hard 등을 막지 않는다 (ce 세션 흐름)', () => {
  const { dir, g, bash } = sandbox();
  const wt = path.join(fs.realpathSync(os.tmpdir()), `pm-wt-${path.basename(dir)}`);
  g('worktree', 'add', '-q', '--detach', wt, 'HEAD');
  try {
    assert.equal(bash(`cd ${wt} && git reset --hard HEAD`).out, '');
    assert.equal(bash(`git -C ${wt} reset --hard HEAD`).out, '');
    assert.equal(bash('git reset --hard HEAD', 'PreToolUse', { cwd: wt }).out, '');
    assert.equal(decision(bash(`cd ${wt} && git status && cd ${dir} && git reset --hard`)), 'deny');
  } finally {
    g('worktree', 'remove', '--force', wt);
  }
});

test('05 이 세션이 쓴 파일·줄만 있으면 add 를 통과시키고, 남의 줄이 섞이면 막는다', () => {
  const { dir, bash, claudeWrite, claudeEdit, writeText } = sandbox();
  claudeWrite('apps/api/src/mine.ts', 'export const mine = "내가 만든 파일";\n');
  assert.equal(bash('git add apps/api/src/mine.ts').out, '');
  claudeEdit('apps/api/src/app.ts', 'export const app = 1;', 'export const app = 1;\nexport const added = "내 줄";');
  assert.equal(bash('git add apps/api/src/app.ts').out, '');
  // 다른 세션이 같은 파일에 줄을 더했다
  fs.appendFileSync(path.join(dir, 'apps/api/src/app.ts'), 'export const peer = "다른 세션의 줄";\n');
  const r = bash('git add apps/api/src/app.ts');
  assert.equal(decision(r), 'deny');
  assert.match(reason(r), /이 세션이 쓰지 않은 줄 1개/);
  assert.match(reason(r), /다른 세션의 줄/);
  assert.match(reason(r), /update-index --cacheinfo/);
  // 디렉터리로 올려도 아래 파일을 하나씩 본다
  writeText('apps/api/src/peer-only.ts', 'export const peerOnly = "남이 만든 새 파일";\n');
  assert.equal(decision(bash('git add apps/api/src')), 'deny');
  // 직접 확인했다는 표시를 붙이면 통과
  assert.equal(bash('GIT_GUARD_MINE=1 git add apps/api/src/app.ts').out, '');
});

test('06 경로 커밋(--only)과 인덱스 커밋도 같은 판정을 한다', () => {
  const { dir, g, bash, claudeEdit, writeText } = sandbox();
  claudeEdit('apps/api/src/app.ts', 'export const app = 1;', 'export const app = 2; // 내 수정');
  assert.equal(bash('git commit -m "x" -- apps/api/src/app.ts').out, '');
  assert.equal(bash('git commit -m x apps/api/src/app.ts').out, '');
  fs.appendFileSync(path.join(dir, 'apps/api/src/app.ts'), 'export const peer = "다른 세션";\n');
  assert.equal(decision(bash('git commit -m "x" --only apps/api/src/app.ts')), 'deny');
  // 다른 세션이 인덱스에 올려 둔 파일이 있으면 경로 없는 커밋은 막는다
  writeText('apps/web/peer.ts', 'export const staged = "다른 세션이 올림";\n');
  g('add', 'apps/web/peer.ts');
  const r = bash('git commit -m "내 커밋"');
  assert.equal(decision(r), 'deny');
  assert.match(reason(r), /apps\/web\/peer\.ts/);
});

test('07 임시 인덱스(GIT_INDEX_FILE) 커밋은 줄 판정을 하지 않고, 노출 검사는 한다 (19 세션 흐름)', () => {
  const { dir, g, bash, writeText } = sandbox();
  const idx = path.join(dir, '.git', 'tmp-index');
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const gi = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
  gi('read-tree', 'HEAD');
  const blob = (text) => {
    const f = writeText('.blob.tmp', text);
    const h = gi('hash-object', '-w', f).trim();
    fs.rmSync(f);
    return h;
  };
  gi('update-index', '--add', '--cacheinfo', `100644,${blob('export const fromBlob = "HEAD+내 줄";\n')},apps/api/src/app.ts`);
  assert.equal(bash(`GIT_INDEX_FILE=${idx} git commit -F msg.txt`).out, '');
  assert.equal(bash(`export GIT_INDEX_FILE=${idx}; git commit -F msg.txt`).out, '');
  gi('update-index', '--add', '--cacheinfo', `100644,${blob(`const host = "${PUBLIC_IP}";\n`)},apps/api/src/app.ts`);
  const r = bash(`GIT_INDEX_FILE=${idx} git commit -F msg.txt`);
  assert.equal(decision(r), 'deny');
  assert.match(reason(r), /공인 IP 주소/);
  assert.ok(!reason(r).includes(PUBLIC_IP), '찾은 값을 사유에 다시 적지 않는다');
  g('status'); // 진짜 인덱스는 건드리지 않았다
});

test('08 로컬 전용 파일·줄과 공개되면 안 되는 값은 확인 표시가 있어도 막는다', () => {
  const { bash, claudeWrite, claudeEdit } = sandbox();
  claudeWrite('scripts/dev-local.sh', 'echo local\n');
  assert.equal(decision(bash('GIT_GUARD_MINE=1 git add scripts/dev-local.sh')), 'deny');
  claudeEdit('package.json', '"test": "vitest run",', '"test": "vitest run",\n    "dev:local": "bash scripts/dev-local.sh",');
  assert.match(reason(bash('GIT_GUARD_MINE=1 git add package.json')), /로컬 전용 줄/);
  claudeWrite('apps/api/src/host.ts', `export const HOST = "veda.${PUBLIC_IP}.sslip.io";\n`);
  assert.match(reason(bash('git add apps/api/src/host.ts')), /공인 IP 주소/);
  claudeWrite('apps/api/src/example.ts', 'export const EXAMPLE = "203.0.113.5"; // 문서용 주소\n');
  assert.equal(bash('git add apps/api/src/example.ts').out, '');
});

test('09 --pathspec-from-file 로 넘긴 경로도 검사한다', () => {
  const { dir, bash, writeText } = sandbox();
  writeText('apps/api/src/peer.ts', 'export const p = "남의 파일";\n');
  writeText('paths.txt', 'apps/api/src/peer.ts\n');
  assert.equal(decision(bash(`git add --pathspec-from-file=${path.join(dir, 'paths.txt')}`)), 'deny');
});

test('10 커밋 뒤: 새어 나간 값을 다시 훑고, 이 세션 커밋만 amend 를 허용한다', () => {
  const { dir, g, bash, writeText } = sandbox();
  writeText('apps/api/src/clean.ts', 'export const ok = 1;\n');
  g('add', 'apps/api/src/clean.ts');
  g('commit', '-q', '-m', 'clean');
  const head = () => g('rev-parse', '--short', 'HEAD').trim();
  // 다른 세션의 커밋이 HEAD 면 amend 를 막는다
  assert.equal(decision(bash('git commit --amend -m x')), 'deny');
  const post = bash('git commit -m clean', 'PostToolUse', { tool_response: { stdout: `[develop ${head()}] clean\n 1 file changed` } });
  assert.equal(post.out, '');
  assert.equal(bash('git commit --amend -m x').out, '');
  writeText('apps/api/src/leak.ts', `export const ip = "${PUBLIC_IP}";\n`);
  g('add', 'apps/api/src/leak.ts');
  g('commit', '-q', '-m', 'leak');
  const r = bash('git commit -m leak', 'PostToolUse', { tool_response: { stdout: `[develop ${head()}] leak\n` } });
  assert.equal(r.json?.decision, 'block');
  assert.match(r.json.reason, /push 하지 말고/);
  // -q 로 해시가 안 찍혀도 HEAD 를 훑는다. 그렇다고 그 커밋을 이 세션 것으로 치지는 않는다
  const quiet = bash('git commit -q -m leak', 'PostToolUse', { tool_response: { stdout: '' } });
  assert.equal(quiet.json?.decision, 'block');
  writeText('apps/api/src/peer2.ts', 'export const p2 = 1;\n');
  g('add', 'apps/api/src/peer2.ts');
  g('commit', '-q', '-m', 'peer commit');
  assert.equal(bash('git commit -q -m x', 'PostToolUse', { tool_response: { stdout: '' } }).out, '');
  assert.equal(decision(bash('git commit --amend -m x')), 'deny', '-q 커밋 뒤 HEAD 가 내 것이라고 가정하지 않는다');
  assert.ok(fs.existsSync(dir));
});

test('11 /shared-commit skill 의 명령 그대로: 변수로 넘긴 임시 인덱스도 노출 검사를 한다', () => {
  const { dir, bash, writeText } = sandbox();
  const sp = path.join(dir, '.sp');
  fs.mkdirSync(sp);
  const flow = `SP=${sp}; export GIT_INDEX_FILE=$SP/idx\ngit read-tree HEAD\ngit apply --cached $SP/mine.patch\n` +
    'git diff --cached --stat\ngit commit -F $SP/msg.txt\nunset GIT_INDEX_FILE\ngit reset -q -- apps/api/src/app.ts';
  assert.equal(bash(flow).out, '');
  const env = { ...process.env, GIT_INDEX_FILE: path.join(sp, 'idx') };
  execFileSync('git', ['read-tree', 'HEAD'], { cwd: dir, env });
  const f = writeText('.leak.tmp', `const h = "${PUBLIC_IP}";\n`);
  const blob = execFileSync('git', ['hash-object', '-w', f], { cwd: dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['update-index', '--cacheinfo', `100644,${blob},apps/api/src/app.ts`], { cwd: dir, env });
  // 이미 만들어 둔 임시 인덱스를 변수로 넘겨 커밋하면 커밋 전에 막는다
  assert.match(reason(bash(`SP=${sp}; export GIT_INDEX_FILE=$SP/idx; git commit -F $SP/msg.txt`)), /공인 IP 주소/);
  // 같은 명령에서 read-tree 로 새로 만드는 흐름은 커밋 뒤 검사가 잡는다
  assert.equal(bash(flow).out, '');
  execFileSync('git', ['commit', '-q', '-m', 'leak via temp index'], { cwd: dir, env });
  const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const post = bash(flow, 'PostToolUse', { tool_response: { stdout: `[develop ${hash}] leak via temp index\n` } });
  assert.equal(post.json?.decision, 'block');
  assert.equal(decision(bash('git read-tree HEAD')), 'deny', '임시 인덱스 없이 read-tree 는 공용 인덱스를 바꾼다');
});

test('12 임시 인덱스: 같은 명령에서 read-tree 로 새로 만들면 남은 옛 내용으로 막지 않고, 지우는 항목은 노출로 보지 않는다', () => {
  const { dir, bash, writeText, claudeWrite } = sandbox();
  const sp = path.join(dir, '.sp2');
  fs.mkdirSync(sp);
  const idx = path.join(sp, 'idx');
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const gi = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
  // 지난번에 쓰다 남은 임시 인덱스 — 공개되면 안 되는 값이 올라가 있다
  gi('read-tree', 'HEAD');
  const f = writeText('.old.tmp', `const h = "${PUBLIC_IP}";\n`);
  gi('update-index', '--cacheinfo', `100644,${gi('hash-object', '-w', f).trim()},apps/api/src/app.ts`);
  claudeWrite('apps/api/src/mine.ts', 'export const mine = 1;\n');
  const flow = `SP=${sp}; export GIT_INDEX_FILE=$SP/idx\ngit read-tree HEAD\ngit add apps/api/src/mine.ts\ngit commit -q -F $SP/msg.txt\n` +
    'unset GIT_INDEX_FILE\ngit reset -q -- apps/api/src/mine.ts';
  assert.equal(bash(flow).out, '', 'read-tree 가 지울 옛 내용으로 막지 않는다');
  assert.match(reason(bash(`GIT_INDEX_FILE=${idx} git commit -m x`)), /공인 IP 주소/, '새로 만들지 않으면 지금 내용을 본다');
  // 로컬 전용 파일이 HEAD 에 있고, 임시 인덱스에서 지우는 커밋
  writeText('scripts/dev-local.sh', 'echo local\n');
  execFileSync('git', ['add', 'scripts/dev-local.sh'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'local file tracked'], { cwd: dir });
  gi('read-tree', 'HEAD');
  gi('rm', '-q', '--cached', 'scripts/dev-local.sh');
  assert.equal(bash(`GIT_INDEX_FILE=${idx} git commit -m "로컬 전용 파일 빼기"`).out, '', '지우는 것은 올리는 내용이 없다');
});
