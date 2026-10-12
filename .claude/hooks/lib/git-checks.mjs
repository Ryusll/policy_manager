// git-guard가 경로마다 하는 검사: 로컬 전용 파일, 공개되면 안 되는 값, 이 세션이 쓰지 않은 줄.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './hook-lib.mjs';
import { foreignLines } from './edits.mjs';
import { scanDiff } from './leaks.mjs';

export function isLocalOnly(rel, localOnly) {
  const r = rel.normalize('NFC');
  return localOnly.some((p) => (p.endsWith('/') ? r.startsWith(p) : r === p.normalize('NFC')));
}

// pathspec 아래에서 바뀐 파일(새 파일 포함). 결과 경로는 저장소 루트 기준.
export function changedUnder(root, dir, pathspecs, env) {
  const r = run('git', ['status', '--porcelain', '-z', '-uall', '--', ...pathspecs], dir, 8000, env);
  if (r.code !== 0) return [];
  const parts = r.raw.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const code = parts[i].slice(0, 2);
    out.push({ code, file: parts[i].slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i += 1; // 이름 바꾸기는 옛 이름이 뒤따른다
  }
  return out;
}

// 인덱스에 올라간 파일. 지운 것은 code 에 D 가 들어간다.
export function stagedFiles(root, env) {
  const r = run('git', ['diff', '--cached', '--name-status', '-z'], root, 8000, env);
  if (r.code !== 0) return [];
  const parts = r.raw.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const status = parts[i];
    const renamed = /^[RC]/.test(status);
    const file = parts[i + (renamed ? 2 : 1)];
    i += renamed ? 2 : 1;
    if (file) out.push({ code: `${status[0]} `, file });
  }
  return out;
}

// --pathspec-from-file=<파일> 로 넘긴 경로들
export function pathspecFromFile(dir, opts, args) {
  const at = args.findIndex((a) => a === '--pathspec-from-file' || a.startsWith('--pathspec-from-file='));
  if (at < 0) return [];
  const file = args[at].includes('=') ? args[at].split('=').slice(1).join('=') : args[at + 1];
  let text;
  try {
    text = fs.readFileSync(path.resolve(dir, file || ''), 'utf8');
  } catch {
    return [];
  }
  const sep = opts.includes('--pathspec-file-nul') ? '\0' : '\n';
  return text.split(sep).map((p) => p.trim()).filter(Boolean);
}

// 작업 트리 대 HEAD(또는 인덱스 대 HEAD)의 diff. 새 파일은 내용 전체를 + 줄로 만든다.
export function diffOf(root, entry, { staged = false, env } = {}) {
  if (entry.code === '??') {
    let text;
    try {
      text = fs.readFileSync(path.join(root, entry.file), 'utf8');
    } catch {
      return '';
    }
    return `+++ b/${entry.file}\n` + text.split('\n').map((l) => `+${l}`).join('\n');
  }
  const args = staged ? ['diff', '--cached', '--no-color', 'HEAD', '--', entry.file]
    : ['diff', '--no-color', 'HEAD', '--', entry.file];
  const r = run('git', args, root, 15000, env);
  return r.code === 0 ? r.raw : '';
}

// 한 파일 검사. 결과: { local, leaks, foreign, badLines }
export function inspect(root, entry, diff, cfg, edits) {
  const res = { file: entry.file, local: false, leaks: [], foreign: [], badLines: [] };
  if (entry.code.includes('D')) return res; // 지우는 것은 올리는 내용이 없어 판정하지 않는다
  if (isLocalOnly(entry.file, cfg.git.localOnly)) {
    res.local = true;
    return res;
  }
  res.leaks = scanDiff(diff);
  for (const pattern of cfg.git.localOnlyLines) {
    if (diff.split('\n').some((l) => l.startsWith('+') && !l.startsWith('+++') && l.includes(pattern))) {
      res.badLines.push(pattern);
    }
  }
  res.foreign = foreignLines(diff, edits.files[entry.file]);
  return res;
}

// 검사 결과를 사람이 읽을 문장으로. allowForeign이면 남의 줄은 문제로 치지 않는다(덮어쓰기 표시).
export function describe(results, { allowForeign = false, mineOverride }) {
  const lines = [];
  for (const r of results) {
    if (r.local) lines.push(`${r.file}: 로컬 전용 파일입니다 — 커밋하지 않습니다.`);
    if (r.badLines.length) lines.push(`${r.file}: 로컬 전용 줄(${r.badLines.join(', ')})이 들어 있습니다 — 이 줄을 뺀 내용만 올리세요(HEAD+내 줄 blob).`);
    if (r.leaks.length) lines.push(`${r.file}: 공개 저장소에 올리면 안 되는 값(${[...new Set(r.leaks.flatMap((l) => l.kinds))].join(', ')})이 있습니다 — 값을 빼고 환경 변수·.env로 옮기세요.`);
    if (r.foreign.length && !allowForeign) {
      const sample = r.foreign.slice(0, 3).map((l) => `      ${l.slice(0, 100)}`).join('\n');
      lines.push(`${r.file}: 이 세션이 쓰지 않은 줄 ${r.foreign.length}개 — 다른 세션의 미커밋 변경일 수 있습니다.\n${sample}`);
    }
  }
  if (!lines.length) return null;
  const foreign = results.some((r) => r.foreign.length) && !allowForeign;
  if (foreign) {
    lines.push(
      '내 줄만 올리려면: git show HEAD:<파일> 에 내 hunk만 적용한 임시 파일을 git hash-object -w 로 blob 으로 만들고 ' +
      'git update-index --cacheinfo 100644,<blob>,<파일> 로 올린 뒤 경로 없이 커밋합니다(/shared-commit skill). ' +
      `git diff 로 직접 보고 모두 이 세션의 줄(Bash로 고친 것 등)이 확실할 때만 명령 앞에 ${mineOverride} 를 붙여 다시 실행하세요.`,
    );
  }
  return lines.join('\n');
}
