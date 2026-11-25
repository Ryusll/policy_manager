// 설정 검증 테스트. 실행: node --test .claude/hooks/setup.test.mjs
// settings.json·에이전트·skill·규칙·CLAUDE.md가 실제 파일·명령과 맞는지, 에이전트·규칙 hook이 동작하는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './lib/hook-lib.mjs';
import { loadRules, matchesGlob } from './lib/rules-lib.mjs';
import { claudeMdProblems } from './lib/claude-md-lib.mjs';
import { root, decision, reason, context, sandbox } from './lib/test-kit.mjs';

const cfg = loadConfig(root);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const frontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return m ? Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]])) : null;
};
// 저장소 파일(추적 + 아직 커밋 전이지만 무시되지 않는 새 파일)
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean);

test('01 settings.json: 모든 hook 명령이 있는 스크립트를 가리키고, 필요한 이벤트가 다 걸려 있다', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  const scripts = new Set();
  for (const [event, groups] of Object.entries(settings.hooks)) {
    for (const g of groups) {
      for (const h of g.hooks) {
        const m = h.command.match(/\.claude\/hooks\/([\w-]+\.mjs)/);
        assert.ok(m, `${event}: ${h.command}`);
        assert.ok(fs.existsSync(path.join(root, '.claude/hooks', m[1])), m[1]);
        scripts.add(`${event}:${m[1]}`);
      }
    }
  }
  for (const need of ['SessionStart:session-start.mjs', 'PreToolUse:git-guard.mjs', 'PostToolUse:git-guard.mjs',
    'PostToolUse:edit-log.mjs', 'PreToolUse:size-guard.mjs', 'Stop:check-runner.mjs', 'PreToolUse:done-gate.mjs',
    'SubagentStop:done-gate.mjs', 'PreToolUse:agent-guard.mjs', 'PreToolUse:rule-loader.mjs', 'PostToolUse:claude-md-check.mjs']) {
    assert.ok(scripts.has(need), need);
  }
  assert.match(settings.statusLine.command, /statusline\.mjs/);
});

test('02 에이전트: 이름·도구·설정이 맞고, 셋 다 읽기 전용(쓰기 권한 없음)이다', () => {
  const dir = path.join(root, '.claude/agents');
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(names, ['adversarial-reviewer', 'code-explorer', 'task-explainer']);
  for (const name of names) {
    const fm = frontmatter(read(`.claude/agents/${name}.md`));
    assert.equal(fm.name, name);
    assert.ok(fm.description.length > 30, name);
    assert.ok(!/Write|Edit/.test(fm.tools), `${name}는 쓰기 도구가 없어야 한다`);
    assert.deepEqual(cfg.agents[name].write, [], name);
    assert.ok(cfg.agents[name].shell.every((c) => /^(git (log|show|diff|blame|grep|status|ls-files)|head|tail|wc)$/.test(c)), name);
  }
});

