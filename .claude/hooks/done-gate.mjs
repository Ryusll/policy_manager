#!/usr/bin/env node
// 작업 완료 관문 hook (hooks.config.json의 doneGate). task-cycle skill의 "완료 전 검토"를 연산으로 강제한다.
// 스타터 패키지는 백로그 CLI의 set <id> done을 막았다. 이 저장소에서는 작업관리대장의 T 행 상태를 "완료"로 바꾸는 편집을 본다.
//   SubagentStop (adversarial-reviewer): 검토가 끝난 시각을 세션 기록에 남긴다.
//   PreToolUse (Edit·Write·MultiEdit, 대장 파일): 새로 완료가 되는 T 행이 있는데, 이 세션이 코드를 고친 뒤
//     검토 기록이 없으면 막는다. 이 세션에서 코드를 고치지 않았으면(문서만, 다른 세션 작업의 기록) 통과시킨다.
// Bash(python 등)로 대장을 고치면 이 관문을 지나지 않는다 — 대장은 Edit 도구로 고친다(rules/docs.md).
import fs from 'node:fs';
import path from 'node:path';
import {
  readInput, projectRoot, loadConfig, absPath, relPosix, statePath, readState, writeState, predictText, deny,
} from './lib/hook-lib.mjs';
import { readEdits } from './lib/edits.mjs';
import { newlyCompleted } from './lib/ledger.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root);
const gate = cfg.doneGate;
const reviewFile = statePath(root, input.session_id, 'review');

// settings.json의 SubagentStop matcher가 검토 에이전트로 한정한다. agent_type이 있으면 한 번 더 확인하고,
// 입력에 agent_type이 없는 버전이면 matcher를 믿고 기록한다 (기록이 영영 안 남아 완료가 막히는 일을 막기 위해).
function recordReview() {
  if (!input.agent_type || input.agent_type === gate.reviewer) writeState(reviewFile, { at: Date.now() });
}

function checkLedgerEdit() {
  const toolInput = input.tool_input || {};
  const rel = relPosix(root, absPath(toolInput.file_path, input) || '');
  if (!gate.requireReview || rel !== cfg.ledger) return;
  let current;
  try {
    current = fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    current = null;
  }
  const next = predictText(input.tool_name, toolInput, current);
  if (next === null) return;
  const ids = newlyCompleted(current || '', next);
  if (!ids.length) return;
  const { lastCodeAt, lastCodeFile } = readEdits(root, input.session_id);
  if (!lastCodeAt) return;
  const reviewAt = readState(reviewFile, {}).at || 0;
  if (reviewAt > lastCodeAt) return;
  const why = reviewAt
    ? `마지막 검토 뒤에 ${lastCodeFile}이(가) 바뀌었습니다`
    : `이 세션에서 코드를 고쳤는데(${lastCodeFile} 등) ${gate.reviewer} 검토 기록이 없습니다`;
  deny(`${ids.join(', ')}을(를) 완료로 바꾸기 전에 검토가 필요합니다 — ${why}. ` +
    `${gate.reviewer}에게 작업 ID, 변경 파일 목록, 완료 정의(DoD)를 넘겨 검토받고 Critical·High를 고친 뒤 다시 기록하세요.`);
}

const handlers = { SubagentStop: recordReview, PreToolUse: checkLedgerEdit };
handlers[input.hook_event_name]?.();
process.exit(0);
