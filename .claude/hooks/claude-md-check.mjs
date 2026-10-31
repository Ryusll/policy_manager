#!/usr/bin/env node
// CLAUDE.md 검사 hook (PostToolUse Edit·Write·MultiEdit, hooks.config.json의 claudeMd).
// CLAUDE.md나 그것이 가져오는 파일을 고치면, 없는 명령·경로·skill을 가리키는지, 크기(합계 200줄·권장 100줄),
// 공개되면 안 되는 값을 검사해 Claude에게 돌려준다. 권장 크기 초과는 막지 않고 알리기만 한다.
import { readInput, projectRoot, loadConfig, absPath, relPosix, readText, output, addContext } from './lib/hook-lib.mjs';
import { claudeMdProblems, imports, CLAUDE_MD } from './lib/claude-md-lib.mjs';
import path from 'node:path';

const input = await readInput();
const root = projectRoot(input);
const rel = relPosix(root, absPath((input.tool_input || {}).file_path, input) || '') || '';
const watched = [CLAUDE_MD, ...imports(readText(path.join(root, CLAUDE_MD)) || '')];

if (watched.includes(rel)) {
  const { problems, warnings } = claudeMdProblems(root, loadConfig(root));
  if (problems.length) {
    output({
      decision: 'block',
      reason: `CLAUDE.md 검사에서 문제가 나왔습니다. CLAUDE.md에는 실제로 있는 것만 적습니다.\n- ${[...problems, ...warnings].join('\n- ')}`,
    });
  } else if (warnings.length) {
    addContext('PostToolUse', `CLAUDE.md 검사: ${warnings.join(' / ')}`);
  }
}
process.exit(0);
