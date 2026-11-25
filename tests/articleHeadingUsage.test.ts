import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * T-211 조 번호와 제목을 손으로 잇는 자리가 없다 (SRS POLICY-10).
 *
 * 이 작업 전에는 같은 "번호+제목"이 화면마다 `제1조 목적`·`제1조 (목적)`·`제1조(목적)`으로 갈라져 있었다 —
 * 호출부마다 문자열을 직접 이었기 때문이다. 표기는 `apps/web/src/lib/articleHeading.ts` 와
 * `apps/api/src/common/article-label.ts` 의 함수로만 만든다. 화면 컴포넌트의 호출부는 단위 시험으로
 * 하나하나 그리기 어려워, 손으로 잇는 꼴이 다시 생기는지를 소스에서 본다. 줄을 넘는 JSX 도 보도록 파일 전체를 훑는다.
 * 잡지 못하는 꼴(변수에 담았다가 잇기 등)은 남는다 — 이 시험은 그물이지 증명이 아니다.
 */
const ROOT = join(__dirname, '..');
const SOURCES = ['apps/web/src', 'apps/api/src'];

/** 표기를 정의하는 파일 — 여기서만 번호와 제목을 잇는다 */
const DEFINITIONS = ['apps/web/src/lib/articleHeading.ts', 'apps/api/src/common/article-label.ts'];

/** 일부러 남긴 자리와 이유. 개수가 늘면 시험이 실패한다(줄어드는 것은 괜찮다) — 새 자리는 표기 함수를 쓴다 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'apps/api/src/ask/ask-text.ts': { count: 2, why: 'AI 에 주는 글 형식(목차 줄·근거 줄) — 바꾸면 답 검사에 영향(T-211 완료 정의 ⑤)' },
  'apps/api/src/ask/ask-law-context.ts': { count: 2, why: 'AI 에 주는 법령 조문 줄 — 법령 표기' },
  'apps/api/src/ask/ask.service.ts': { count: 1, why: '규정 질문 응답의 참고 조문 라벨 — 규정 질문 화면 개편 작업이 고치는 파일' },
  'apps/api/src/lawgokr/lawgokr.mapper.ts': { count: 1, why: '법제처 법령 조문의 라벨 — 법령 표기' },
  'apps/api/src/regulation-parse/regulation-parse.service.ts': { count: 1, why: '법령 이름을 괄호로 덧붙인 오류 문구 — 조 머리가 아니다' },
  'apps/web/src/components/AskAnswer.tsx': { count: 3, why: '법령 조문 인용 2곳(법령 표기)과 규정 근거 1곳 — 규정 질문 화면 개편 작업이 고치는 파일' },
  'apps/web/src/components/LawLinksPanel.tsx': { count: 1, why: '법령 조문 고르기 — 법령 표기' },
  'apps/web/src/pages/ReparseReviewPage.tsx': { count: 2, why: '재파싱 검토 — 장·조·항이 섞인 파싱 노드의 라벨과 제목' },
};

/** 번호를 만드는 함수 — 인자 안에 괄호 한 겹까지(`formatArticleJo(Number(a.number), …)`) */
const NUMBER_CALL = String.raw`(?:formatArticleJo|formatJo|articleShortLabel|formatArticleAnchor|formatArticleLabel)\((?:[^()]|\([^()]*\))*\)`;
/** 번호 글을 담은 변수 이름 */
const NUMBER_VAR = String.raw`(?:anchor|[\w$.?]*(?:[aA]nchor|[lL]abel))`;
/** 사이에 낄 수 있는 것 — 닫는 태그, 여는 태그(속성 포함), `{' '}` */
const BETWEEN = String.raw`\s*(?:<\/[\w.]+>\s*)?(?:<[\w.]+[^>]*>\s*)?(?:\{'\s*'\}\s*)?`;

/** 손으로 잇는 꼴 — 파일 전체에 건다(g). 줄바꿈·`{' '}`·형제 요소를 사이에 둔 JSX 도 잡는다 */
const PATTERNS: [name: string, re: RegExp][] = [
  // `(${a.title})` — 제목을 괄호로 직접 감싼다(템플릿 문자열)
  ['괄호 감싸기', /\(\$\{[^}]*[tT]itle[^}]*\}\)/g],
  // `({a.title})` — 같은 것을 JSX 글로
  ['JSX 괄호 감싸기', /\(\{[a-zA-Z_$][\w$.?]*[tT]itle\}\)/g],
  // `{formatArticleJo(…)} {a.title}`, `${articleShortLabel(a)} ${a.title}`, `{formatArticleAnchor(x)}</span><span>{x.title}` — 번호 뒤에 제목
  ['번호 뒤 제목', new RegExp(NUMBER_CALL + String.raw`\}?` + BETWEEN + String.raw`\$?\{[^}]*[tT]itle`, 'g')],
  // `{anchor}</Link><span>{a.title}`, `{c.label} {c.title}` — 번호 글을 담은 변수 뒤에 제목(JSX)
  ['변수 뒤 제목', new RegExp(String.raw`\{` + NUMBER_VAR + String.raw`\}` + BETWEEN + String.raw`\{[\w$.?]*[tT]itle\}`, 'g')],
  // `${anchor} ${fav.article.title}` — 같은 것을 템플릿 문자열로
  ['템플릿 변수 뒤 제목', new RegExp(String.raw`\$\{` + NUMBER_VAR + String.raw`\}\s*\$\{[^}]*[tT]itle`, 'g')],
];

