import { randomUUID } from 'crypto';
import { RegulationArticleNode } from '../regulation-parse/regulation-tree.builder';
import {
  LawDetailMeta,
  LawGoKrHang,
  LawGoKrHo,
  LawGoKrJoUnit,
  LawGoKrLawDetail,
  LawGoKrMok,
  LawGoKrSearchItem,
  LawGoKrTextOrNode,
  LawSearchResultItem,
  OneOrMany,
} from './lawgokr.types';

/**
 * T-54. 법제처 응답(편·장·절 / 조 / 항 / 호 / 목) → 내부 조항 트리(`RegulationArticleNode`).
 *
 * 산출 타입을 PDF 파서(T-51 `regulation-tree.builder`)와 공유하기 때문에, 가져오기 이후
 * 경로(미리보기 편집 `PATCH /regulation-parse/:id/tree`, 커밋)를 그대로 재사용할 수 있다.
 *
 * `articleNumber`에 쓰는 코드도 PDF 파서의 `matchHeader`와 같은 어휘를 쓴다:
 *   조 `L3` · 조의n `L4-2` · 항 `C1`(①) · 호 `1` / `1.2`(1의2) · 목 `H가`
 * 편·장·절은 PDF 파서에 대응 표기가 없어 여기서 새로 정한다: 편 `P1` · 장 `CH1` ·
 * 장의n `CH3-2` · 절 `S1` · 관 `SS1`.
 *
 * 법제처는 계층을 이미 명시적으로 주므로 PDF처럼 정규식으로 계층을 추론하지 않는다.
 * 유일한 예외가 편/장/절 제목 행인데, 그 행의 `조문번호`는 장 번호가 아니라 그 장에
 * 속한 첫 조의 번호라서 `조문내용` 텍스트를 파싱해야 한다.
 */

/** 편/장/절/관의 계층 서열. 숫자가 작을수록 상위 */
const HEADING_RANK: Record<string, number> = { 편: 0, 장: 1, 절: 2, 관: 3 };
const HEADING_CODE: Record<string, string> = { 편: 'P', 장: 'CH', 절: 'S', 관: 'SS' };

/** "제1장 총칙 <개정 2009.2.6>" · "제3장의2 저속전기자동차에 대한 특례" */
const HEADING_RE = /^제\s*(\d+)\s*(편|장|절|관)(?:\s*의\s*(\d+))?\s*(.*)$/;

/** 본문 끝에 붙는 개정 이력 주기 — 제목에서만 떼고 내용에는 남긴다 */
const ANNOTATION_RE = /\s*<[^<>]*>\s*$/;

/** 한 건이면 객체, 여러 건이면 배열로 오는 필드를 배열로 통일 */
function asArray<T>(value: OneOrMany<T> | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 정렬용 선행 공백·비가시 문자를 걷어낸 문자열 */
function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/ /g, ' ').trim();
  if (typeof value === 'number') return String(value);
  return '';
}

/** `{ content: '국토교통부', 소관부처코드: '1613000' }` 또는 평문 문자열 둘 다 받는다 */
function nodeText(value: LawGoKrTextOrNode | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return text(value) || null;
  return text(value.content) || null;
}

/** 법제처 날짜(YYYYMMDD 정수/문자열) → 'YYYY-MM-DD'. 형식이 다르면 null */
export function toIsoDate(value: unknown): string | null {
  const raw = text(value);
  if (!/^\d{8}$/.test(raw)) return null;
  const [y, m, d] = [raw.slice(0, 4), raw.slice(4, 6), raw.slice(6, 8)];
  if (m < '01' || m > '12' || d < '01' || d > '31') return null;
  return `${y}-${m}-${d}`;
}

/** 항번호는 원문자(①②③)로 온다 → 1, 2, 3. 원문자가 아니면 숫자만 뽑는다 */
export function circledToNumber(value: string): number | null {
  const s = text(value);
  if (!s) return null;
  const code = s.codePointAt(0)!;
  // ①(U+2460)~⑳(U+2473)
  if (code >= 0x2460 && code <= 0x2473) return code - 0x2460 + 1;
  const digits = s.match(/\d+/);
  return digits ? Number(digits[0]) : null;
}

/**
 * 내용 앞에 붙은 자기 번호 접두어를 뗀다.
 *
 * 번호 필드로 기대 접두어를 만들어 **정확히 일치할 때만** 자른다. 정규식으로 넓게
 * 자르면 "가. 도난 또는 분실"의 '가'와 본문 첫 글자를 구분하지 못해 내용이 깎인다.
 */
function stripPrefix(content: string, ...candidates: string[]): string {
  let out = content;
  for (const prefix of candidates) {
    if (!prefix) continue;
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length).trim();
      break;
    }
  }
  return out;
}

