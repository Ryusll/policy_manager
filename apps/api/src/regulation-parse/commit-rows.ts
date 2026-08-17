import { RegulationArticleNode } from './regulation-tree.builder';

/**
 * 파싱 트리 → 커밋할 Article 행 목록 (T-88).
 *
 * 이전에는 트리를 평탄화해 **모든 노드를 조(條)로** 만들었다. 그래서 법제처에서
 * 조>항>호 구조를 정확히 받아와도 `①`이 제2조, `1.`이 제3조가 되어 조 번호가 전부 어긋났다.
 *
 * 분류는 `depth`가 아니라 `articleNumber`(norm)로 한다. PDF 파서에서 `제1조의2`는
 * `L1-2`이면서 depth 1로 제1조의 **자식**으로 들어오기 때문에, depth만 보면 항으로 오인한다.
 * norm 어휘는 PDF 빌더와 법제처 매퍼가 공유한다:
 *
 * | norm            | 뜻            | 매핑                    |
 * |-----------------|---------------|-------------------------|
 * | `L1`, `L1-2`    | 조, 조의2     | 조 (번호 새로 부여)      |
 * | `C1`            | ①②…          | 항 (`clauseNumber`)     |
 * | `1`, `1.2`      | 호            | 목 (`itemNumber`)        |
 * | `H가`, `Hp가`   | 가. / (가)    | 목                       |
 * | `PN1`           | (1)           | 목                       |
 * | `P/CH/S/SS`+숫자 | 편·장·절·관   | 조 (T-89에서 실제 장으로) |
 * | `T…`, `PREAMBLE` | 표, 머리말    | 조                       |
 *
 * 우리 모델은 조·항·목 3단인데 법령은 조>항>호>목 4단이다. 남는 한 단(호 아래 목)은
 * 행을 더 만들지 않고 **부모 행 본문에 이어 붙인다** — 가짜 조문을 만드는 것보다 낫다.
 */

export type CommitRow = {
  number: number;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  content: string;
};

type Kind = 'jo' | 'hang' | 'mok';

/** norm 문자열이 무엇인지 판정한다. 모르는 것은 조로 둔다(현재 동작 유지). */
export function classifyNorm(norm: string): Kind {
  const s = (norm || '').trim();
  // 편·장·절·관이 먼저다. `CH1`(장)은 `C…`(항)와, `P1`(편)은 `PN1`(괄호번호)과 앞글자가 겹친다.
  if (/^(P|CH|S|SS)\d/.test(s)) return 'jo';
  if (/^L\d/.test(s)) return 'jo';
  // 원문자 번호를 못 읽으면 매퍼가 `C①`처럼 라벨을 그대로 붙인다. 그래도 항이다.
  if (/^C/.test(s)) return 'hang';
  if (/^(Hp|H)./.test(s)) return 'mok';
  if (/^PN\d+$/.test(s)) return 'mok';
  if (/^\d/.test(s)) return 'mok'; // 호(1., 1.2)
  return 'jo';
}

/**
 * 화면에 보일 제목.
 *
 * 이전에는 `[${norm}] ${title}` 이라 내부 코드가 그대로 새어 나왔다(`[L1] 목적`, `[C1] `).
 * 번호는 이제 `number`/`clauseNumber`/`itemNumber`에 구조로 들어가므로 제목에 넣지 않는다.
 * 항·목은 제목 자체가 없다(본문만 있다).
 */
function titleFor(node: RegulationArticleNode, kind: Kind): string {
  if (kind !== 'jo') return '';
  return (node.articleTitle || '').trim().slice(0, 500);
}

/** 자리를 못 받은 노드의 텍스트를 부모 행에 이어 붙인다 */
function appendTo(row: CommitRow, node: RegulationArticleNode): void {
  const label = (node.articleTitle || '').trim();
  const body = (node.content || '').trim();
  if (!label && !body) return;
  const line = label && body ? `${label} ${body}` : label || body;
  row.content = row.content ? `${row.content}\n${line}` : line;
}

export function buildCommitRows(roots: RegulationArticleNode[]): CommitRow[] {
  const rows: CommitRow[] = [];
  let joNumber = 0;

  /**
   * @param jo      현재 조 번호
   * @param hang    현재 항 번호(없으면 null)
   * @param inMok   이미 목 안이라 더 깊이 들어갈 자리가 없는 상태
   * @param counters 이 조의 항 카운터 / 현재 항의 목 카운터
   * @param owner   자리를 못 받은 텍스트를 붙일 행
   */
  const visit = (
    nodes: RegulationArticleNode[],
    ctx: {
      jo: number;
      hang: number | null;
      inMok: boolean;
      hangCount: { n: number };
      mokCount: { n: number };
      owner: CommitRow | null;
    },
  ): void => {
    for (const node of nodes) {
      const kind = classifyNorm(node.articleNumber);
      const children = node.children || [];

      if (kind === 'jo') {
        joNumber += 1;
        const row: CommitRow = {
          number: joNumber,
          clauseNumber: null,
          itemNumber: null,
          title: titleFor(node, 'jo'),
          content: (node.content || '').trim(),
        };
        rows.push(row);
        visit(children, {
          jo: joNumber,
          hang: null,
          inMok: false,
          hangCount: { n: 0 },
          mokCount: { n: 0 },
          owner: row,
        });
        continue;
      }

      // 조 밖에서 나온 항·목은 붙일 조가 없다. 부모 행에 합쳐 텍스트를 잃지 않는다.
      if (ctx.jo === 0) {
        if (ctx.owner) appendTo(ctx.owner, node);
        visit(children, ctx);
        continue;
      }

      if (kind === 'hang' && !ctx.inMok) {
        ctx.hangCount.n += 1;
        const row: CommitRow = {
          number: ctx.jo,
          clauseNumber: ctx.hangCount.n,
          itemNumber: null,
          title: '',
          content: (node.content || '').trim(),
        };
        rows.push(row);
        visit(children, {
          ...ctx,
          hang: ctx.hangCount.n,
          inMok: false,
          mokCount: { n: 0 },
          owner: row,
        });
        continue;
      }

      // 목: 이미 목 안이면(법령의 호 아래 목) 새 행을 만들지 않고 부모에 이어 붙인다
      if (ctx.inMok) {
        if (ctx.owner) appendTo(ctx.owner, node);
        visit(children, ctx);
        continue;
      }

      ctx.mokCount.n += 1;
      const row: CommitRow = {
        number: ctx.jo,
        // 상위 항이 없는 목은 항 번호를 비운다(전문 보기가 항 위치에 그린다)
        clauseNumber: ctx.hang,
        itemNumber: ctx.mokCount.n,
        title: '',
        content: (node.content || '').trim(),
      };
      rows.push(row);
      visit(children, { ...ctx, inMok: true, owner: row });
    }
  };

  visit(roots, {
    jo: 0,
    hang: null,
    inMok: false,
    hangCount: { n: 0 },
    mokCount: { n: 0 },
    owner: null,
  });
  return rows;
}
