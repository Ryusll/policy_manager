// .claude/rules/*.md 해석과 paths 매칭. rule-loader hook과 rules 테스트가 함께 쓴다.
// Claude Code(2.1.285 확인)는 paths를 중괄호 확장한 뒤 .gitignore 방식(ignore 라이브러리)으로
// 프로젝트 기준 상대 경로에 맞춘다. 여기서는 이 패키지가 허용하는 문법(*, **, ?, {a,b})만 같은 방식으로 흉내 낸다.
// [ ], !, \ 는 뜻이 달라질 수 있어 rules 테스트가 금지한다.
import fs from 'node:fs';
import path from 'node:path';

// 머리말은 paths 목록 하나만 허용한다. YAML 해석에 실패하면 Claude Code가 paths 없는 규칙(항상 로드)으로
// 취급하므로, 해석이 확실한 모양만 받는다:  paths:\n  - "패턴"
export function parseRule(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { paths: [], body: text, problems: ['머리말(---)이 없습니다. paths가 없으면 모든 세션에 항상 로드됩니다'] };
  const [head, ...items] = m[1].split(/\r?\n/);
  const problems = [];
  if (head !== 'paths:') problems.push('머리말 첫 줄은 "paths:"여야 합니다');
  const paths = [];
  for (const line of items) {
    const item = line.match(/^ {2}- "([^"\\]+)"$/);
    if (item) paths.push(item[1]);
    else problems.push(`머리말 줄 형식이 다릅니다 (  - "패턴"): ${line}`);
  }
  if (!paths.length) problems.push('paths가 비어 있습니다');
  return { paths, body: m[2], problems };
}

// dir 아래 .md를 하위 폴더까지 읽는다. file은 프로젝트 기준 경로(슬래시 구분).
export function loadRules(root, dir = '.claude/rules/') {
  const out = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.md')) {
        const file = path.relative(root, p).split(path.sep).join('/');
        out.push({ file, ...parseRule(fs.readFileSync(p, 'utf8')) });
      }
    }
  };
  walk(path.join(root, dir));
  return out;
}

export function expandBraces(pattern) {
  const m = pattern.match(/\{([^{}]*)\}/);
  if (!m) return [pattern];
  const [before, after] = [pattern.slice(0, m.index), pattern.slice(m.index + m[0].length)];
  return m[1].split(',').flatMap((alt) => expandBraces(before + alt + after));
}

const segment = (seg) => [...seg].map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');

// .gitignore 방식: 슬래시가 있으면 루트 기준, 없으면 모든 폴더에서 이름으로 맞춘다.
// 폴더가 맞으면 그 안의 파일도 맞는다. * 는 점으로 시작하는 이름에도 맞고, 대소문자는 구분하지 않는다(ignore 기본값).
export function globRegExp(glob) {
  const anchored = glob.replace(/\/$/, '').includes('/');
  const segs = glob.replace(/^\//, '').replace(/\/$/, '').split('/');
  let re = '';
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (seg === '**') re += last ? '.*' : '(?:[^/]+/)*';
    else re += segment(seg) + (last ? '' : '/');
  });
  return new RegExp(`^${anchored ? '' : '(?:[^/]+/)*'}${re}(?:/.*)?$`, 'i');
}

export function matchesGlob(rel, glob) {
  return expandBraces(glob).some((g) => globRegExp(g).test(rel));
}

// 형식 문제가 없는 규칙 중 rel(프로젝트 기준 경로)에 맞는 것
export function matchingRules(rules, rel) {
  return rules.filter((r) => !r.problems.length && r.paths.some((g) => matchesGlob(rel, g)));
}