/** 조문내용에서 "제3조(자동차의 종류)" 머리말을 뗀 나머지 본문 */
function stripArticleHead(content: string, unit: LawGoKrJoUnit): string {
  const number = text(unit.조문번호);
  const branch = text(unit.조문가지번호);
  const title = text(unit.조문제목);
  const label = branch ? `제${number}조의${branch}` : `제${number}조`;

  const exact = title ? `${label}(${title})` : label;
  if (content.startsWith(exact)) return content.slice(exact.length).trim();
  if (content.startsWith(label)) {
    // 제목이 응답과 미세하게 다른 경우(공백·괄호 종류) 괄호 블록까지만 걷어낸다
    const rest = content.slice(label.length);
    const m = rest.match(/^\s*\([^)]*\)/);
    return (m ? rest.slice(m[0].length) : rest).trim();
  }
  return content;
}

/** 노드 하나를 만들면서 문서 순서(sortOrder)를 부여하는 빌더 */
class TreeCursor {
  readonly roots: RegulationArticleNode[] = [];
  private sortOrder = 0;

  add(
    parent: RegulationArticleNode | null,
    fields: Pick<RegulationArticleNode, 'articleNumber' | 'articleTitle' | 'content'>,
  ): RegulationArticleNode {
    const node: RegulationArticleNode = {
      id: randomUUID(),
      articleNumber: fields.articleNumber,
      articleTitle: fields.articleTitle,
      content: fields.content,
      parentId: parent ? parent.id : null,
      depth: parent ? parent.depth + 1 : 0,
      // 법제처 응답에는 면(page) 개념이 없다. PDF 경로와 타입을 맞추기 위해 null.
      pageNumber: null,
      sortOrder: this.sortOrder++,
      children: [],
    };
    if (parent) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      this.roots.push(node);
    }
    return node;
  }
}

function mapMok(cursor: TreeCursor, parent: RegulationArticleNode, mok: LawGoKrMok): void {
  const label = text(mok.목번호); // '가.'
  const bare = label.replace(/[.)]\s*$/, ''); // '가'
  const content = stripPrefix(text(mok.목내용), label, bare);
  if (!content && !bare) return;
  cursor.add(parent, {
    articleNumber: bare ? `H${bare}` : 'H',
    articleTitle: label || bare,
    content,
  });
}

function mapHo(cursor: TreeCursor, parent: RegulationArticleNode, ho: LawGoKrHo): void {
  const label = text(ho.호번호); // '1.'
  const branch = text(ho.호가지번호); // '2' → 1의2
  const bare = label.replace(/[.)]\s*$/, '');
  const printed = branch ? `${bare}의${branch}` : bare;
  const content = stripPrefix(text(ho.호내용), `${printed}.`, `${printed})`, printed);

  const node = cursor.add(parent, {
    articleNumber: branch ? `${bare}.${branch}` : bare,
    articleTitle: printed ? `제${printed}호` : '호',
    content,
  });
  for (const mok of asArray(ho.목)) mapMok(cursor, node, mok);
}

function mapHang(cursor: TreeCursor, article: RegulationArticleNode, hang: LawGoKrHang): void {
  const label = text(hang.항번호); // '①'
  const index = circledToNumber(label);
  const content = stripPrefix(text(hang.항내용), label);

  // 항번호 없는 단일 항 = 조 본문 그 자체. 노드를 새로 파지 않고 조에 합친다.
  // (호가 달려 있으면 그 호들은 조의 직속 자식이 된다.)
  if (!label) {
    if (content) article.content = article.content ? `${article.content}\n${content}` : content;
    for (const ho of asArray(hang.호)) mapHo(cursor, article, ho);
    return;
  }

  const node = cursor.add(article, {
    articleNumber: index ? `C${index}` : `C${label}`,
    articleTitle: index ? `제${index}항` : label,
    content,
  });
  for (const ho of asArray(hang.호)) mapHo(cursor, node, ho);
}

/** 편/장/절 제목 행이면 파싱 결과를, 아니면 null */
function parseHeading(unit: LawGoKrJoUnit): {
  rank: number;
  articleNumber: string;
  articleTitle: string;
  content: string;
} | null {
  const content = text(unit.조문내용);
  const m = content.match(HEADING_RE);
  if (!m) return null;
  const [, number, kind, branch, rest] = m;
  const rank = HEADING_RANK[kind];
  if (rank == null) return null;
  const code = HEADING_CODE[kind];
  const label = branch ? `제${number}${kind}의${branch}` : `제${number}${kind}`;
  return {
    rank,
    articleNumber: branch ? `${code}${number}-${branch}` : `${code}${number}`,
    articleTitle: (rest || '').replace(ANNOTATION_RE, '').trim() || label,
    content,
  };
}

