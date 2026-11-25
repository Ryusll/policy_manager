import { randomInt } from 'crypto';
import { api } from './helpers';
import { FakeLaw, type FakeVersion } from './lawgokr-seed';
import { sql } from './race';

/**
 * T-177 근거 문구 원천 판 시험이 함께 쓰는 자료. 공백·확장 한자 글자는 코드 포인트로 만든다 — 소스에 보이지 않는 글자를 두지 않는다.
 */
export const NBSP = String.fromCharCode(0xa0);
export const IDEO = String.fromCharCode(0x3000);
/** 확장 한자 두 자 — 코드 포인트 2, UTF-16 길이 4 */
export const EXT2 = String.fromCodePoint(0x20000, 0x20001);
export const art = (no: string, title: string, body: string) => ({ no, title, body });
export const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** 오늘(한국 날짜) YYYY-MM-DD — 서버의 "오늘"과 같다 */
export const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
/** 인용 패턴은 숫자 없는 한글 법령명만 잡는다 — 가짜 법령 이름(숫자가 붙는다) 대신 쓴다 */
export const hangulName = (prefix: string) =>
  `${prefix}${Array.from({ length: 5 }, () => String.fromCharCode(0xac00 + randomInt(0, 11172))).join('')}법`;

/** 조문의 판을 통째로 바꿔 심는다 — [id, 판 번호, 상태, 시행일|null, 본문, 폐지일?] */
export function seedVersions(articleId: string, rows: [string, number, string, string | null, string, string?][]) {
  const date = (d: string | null | undefined) => (d ? `'${d}'` : 'NULL');
  const values = rows.map(
    ([id, n, status, eff, content, repealed]) => `('${id}', '${articleId}', ${n}, ${quote(content)}, '${status}', ${date(eff)}, ${date(repealed)}, now())`,
  );
  sql(`DELETE FROM article_versions WHERE article_id='${articleId}';
       INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, repealed_on, updated_at) VALUES ${values.join(',')};`);
}

/** 시험이 등록한 법령과 거기 걸린 후보·이벤트 연결·연결을 지운다 — 남은 법령이 법령 동기화 시험의 순서를 바꾸지 않게(tests 규칙) */
export function dropLaws(lawIds: string[]) {
  if (!lawIds.length) return;
  const ids = lawIds.map((id) => `'${id}'`).join(',');
  sql(`
    DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${ids}));
    UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id IN (${ids}));
    DELETE FROM law_links WHERE law_article_id IN (SELECT id FROM law_articles WHERE law_id IN (${ids}));
    DELETE FROM laws WHERE id IN (${ids});
  `);
}

/** 조 1~n 짜리 가짜 법령을 등록하고 조 번호 → 법령조항 id 를 돌려준다(정리용 법령 id·가짜 법령과 함께) */
export async function registerFakeLaw(token: string, prefix: string, n: number) {
  const law = new FakeLaw(prefix);
  const base: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '701', effective: '20260201', articles: Array.from({ length: n }, (_, i) => art(String(i + 1), `조${i + 1}`, `본문${i + 1}`)) };
  law.seedAll([base]);
  const reg = await api('/laws', { method: 'POST', token, json: { mst: base.mst } });
  if (reg.status !== 200) throw new Error(`가짜 법령 등록 실패(${reg.status}): ${JSON.stringify(reg.body)}`);
  const la: Record<string, string> = {};
  for (const row of sql(`SELECT node_key || '|' || id FROM law_articles WHERE law_id='${reg.body.id}';`).split('\n')) {
    const [key, id] = row.split('|');
    la[key.split('/')[0]] = id;
  }
  return { law, lawId: reg.body.id as string, la };
}