/** 걸린 자리 — 같은 줄에서 시작하면 한 자리로 센다(한 줄이 두 꼴에 함께 걸릴 수 있다) */
function hitsIn(text: string): string[] {
  const lineOf = (index: number) => text.slice(0, index).split('\n').length;
  const byLine = new Map<number, string>();
  for (const [name, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const line = lineOf(m.index ?? 0);
      if (!byLine.has(line)) byLine.set(line, `${line}: [${name}] ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, hit]) => hit);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

function handJoined(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of SOURCES.flatMap((d) => walk(join(ROOT, d)))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (DEFINITIONS.includes(rel)) continue;
    const hits = hitsIn(readFileSync(file, 'utf8'));
    if (hits.length) found.set(rel, hits);
  }
  return found;
}

describe('조 번호와 제목은 표기 함수로만 잇는다 (T-211 ③)', () => {
  const found = handJoined();

  it('일부러 남긴 자리 말고는 손으로 잇는 곳이 없다', () => {
    const unexpected = [...found].filter(([file]) => !ALLOWED[file]).map(([file, hits]) => `${file}\n  ${hits.join('\n  ')}`);
    expect(unexpected, '조 머리는 formatArticleHeading·articleRowHeading(web), formatArticleRowHeading(api)으로 적는다').toEqual([]);
  });

  it.each(Object.entries(ALLOWED))('남긴 자리가 늘지 않는다: %s', (file, { count, why }) => {
    expect((found.get(file) ?? []).length, `${why}\n${(found.get(file) ?? []).join('\n')}`).toBeLessThanOrEqual(count);
  });

  it.each([
    ['템플릿 괄호', "{article.title ? ` (${article.title})` : ''}"],
    ['JSX 괄호 — 이 작업 전의 편집 창 제목', '조문 편집 · {articleShortLabel(selectedArticle)} ({selectedArticle.title})'],
    ['JSX 번호 뒤 제목 — 이 작업 전의 검색 제안', '{formatArticleJo(a.number, a.branchNumber)} {a.title}'],
    ['줄을 넘는 JSX', "{formatArticleJo(g.number, g.branchNumber)}\n                      {' '}\n                      {g.title}"],
    ['템플릿 번호 뒤 제목 — 이 작업 전의 시행 예정 목록', "`${formatJo(article.number, article.branchNumber)}${article.title ? ` ${article.title}` : ''}`"],
    ['템플릿 짧은 라벨 뒤 제목 — 이 작업 전의 조문 이동 목록', '`${toKoreanOrdinal(ch.number)}장 · ${articleShortLabel(a)} ${a.title || \'\'}`'],
    ['자리 표기 뒤 제목', "{formatArticleAnchor(liveAnchorOf(a))}\n{a.liveTitle ? ` (${a.liveTitle})` : ''}"],
    ['JSX 라벨 뒤 제목', '{m.stored?.label} {m.stored?.title}'],
    ['형제 요소 — 이 작업 전의 개정 검토 목록', '<span className="text-navy-700">{formatArticleAnchor(row.article)}</span>\n          <span className="text-gray-700">{row.article.title}</span>'],
    ['링크 밖 형제 — 이 작업 전의 개정 후보 상세', '{data.policy.title} {formatArticleAnchor(data.article)}\n        </Link>\n        <span className="font-normal text-gray-700">{data.article.title}</span>'],
    ['변수 — 이 작업 전의 법령 영향', '{anchor}\n        </Link>\n        <span className="text-gray-700">{item.article.title}</span>'],
    ['템플릿 변수 — 이 작업 전의 즐겨찾기', 'return fav.article.title ? `${anchor} ${fav.article.title}` : anchor;'],
    ['인자 안 괄호', '`${formatArticleJo(Number(a.number), a.branchNumber)} ${a.title}`'],
  ])('잡는 꼴: %s', (_name, text) => {
    expect(hitsIn(text).length, text).toBeGreaterThan(0);
  });

  it.each([
    ['표기 함수', '{formatArticleHeading(a.number, a.branchNumber, a.title)}'],
    ['조문이 아닌 괄호 — 주소', "lines.push(`- [${label}] ${title}${url ? ` (${url})` : ''}`);"],
    ['객체 리터럴', "setForm((f) => ({ ...f, title }));"],
    ['검색 대상 묶음(배열로 잇는다)', '[tocArticleLabel(article), articleShortLabel(article), article.title].join(\' \')'],
  ])('잡지 않는 꼴: %s', (_name, text) => {
    expect(hitsIn(text), text).toEqual([]);
  });
});

describe('목차 묶음은 장 전체 행으로 조 제목을 추정한다 — 규정 상세 화면의 연결 (T-211)', () => {
  // 목차 묶음(TocArticleGroups)은 절별·검색별로 걸러진 행을 받는다. 조 제목은 filterTocChapters 가 실어 준
  // 장 전체 행(allArticles)으로 추정해야 보는 방법에 따라 조 머리가 바뀌지 않는다 — 호출부마다 넘기는지 소스에서 본다
  const page = readFileSync(join(ROOT, 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');

  it('목차 묶음을 그리는 곳마다 titleRows={chapter.allArticles} 를 넘긴다', () => {
    const calls = page.split('<TocArticleGroups').slice(1).map((s) => s.slice(0, s.indexOf('/>')));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('titleRows={chapter.allArticles}');
  });

  it('목차에 그릴 장은 filterTocChapters 로 만든다', () => {
    expect(page).toContain('filterTocChapters(policy?.chapters, tocQuery)');
  });
});
