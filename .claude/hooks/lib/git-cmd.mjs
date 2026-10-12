// 셸 명령에서 git 호출을 뽑아, 어느 작업 트리에서 무엇을 하는지 알려 준다(git-guard 전용).
// cd, git -C, GIT_INDEX_FILE= 같은 앞붙이를 따라가, 메인 트리가 아닌 곳(연결된 worktree,
// 다른 저장소)의 명령과 임시 인덱스로 하는 커밋은 따로 표시한다.
import fs from 'node:fs';
import path from 'node:path';
import { run, words } from './hook-lib.mjs';

const ENV_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

// 연산자(; && || | 줄바꿈)로 나누되 따옴표 안, 명령 치환 $( ) 안, heredoc 본문은 자르지 않는다.
// 명령 치환은 SUBST 한 단어로, heredoc 본문은 지운다 — 커밋 메시지가 경로로 읽히지 않게.
export function segmentsOf(command) {
  const s = String(command || '');
  const out = [];
  let cur = '';
  let quote = null;
  let depth = 0;
  let pendingHeredoc = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (depth > 0) {
      if (c === '(') depth += 1;
      else if (c === ')' && --depth === 0) cur += 'SUBST';
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === '$' && s[i + 1] === '(') { depth = 1; i += 1; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '$' && s[i + 1] === '(') { depth = 1; i += 1; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      const m = s.slice(i).match(/^<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
      if (m) { pendingHeredoc = m[1]; i += m[0].length - 1; continue; }
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||' || c === ';' || c === '|' || c === '\n') {
      out.push(cur);
      cur = '';
      if (two === '&&' || two === '||') i += 1;
      if (c === '\n' && pendingHeredoc) {
        const end = s.indexOf(`\n${pendingHeredoc}\n`, i - 1);
        const endAlt = s.endsWith(`\n${pendingHeredoc}`) ? s.length - pendingHeredoc.length - 1 : -1;
        const at = end >= 0 ? end : endAlt;
        i = at >= 0 ? at + pendingHeredoc.length + 1 : s.length;
        pendingHeredoc = null;
      }
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const toplevelCache = new Map();
// dir이 속한 작업 트리의 최상위. git 밖이면 null.
export function toplevel(dir) {
  if (!toplevelCache.has(dir)) {
    const r = run('git', ['rev-parse', '--show-toplevel'], dir, 3000);
    toplevelCache.set(dir, r.code === 0 ? path.resolve(r.out) : null);
  }
  return toplevelCache.get(dir);
}

// 심볼릭 링크(/var → /private/var 등)를 풀어 같은 폴더인지 본다.
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(process.env.HOME || '', p.slice(1)) : p);

// 반환: [{ sub, args, dir, env, mainTree, raw }]
export function gitCalls(command, root, startDir) {
  const calls = [];
  let cwd = startDir || root;
  const exported = {};
  const vars = {};
  // $NAME·${NAME}을 앞 구간에서 정한 값(또는 환경 변수)으로 푼다. 모르는 변수는 그대로 둔다.
  const expand = (text) => text.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
    (m, k) => vars[k] ?? exported[k] ?? process.env[k] ?? m);
  for (const raw of segmentsOf(command)) {
    const seg = expand(raw);
    const t = words(seg);
    if (!t.length) continue;
    if (t.every((w) => ENV_ASSIGN.test(w))) {
      for (const w of t) {
        const [, k, v] = w.match(ENV_ASSIGN);
        vars[k] = v;
      }
      continue;
    }
    if (t[0] === 'cd') {
      cwd = t[1] ? path.resolve(cwd, expandHome(t[1])) : process.env.HOME || cwd;
      continue;
    }
    if (t[0] === 'export') {
      for (const w of t.slice(1)) {
        const m = w.match(ENV_ASSIGN);
        if (m) exported[m[1]] = m[2];
      }
      continue;
    }
    const env = { ...exported };
    let i = 0;
    while (i < t.length && ENV_ASSIGN.test(t[i])) {
      const [, k, v] = t[i].match(ENV_ASSIGN);
      env[k] = v;
      i += 1;
    }
    if (t[i] === 'env') i += 1;
    if (path.basename(t[i] || '') !== 'git') continue;
    i += 1;
    let dir = cwd;
    let otherRepo = false;
    while (i < t.length && t[i].startsWith('-')) {
      const opt = t[i].split('=')[0];
      if (opt === '-C') dir = path.resolve(dir, expandHome(t[i + 1] || '.'));
      if (opt === '--git-dir' || opt === '--work-tree') otherRepo = true;
      i += GLOBAL_WITH_VALUE.has(t[i]) ? 2 : 1;
    }
    const top = toplevel(dir);
    const mainTree = !otherRepo && top !== null && real(top) === real(root);
    calls.push({ sub: t[i] || '', args: t.slice(i + 1), dir, env, mainTree, raw: seg });
  }
  return calls;
}

// 옵션과 경로를 나눈다. "--" 뒤는 모두 경로. valueOpts는 값을 받는 옵션.
export function splitArgs(args, valueOpts = []) {
  const opts = [];
  const paths = [];
  let rest = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (rest) paths.push(a);
    else if (a === '--') rest = true;
    else if (a.startsWith('-') && a !== '-') {
      opts.push(a);
      if (valueOpts.includes(a) && !a.includes('=')) i += 1;
    } else paths.push(a);
  }
  return { opts, paths, dashdash: args.includes('--') };
}

// 짧은 옵션 묶음(-am)까지 펼쳐서 특정 글자가 있는지 본다.
export function hasShort(opts, letter) {
  return opts.some((o) => /^-[A-Za-z]+$/.test(o) && o.slice(1).includes(letter));
}

export const COMMIT_VALUE_OPTS = ['-m', '-F', '-C', '-c', '--author', '--date', '--cleanup', '--fixup', '--squash',
  '-t', '--template', '--trailer', '-S'];
