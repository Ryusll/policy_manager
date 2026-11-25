// 이 세션이 고친 내용의 기록과 "이 줄이 내 것인가" 판정.
// 한 작업 트리를 여러 세션이 함께 쓰므로, git add·commit 직전에 diff의 줄이 이 세션의 Edit·Write에서
// 나온 것인지 대조한다(git-guard). 같은 기록을 검사(check-runner)·줄 수(size-guard)·완료 관문(done-gate)도 쓴다.
import { statePath, readState, writeState, isDocFile } from './hook-lib.mjs';

const MAX_TEXT = 2 * 1024 * 1024; // 파일당 기록 상한 — 넘으면 판정하지 않는다(overflow)

export const editsFile = (root, sid) => statePath(root, sid, 'edits');

export function readEdits(root, sid) {
  const s = readState(editsFile(root, sid), {});
  return { files: s.files || {}, lastCodeAt: s.lastCodeAt || 0, lastCodeFile: s.lastCodeFile || null };
}

// 도구 입력에서 더한 글과 지운 글을 뽑는다. Write는 파일 전체를 이 세션이 쓴 것으로 본다.
export function editPieces(toolName, toolInput) {
  if (toolName === 'Write') return { add: toolInput.content || '', del: '', whole: true };
  if (toolName === 'NotebookEdit') return { add: toolInput.new_source || '', del: '', whole: false };
  const edits = toolName === 'MultiEdit' ? toolInput.edits || [] : [toolInput];
  return {
    add: edits.map((e) => (e && e.new_string) || '').join('\n'),
    del: edits.map((e) => (e && e.old_string) || '').join('\n'),
    whole: false,
  };
}

export function recordEdit(root, sid, rel, pieces, now = Date.now()) {
  const file = editsFile(root, sid);
  const s = readState(file, {});
  const files = s.files || {};
  const prev = files[rel] || { add: '', del: '', whole: false, overflow: false };
  const add = `${prev.add}\n${pieces.add}`;
  const del = `${prev.del}\n${pieces.del}`;
  const overflow = prev.overflow || add.length + del.length > MAX_TEXT;
  files[rel] = {
    add: overflow ? '' : add, del: overflow ? '' : del, whole: prev.whole || pieces.whole, overflow, at: now,
  };
  const code = !isDocFile(rel);
  writeState(file, {
    files,
    lastCodeAt: code ? now : s.lastCodeAt || 0,
    lastCodeFile: code ? rel : s.lastCodeFile || null,
  });
}

// 짧은 줄(괄호, 빈 줄 등)은 누구 것이든 같아 판정에서 뺀다.
const meaningful = (line) => line.length >= 4 && /[\p{L}\p{N}]/u.test(line);

// unified diff에서 이 세션이 쓰지 않은 +/- 줄을 돌려준다. record가 없으면 의미 있는 줄 전부가 남의 것이다.
export function foreignLines(diff, record) {
  if (record && (record.whole || record.overflow)) return [];
  const out = [];
  for (const raw of String(diff || '').split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    const sign = raw[0];
    if (sign !== '+' && sign !== '-') continue;
    const line = raw.slice(1).trim();
    if (!meaningful(line)) continue;
    const pool = sign === '+' ? record?.add : record?.del;
    if (!pool || !pool.includes(line)) out.push(`${sign} ${line}`);
  }
  return out;
}
