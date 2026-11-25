#!/usr/bin/env node
// 코드 파일 줄 수 기준 hook (기준값: hooks.config.json의 size, 300줄·80% 경고).
// 이 저장소에는 기준을 이미 넘은 파일이 많아(2026-10-12 기준 37개) 스타터 패키지와 달리 두 갈래로 본다.
//   새 파일·기준 이하 파일: 수정 결과가 기준을 넘으면 막는다.
//   이미 넘은 파일(레거시): 고칠 수는 있다. HEAD보다 legacyGrowth줄 넘게 늘리면 막는다 — 새 기능은 새 파일로 뺀다.
//   PreToolUse  (Edit·Write·MultiEdit): 위 판정으로 막는다.
//   PostToolUse (Edit·Write·MultiEdit): 기준의 80% 이상이거나 레거시 파일이면 분리를 검토하라고 알린다.
//   Stop: 이번 세션이 고친 파일(edit-log 기록) 중 기준을 새로 넘은 것이 있으면 마무리를 보류한다(Bash로 고친 경우).
import path from 'node:path';
import {
  readInput, projectRoot, loadConfig, absPath, relPosix, isCodeFile, countLines, readText, headText,
  predictText, stopBudget, output, deny, addContext,
} from './lib/hook-lib.mjs';
import { readEdits } from './lib/edits.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root);
const max = cfg.size.maxLines;
const growth = cfg.size.legacyGrowth;
const warnAt = Math.ceil(max * cfg.size.warnRatio);
const toolInput = input.tool_input || {};

// 파일 하나의 판정. before: 지금 줄 수, after: 수정 후 줄 수, head: HEAD 줄 수(새 파일이면 null)
function verdict(rel, before, after, head) {
  const legacy = (head ?? before) > max;
  if (!legacy) {
    if (after > max && after > before) {
      return `${rel}: 수정하면 ${after}줄이 되어 기준 ${max}줄을 넘습니다. 책임 단위로 파일을 나눈 뒤 다시 작성하세요.`;
    }
    return null;
  }
  const base = head ?? before;
  if (after > base + growth && after > before) {
    return `${rel}: 이미 기준(${max}줄)을 넘은 파일인데 HEAD(${base}줄)보다 ${after - base}줄 늘어납니다(허용 ${growth}줄). ` +
      '새 기능은 새 컴포넌트·서비스 파일로 빼고 여기서는 불러 쓰기만 하세요.';
  }
  return null;
}

function beforeTool() {
  const file = absPath(toolInput.file_path, input);
  const rel = relPosix(root, file || '');
  if (!isCodeFile(rel, cfg)) return;
  const current = readText(file);
  const next = predictText(input.tool_name, toolInput, current);
  if (next === null) return;
  const before = current === null ? 0 : countLines(current);
  const after = countLines(next);
  if (after <= max) return;
  const head = headText(root, rel);
  const problem = verdict(rel, before, after, head === null ? null : countLines(head));
  if (problem) deny(problem);
}

function afterTool() {
  const file = absPath(toolInput.file_path, input);
  const rel = relPosix(root, file || '');
  if (!isCodeFile(rel, cfg)) return;
  const lines = countLines(readText(file) ?? '');
  if (lines > max) {
    addContext('PostToolUse', `${rel}: ${lines}줄로 기준 ${max}줄을 넘는 파일입니다. 더 늘리지 말고, 새로 넣는 기능은 별도 파일로 빼세요.`);
  } else if (lines >= warnAt) {
    const pct = Math.round((lines / max) * 100);
    addContext('PostToolUse', `${rel}: ${lines}줄 (기준 ${max}줄의 ${pct}%). 다음 수정 전에 파일 분리를 검토하세요. 기준을 넘는 수정은 차단됩니다.`);
  }
}

function atStop() {
  const { files } = readEdits(root, input.session_id);
  const over = [];
  for (const rel of Object.keys(files)) {
    if (!isCodeFile(rel, cfg)) continue;
    const now = readText(path.join(root, rel));
    if (now === null) continue;
    const lines = countLines(now);
    if (lines <= max) continue;
    const head = headText(root, rel);
    const problem = verdict(rel, head === null ? 0 : countLines(head), lines, head === null ? null : countLines(head));
    if (problem) over.push(`- ${problem}`);
  }
  const budget = stopBudget(root, input, 'size', cfg.stopRetries);
  if (!over.length) {
    budget.reset();
    return;
  }
  if (budget.exhausted) {
    budget.reset();
    output({ systemMessage: `줄 수 기준을 넘는 파일이 남아 있습니다. 직접 확인하세요.\n${over.join('\n')}` });
    return;
  }
  budget.recordBlock();
  output({ decision: 'block', reason: `다음 파일이 줄 수 기준을 넘습니다. 나눈 뒤 마무리하세요.\n${over.join('\n')}` });
}

const handlers = { PreToolUse: beforeTool, PostToolUse: afterTool, Stop: atStop };
handlers[input.hook_event_name]?.();
process.exit(0);
