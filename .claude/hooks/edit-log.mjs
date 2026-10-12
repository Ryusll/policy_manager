#!/usr/bin/env node
// PostToolUse hook (Edit·Write·MultiEdit·NotebookEdit): 이 세션이 고친 내용을 세션 기록에 남긴다.
// git-guard(내 줄 판정), check-runner(마무리 검사 대상), size-guard(마무리 줄 수), done-gate(검토 뒤 수정)가 읽는다.
// 서브에이전트의 수정도 같은 세션 기록에 들어간다.
import { readInput, projectRoot, absPath, relPosix } from './lib/hook-lib.mjs';
import { editPieces, recordEdit } from './lib/edits.mjs';

const input = await readInput();
const root = projectRoot(input);
const toolInput = input.tool_input || {};
const rel = relPosix(root, absPath(toolInput.file_path || toolInput.notebook_path, input) || '');

if (rel && input.hook_event_name === 'PostToolUse') {
  recordEdit(root, input.session_id, rel, editPieces(input.tool_name, toolInput));
}
process.exit(0);
