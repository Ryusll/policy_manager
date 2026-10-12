#!/usr/bin/env node
// 메인 대화의 컨텍스트를 아끼는 hook (hooks.config.json의 agentModels, readNudge).
//   PreToolUse (Agent): 코드를 읽는 서브에이전트(Explore, Plan, code-explorer 등)는 호출할 때 지정한 모델과 관계없이
//                       agentModels에 적힌 모델(기본 sonnet)로 실행되도록 호출 입력을 고친다.
//   PostToolUse (Read): 메인 대화가 한 요청에서 파일을 readNudge.threshold개째 직접 읽으면, 기존 코드 파악은
//                       서브에이전트에 맡기라고 한 번 알린다. 서브에이전트의 읽기는 세지 않는다.
import {
  readInput, projectRoot, loadConfig, statePath, readState, writeState, output, addContext,
} from './lib/hook-lib.mjs';

const input = await readInput();
const root = projectRoot(input);
const cfg = loadConfig(root);
const toolInput = input.tool_input || {};

function pinModel() {
  const type = toolInput.subagent_type;
  const model = type ? cfg.agentModels[type] : null;
  if (!model || toolInput.model === model) return;
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `${type} 에이전트는 ${model} 모델로 실행합니다 (hooks.config.json의 agentModels)`,
      updatedInput: { ...toolInput, model },
    },
  });
}

function countReads() {
  const threshold = cfg.readNudge.threshold;
  if (!threshold || input.agent_type) return; // 0이면 끔. 서브에이전트의 읽기는 세지 않는다
  const file = statePath(root, input.session_id, 'reads');
  const key = input.prompt_id || 'session';
  const state = readState(file, {});
  const count = (state.key === key ? state.count : 0) + 1;
  writeState(file, { key, count });
  if (count !== threshold) return;
  addContext('PostToolUse',
    `이번 요청에서 파일을 ${count}개째 직접 읽었습니다. 기존 코드 파악이 목적이면 Explore(위치 찾기)나 ` +
    'code-explorer(흐름 분석)에 맡기고 요약과 파일:줄 목록만 받으세요. 수정할 파일만 직접 여는 것이 메인 컨텍스트를 아낍니다.');
}

const handlers = { PreToolUse: pinModel, PostToolUse: countReads };
handlers[input.hook_event_name]?.();
process.exit(0);
