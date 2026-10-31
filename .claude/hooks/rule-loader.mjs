#!/usr/bin/env node
// 경로 규칙 전달 hook (hooks.config.json의 rules).
// Claude Code는 paths 규칙을 파일을 "읽을 때"만 불러오고, Write로 새 파일을 바로 만들 때는 불러오지 않는다
// (2.1.285에서 확인). 그래서 새 파일을 만들 때도 규칙이 먼저 전달되게 한다.
//   PostToolUse (Read): 읽은 파일에 맞는 규칙을 이 대화가 이미 받은 것으로 기록한다.
//   PreToolUse (Write): 새 파일에 맞는 규칙 중 아직 받지 않은 것이 있으면 한 번 막고 규칙 본문을 돌려준다.
//   SessionStart: 새 대화, /clear, 압축 뒤에는 기록을 비운다.
// 서브에이전트는 컨텍스트가 따로이므로 기록도 agent_id별로 따로 둔다.
import fs from 'node:fs';
import path from 'node:path';
import {
  readInput, projectRoot, loadConfig, absPath, relPosix, statePath, readState, writeState, deny,
} from './lib/hook-lib.mjs';
import { loadRules, matchingRules } from './lib/rules-lib.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root).rules;
const stateFile = statePath(root, input.session_id, 'rules');
const who = input.agent_id || 'main';
const rel = relPosix(root, absPath((input.tool_input || {}).file_path, input) || '');

function remember(files) {
  const state = readState(stateFile, {});
  state[who] = [...new Set([...(state[who] || []), ...files])];
  writeState(stateFile, state);
}

function afterRead() {
  if (input.tool_name !== 'Read' || !rel) return;
  const hits = matchingRules(loadRules(root, cfg.dir), rel);
  if (hits.length) remember(hits.map((r) => r.file));
}

function beforeWrite() {
  if (input.tool_name !== 'Write' || cfg.newFile !== 'deny' || !rel) return;
  if (fs.existsSync(path.join(root, rel))) return; // 기존 파일은 먼저 읽어야 쓸 수 있으므로 규칙이 이미 불려 있다
  const seen = new Set(readState(stateFile, {})[who] || []);
  const missing = matchingRules(loadRules(root, cfg.dir), rel).filter((r) => !seen.has(r.file));
  if (!missing.length) return;
  remember(missing.map((r) => r.file));
  deny(`${rel}에 적용되는 규칙이 아직 이 대화에 없습니다 (Claude Code는 새 파일을 쓸 때 경로 규칙을 불러오지 않습니다). ` +
    `아래 규칙을 반영해 같은 파일을 다시 쓰세요.\n\n${missing.map((r) => `[${r.file}]\n${r.body.trim()}`).join('\n\n')}`);
}

const handlers = { PostToolUse: afterRead, PreToolUse: beforeWrite, SessionStart: () => writeState(stateFile, {}) };
handlers[input.hook_event_name]?.();
process.exit(0);
