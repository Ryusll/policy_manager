#!/usr/bin/env node
// PreToolUse hook: 서브에이전트별로 쓸 수 있는 경로와 실행할 수 있는 명령을 제한한다 (hooks.config.json의 agents).
// hook 입력의 agent_type이 설정에 있는 에이전트일 때만 검사하고, 메인 대화와 다른 에이전트는 그대로 둔다.
// 이 저장소의 세 에이전트는 모두 읽기 전용이다 — 셸은 git 조회(diff·show·log·blame·grep·status·ls-files)만 쓴다.
import {
  readInput, projectRoot, loadConfig, absPath, relPosix, deny, shellSegments, words,
} from './lib/hook-lib.mjs';

const FILE_FIELDS = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
// 조회 명령이라도 파일을 쓰거나 다른 프로그램을 띄우는 옵션
const UNSAFE_OPTION = /(^|\s)(--output(=|\s|$)|-O\S*|--open-files-in-pager|--ext-diff|--textconv)/;

const input = await readInput();
const agent = input.agent_type;
const root = projectRoot(input);
const policy = agent ? loadConfig(root).agents[agent] : null;

function shellProblem(command) {
  const cleaned = command.replace(/\s2>(&1|\/dev\/null)/g, ' ');
  if (/[<>]|\$\(|`/.test(cleaned)) return '리다이렉션이나 명령 치환은 쓸 수 없습니다';
  for (const segment of shellSegments(cleaned)) {
    const t = words(segment);
    if (!t.length) continue;
    const text = t.join(' ');
    if (UNSAFE_OPTION.test(text)) return `파일을 쓰거나 다른 프로그램을 띄우는 옵션은 쓸 수 없습니다 (${segment.trim()})`;
    if ((policy.shell || []).some((prefix) => text === prefix || text.startsWith(`${prefix} `))) continue;
    return `허용되지 않은 명령입니다 (${segment.trim()})`;
  }
  return null;
}

function checkWrite(field) {
  const rel = relPosix(root, absPath((input.tool_input || {})[field], input) || '');
  const allowed = policy.write || [];
  if (rel && allowed.some((dir) => rel.startsWith(dir))) return;
  const target = rel || '프로젝트 밖';
  deny(allowed.length
    ? `${agent}는 ${allowed.join(', ')} 아래에만 파일을 쓸 수 있습니다. 대상: ${target}`
    : `${agent}는 파일을 쓸 수 없는 읽기 전용 에이전트입니다. 고칠 것은 메인 대화에 제안하세요. 대상: ${target}`);
}

function checkShell() {
  const problem = shellProblem((input.tool_input || {}).command || '');
  if (!problem) return;
  deny(`${agent}: ${problem}. 실행할 수 있는 명령: ${(policy.shell || []).join(', ') || '없음'}`);
}

if (policy) {
  const name = input.tool_name;
  if (FILE_FIELDS[name]) checkWrite(FILE_FIELDS[name]);
  else if (name === 'Bash') checkShell();
}
process.exit(0);