/**
 * 조문단위 배열 → 조항 트리.
 *
 * 편/장/절은 서열 스택으로 중첩한다(편이 없는 법령이면 장이 곧 최상위가 된다).
 * 조는 현재 열려 있는 가장 깊은 제목 아래로, 항·호·목은 조 아래로 붙는다.
 */
export function buildTreeFromJoUnits(units: LawGoKrJoUnit[]): { roots: RegulationArticleNode[] } {
  const cursor = new TreeCursor();
  const headingStack: { rank: number; node: RegulationArticleNode }[] = [];

  for (const unit of units) {
    const heading = unit.조문여부 === '전문' ? parseHeading(unit) : null;
    if (heading) {
      while (headingStack.length && headingStack[headingStack.length - 1].rank >= heading.rank) {
        headingStack.pop();
      }
      const parent = headingStack.length ? headingStack[headingStack.length - 1].node : null;
      const node = cursor.add(parent, {
        articleNumber: heading.articleNumber,
        articleTitle: heading.articleTitle,
        content: heading.content,
      });
      headingStack.push({ rank: heading.rank, node });
      continue;
    }

    const number = text(unit.조문번호);
    const branch = text(unit.조문가지번호);
    // 조문여부가 '전문'인데 편/장/절 형식이 아닌 행(별표 안내문 등)은 본문으로 흘려보낸다.
    if (!number && !text(unit.조문내용)) continue;

    const parent = headingStack.length ? headingStack[headingStack.length - 1].node : null;
    const label = branch ? `제${number}조의${branch}` : `제${number}조`;
    const article = cursor.add(parent, {
      articleNumber: branch ? `L${number}-${branch}` : `L${number}`,
      articleTitle: text(unit.조문제목) || label,
      content: stripArticleHead(text(unit.조문내용), unit),
    });

    for (const hang of asArray(unit.항)) mapHang(cursor, article, hang);
  }

  const stripEmptyChildren = (node: RegulationArticleNode) => {
    if (node.children?.length) node.children.forEach(stripEmptyChildren);
    else delete node.children;
  };
  cursor.roots.forEach(stripEmptyChildren);
  return { roots: cursor.roots };
}

/** `개정문내용`·`제개정이유내용`의 2중 배열을 평문으로 편다 */
function flattenLines(value: string[][] | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .flat()
    .map((line) => text(line))
    .filter(Boolean)
    .join('\n')
    .trim();
  return out || null;
}

/** 본문 응답 → 메타. `mst`는 요청에 쓴 값이라 응답이 아니라 호출자가 넘긴다. */
export function mapLawDetailMeta(detail: LawGoKrLawDetail, mst: string): LawDetailMeta {
  const info = detail.기본정보 || {};
  const lawId = text(info.법령ID) || null;
  return {
    mst,
    lawId,
    title: text(info.법령명_한글),
    shortTitle: text(info.법령명약칭) || null,
    lawType: nodeText(info.법종구분),
    revisionType: text(info.제개정구분) || null,
    ministry: nodeText(info.소관부처),
    promulgationDate: toIsoDate(info.공포일자),
    promulgationNo: text(info.공포번호) || null,
    effectiveDate: toIsoDate(info.시행일자),
    revisionReason: flattenLines(detail.제개정이유?.제개정이유내용),
    amendmentText: flattenLines(detail.개정문?.개정문내용),
    sourceUrl: `https://www.law.go.kr/DRF/lawService.do?target=law&MST=${encodeURIComponent(mst)}&type=HTML`,
  };
}

/** 본문 응답 → 메타 + 조항 트리 */
export function mapLawDetail(
  detail: LawGoKrLawDetail,
  mst: string,
): { meta: LawDetailMeta; tree: { roots: RegulationArticleNode[] } } {
  return {
    meta: mapLawDetailMeta(detail, mst),
    tree: buildTreeFromJoUnits(asArray(detail.조문?.조문단위)),
  };
}

/** 검색 응답 1건 → 정규화 */
export function mapSearchItem(item: LawGoKrSearchItem): LawSearchResultItem {
  return {
    mst: text(item.법령일련번호),
    lawId: text(item.법령ID),
    title: text(item.법령명한글),
    shortTitle: text(item.법령약칭명) || null,
    lawType: text(item.법령구분명) || null,
    revisionType: text(item.제개정구분명) || null,
    ministry: text(item.소관부처명) || null,
    promulgationDate: toIsoDate(item.공포일자),
    promulgationNo: text(item.공포번호) || null,
    effectiveDate: toIsoDate(item.시행일자),
    status: text(item.현행연혁코드) || null,
  };
}