test('03 skill: 폴더명과 name이 같고, 적힌 파일·npm 스크립트·skill이 실제로 있다', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const skills = fs.readdirSync(path.join(root, '.claude/skills'));
  for (const name of skills) {
    const text = read(`.claude/skills/${name}/SKILL.md`);
    const fm = frontmatter(text);
    assert.equal(fm.name, name);
    assert.ok(fm.description.length > 30, name);
    for (const [, s] of text.matchAll(/npm run ([\w:-]+)/g)) assert.ok(scripts[s], `${name}: npm run ${s}`);
    for (const [, s] of text.matchAll(/(?:^|\s)\/([a-z][a-z0-9-]+)\b/g)) {
      if (!['api', 'tmp'].includes(s)) assert.ok(skills.includes(s), `${name}: /${s}`);
    }
    for (const [, p] of text.matchAll(/`((?:docs|apps|tests|\.claude)\/[^`*<>\s]+)`/g)) {
      assert.ok(fs.existsSync(path.join(root, p)), `${name}: ${p}`);
    }
  }
});

test('04 규칙: 형식·크기(30줄·1,500자)를 지키고, paths가 실제 파일에 맞는다', () => {
  const rules = loadRules(root, cfg.rules.dir);
  assert.ok(rules.length >= 6);
  for (const r of rules) {
    assert.deepEqual(r.problems, [], r.file);
    const text = read(r.file);
    assert.ok(text.split('\n').length <= 31 && text.length <= 1500, `${r.file}: ${text.split('\n').length}줄 ${text.length}자`);
    for (const g of r.paths) assert.ok(tracked.some((f) => matchesGlob(f, g)), `${r.file}: ${g}`);
  }
  const hits = (rel) => rules.filter((r) => r.paths.some((g) => matchesGlob(rel, g))).map((r) => path.basename(r.file, '.md')).sort();
  assert.deepEqual(hits('apps/api/src/users/users.service.ts'), ['api', 'code-quality']);
  assert.deepEqual(hits('apps/web/src/pages/LoginPage.tsx'), ['code-quality', 'web-ui']);
  assert.deepEqual(hits('apps/api/prisma/schema.prisma'), ['prisma']);
  assert.deepEqual(hits('tests/integration/helpers.ts'), ['tests']);
  assert.deepEqual(hits('docs/Deliverables/17_작업관리대장/작업관리대장.md'), ['docs']);
  assert.deepEqual(hits('scripts/oracle/deploy.sh'), ['code-quality', 'infra']);
  assert.deepEqual(hits('package.json'), []);
});

test('05 CLAUDE.md: 없는 참조·비밀값이 없고 100줄 이하, 가져오는 파일과 합쳐 200줄 이하', () => {
  assert.deepEqual(claudeMdProblems(root, cfg), { problems: [], warnings: [] });
  assert.ok(read('CLAUDE.md').split('\n').length <= 100);
});

test('06 claude-md-check: 없는 스크립트·경로, 공인 IP, 200줄 초과를 막고 100줄 초과는 알린다', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.dir, '.claude/inc.md'), '# 가져온 것\n');
  const check = (text) => {
    const f = s.writeText('CLAUDE.md', text);
    return s.hook('claude-md-check.mjs', { hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: f } });
  };
  assert.equal(check('# 프로젝트\n\n@.claude/inc.md\n\n`npm run test` · `apps/api/src`\n').out, '');
  const bad = check('# 프로젝트\n\n`npm run nope` · `apps/none` · `/no-skill`\n주소 ' + ['8', '8', '8', '8'].join('.') + '\n');
  assert.equal(bad.json?.decision, 'block');
  for (const want of ['npm run nope', 'apps/none', '/no-skill', '공인 IP']) assert.match(bad.json.reason, new RegExp(want));
  assert.match(context(check('# 길다\n' + 'x\n'.repeat(120))), /권장 100줄/);
  assert.equal(check('# 너무 길다\n' + 'x\n'.repeat(210)).json?.decision, 'block');
});

test('07 agent-guard: 읽기 전용 에이전트는 파일을 못 쓰고, 셸은 git 조회만 쓴다', () => {
  const s = sandbox();
  const run = (agent_type, tool_name, tool_input) => s.hook('agent-guard.mjs', { hook_event_name: 'PreToolUse', agent_type, tool_name, tool_input });
  assert.equal(decision(run('adversarial-reviewer', 'Edit', { file_path: path.join(s.dir, 'apps/api/src/app.ts') })), 'deny');
  assert.equal(decision(run('task-explainer', 'Write', { file_path: path.join(s.dir, 'docs/tasks/T-1.md') })), 'deny');
  for (const ok of ['git diff HEAD -- apps', 'git log --oneline --grep T-137 | head -5', 'git show --stat HEAD', 'git blame -L 1,5 x.ts']) {
    assert.equal(run('code-explorer', 'Bash', { command: ok }).out, '', ok);
  }
  for (const no of ['rm -rf apps', 'git diff --output=x.patch', 'git grep -O vim x', 'git log > out.txt', 'npm test', 'git commit -m x']) {
    assert.equal(decision(run('adversarial-reviewer', 'Bash', { command: no })), 'deny', no);
  }
  assert.equal(run(undefined, 'Bash', { command: 'rm -rf x' }).out, '', '메인 대화는 agent-guard 대상이 아니다');
});

test('08 context-guard·rule-loader: 탐색 에이전트 모델 고정, 새 파일에는 규칙을 먼저 전달', () => {
  const s = sandbox();
  const pin = s.hook('context-guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'x' } });
  assert.equal(pin.json.hookSpecificOutput.updatedInput.model, 'sonnet');
  assert.equal(s.hook('context-guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'adversarial-reviewer' } }).out, '');
  fs.cpSync(path.join(root, '.claude/rules'), path.join(s.dir, '.claude/rules'), { recursive: true });
  const write = () => s.hook('rule-loader.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(s.dir, 'apps/api/prisma/migrations/x/migration.sql') } });
  const first = write();
  assert.equal(decision(first), 'deny');
  assert.match(reason(first), /Prisma 스키마·마이그레이션/);
  assert.equal(write().out, '', '한 번 전달한 규칙은 다시 막지 않는다');
});
