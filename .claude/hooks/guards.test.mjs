// 줄 수·마무리 검사·완료 관문 hook 테스트. 실행: node --test .claude/hooks/guards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEDGER, ledgerText, lines, decision, reason, context, sandbox } from './lib/test-kit.mjs';

const pre = (s, name, tool_name, tool_input) => s.hook(name, { hook_event_name: 'PreToolUse', tool_name, tool_input });

test('01 size-guard: 새 파일·기준 이하 파일이 300줄을 넘게 되면 막는다', () => {
  const s = sandbox();
  const file = (rel) => path.join(s.dir, rel);
  assert.equal(decision(pre(s, 'size-guard.mjs', 'Write', { file_path: file('apps/web/src/A.tsx'), content: lines(301) })), 'deny');
  assert.equal(pre(s, 'size-guard.mjs', 'Write', { file_path: file('apps/web/src/A.tsx'), content: lines(300) }).out, '');
  s.write('apps/api/src/b.ts', 299);
  const edit = (n) => pre(s, 'size-guard.mjs', 'Edit', { file_path: file('apps/api/src/b.ts'), old_string: '// line 1\n', new_string: '// line 1\n' + '// x\n'.repeat(n) });
  assert.equal(decision(edit(2)), 'deny');
  assert.equal(edit(1).out, '');
  // 범위 밖(문서·i18n 사전·테스트)은 보지 않는다
  for (const rel of ['docs/long.md', 'apps/web/src/i18n/messages.ts', 'tests/big.test.ts']) {
    assert.equal(pre(s, 'size-guard.mjs', 'Write', { file_path: file(rel), content: lines(900) }).out, '', rel);
  }
});

test('02 size-guard: 이미 넘은 파일은 고칠 수 있고, HEAD보다 150줄 넘게 늘리면 막는다', () => {
  const s = sandbox();
  s.write('apps/web/src/pages/Legacy.tsx', 1000);
  s.g('add', '.');
  s.g('commit', '-q', '-m', 'legacy');
  const file = path.join(s.dir, 'apps/web/src/pages/Legacy.tsx');
  const grow = (n) => pre(s, 'size-guard.mjs', 'Edit', { file_path: file, old_string: '// line 2\n', new_string: '// line 2\n' + '// add\n'.repeat(n) });
  assert.equal(grow(10).out, '');
  assert.equal(grow(150).out, '');
  const r = grow(151);
  assert.equal(decision(r), 'deny');
  assert.match(reason(r), /새 컴포넌트·서비스 파일로/);
  const post = s.hook('size-guard.mjs', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file } });
  assert.match(context(post), /1000줄로 기준 300줄을 넘는/);
});

test('03 size-guard Stop: 이 세션이 (Bash 등으로) 기준을 새로 넘긴 파일만 보류하고, 반복되면 사용자에게 넘긴다', () => {
  const s = sandbox();
  s.write('apps/api/src/peer-big.ts', 900); // 다른 세션 파일 — 이 세션 기록에 없다
  s.claudeWrite('apps/api/src/mine.ts', lines(100));
  const stop = (active) => s.hook('size-guard.mjs', { hook_event_name: 'Stop', stop_hook_active: active });
  assert.equal(stop(false).out, '');
  fs.writeFileSync(path.join(s.dir, 'apps/api/src/mine.ts'), lines(400)); // Bash로 늘린 경우
  const first = stop(false);
  assert.equal(first.json?.decision, 'block');
  assert.match(first.json.reason, /mine\.ts/);
  assert.ok(!first.json.reason.includes('peer-big'));
  assert.equal(stop(true).json?.decision, 'block');
  assert.match(stop(true).json?.systemMessage || '', /직접 확인하세요/);
});

test('04 check-runner Stop: 고친 경로에 맞는 명령만, {files}는 고친 파일로 바꿔 실행한다', () => {
  const marker = 'checks-ran.txt';
  const s = sandbox({
    config: {
      checks: {
        afterEdit: [], timeoutSec: 30,
        beforeStop: [
          { run: `echo api >> ${marker}`, when: ['apps/api/'] },
          { run: `echo web >> ${marker}`, when: ['apps/web/'] },
          { run: `echo {files} >> ${marker}`, when: ['apps/'], files: ['.ts'] },
        ],
      },
    },
  });
  const stop = () => s.hook('check-runner.mjs', { hook_event_name: 'Stop', stop_hook_active: false });
  const ran = () => (fs.existsSync(path.join(s.dir, marker)) ? fs.readFileSync(path.join(s.dir, marker), 'utf8') : '');
  s.claudeWrite('docs/note.md', '# 문서만\n');
  assert.equal(stop().out, '');
  assert.equal(ran(), '', '문서만 고치면 검사하지 않는다');
  s.claudeWrite('apps/api/src/x.ts', 'export const x = 1;\n');
  assert.equal(stop().out, '');
  assert.equal(ran(), 'api\napps/api/src/x.ts\n');
  assert.equal(stop().out, '');
  assert.equal(ran(), 'api\napps/api/src/x.ts\n', '통과한 뒤 새 수정이 없으면 다시 돌리지 않는다');
});

test('05 check-runner Stop: 실패하면 보류하고, 출력에 이 세션 파일이 없으면 다른 세션 변경일 수 있다고 알린다', () => {
  const s = sandbox({
    config: { checks: { afterEdit: [], timeoutSec: 30, beforeStop: [{ run: 'echo "apps/web/src/peer.tsx(3,1): error" && exit 2' }] } },
  });
  s.claudeWrite('apps/api/src/x.ts', 'export const x = 1;\n');
  const stop = (active) => s.hook('check-runner.mjs', { hook_event_name: 'Stop', stop_hook_active: active });
  const r = stop(false);
  assert.equal(r.json?.decision, 'block');
  assert.match(r.json.reason, /종료 코드 2/);
  assert.match(r.json.reason, /이 세션이 고친 파일이 보이지 않습니다/);
  assert.equal(stop(true).json?.decision, 'block');
  assert.match(stop(true).json?.systemMessage || '', /2번 연속 실패/);
});

test('06 done-gate: 코드를 고친 세션은 검토 기록 없이 대장 T 행을 완료로 바꿀 수 없다', () => {
  const s = sandbox();
  const file = path.join(s.dir, LEDGER);
  const mark = (status) => pre(s, 'done-gate.mjs', 'Edit', {
    file_path: file, old_string: '| — | 진행 |', new_string: `| — | ${status} |`,
  });
  assert.equal(mark('**완료(10/12)** → C-08').out, '', '코드를 고치지 않았으면 기록만 하는 것이다');
  s.claudeWrite('apps/api/src/feature.ts', 'export const f = 1;\n');
  const r = mark('**완료(10/12)** → C-08');
  assert.equal(decision(r), 'deny');
  assert.match(reason(r), /T-001.*adversarial-reviewer/s);
  assert.equal(mark('진행 — ① 완료(10/12)').out, '', '부분 진행은 완료가 아니다');
  s.hook('done-gate.mjs', { hook_event_name: 'SubagentStop', agent_type: 'adversarial-reviewer' });
  assert.equal(mark('**완료(10/12)** → C-08').out, '');
  s.claudeEdit('apps/api/src/feature.ts', 'f = 1', 'f = 2');
  assert.match(reason(mark('완료')), /마지막 검토 뒤에 apps\/api\/src\/feature\.ts/);
  // 새 행을 완료 상태로 넣어도 같다
  const add = pre(s, 'done-gate.mjs', 'Write', {
    file_path: file, content: ledgerText(['| T-001 | 첫 작업 | P1 | 개발 | 된다 | — | 진행 |', '| T-002 | 새 | P1 | 개발 | 된다 | — | 완료 |']),
  });
  assert.match(reason(add), /T-002/);
});

test('07 session-start·statusline: 브랜치, 미커밋 수, 대장 다음 번호, 최근 마이그레이션', () => {
  const s = sandbox();
  s.writeText('apps/api/prisma/migrations/20261010070000_x/migration.sql', '-- x\n');
  s.writeText('apps/api/src/new.ts', 'x\n');
  const r = s.hook('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
  const text = context(r);
  assert.match(text, /git 브랜치: develop/);
  assert.match(text, /미커밋 변경: 수정 0 · 새 파일 2/);
  assert.match(text, /다음 번호: T-2 · C-8 · D-4/);
  assert.match(text, /최근 마이그레이션: 20261010070000_x/);
  const line = s.hook('statusline.mjs', { model: { display_name: 'Opus' }, workspace: { project_dir: s.dir } }).out;
  assert.match(line, /git develop/);
  assert.match(line, /다음 T-2 · C-8 · D-4/);
});
