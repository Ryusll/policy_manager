import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ImportPolicyDocumentDto } from '../apps/api/src/policies/policy-import.dto';
import { inConfirmWindow as serverInWindow } from '../apps/api/src/amendments/amendment-catchup-rules';
import { linkReachesEvent } from '../apps/api/src/law-changes/law-link-reach';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { citeNodeKey, inConfirmWindow, normalizeLawName, reaches, windowStart, kstToday } from '../scripts/demo/lib/law-match.mjs';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { citesOf, loadDemoPolicies, sourceNameOf, toImportBody, validateDemoPolicies } from '../scripts/demo/lib/demo-policies.mjs';

/**
 * T-216 영업 시연 데이터 — 시연 규정 파일(직접 쓴 예시)과 스크립트의 규칙이 서버 규칙과 같은지.
 * 창(오늘 − 30일)·닿는 판정은 서버 함수를 그대로 불러 맞댄다 — 한쪽만 바뀌면 이 시험이 깨진다.
 */
type Cite = { code: string; number: number; branchNumber: number | null; clauseNumber: number | null; law: string; label: string; nodeKey: string };
const demo = loadDemoPolicies() as { code: string; title: string; chapters: { articles: { number: number; clauses?: unknown[]; cites?: unknown[] }[] }[] }[];

describe('시연 규정 파일 (T-216 ①)', () => {
  it('5~10개, 코드가 겹치지 않고, 꼴 검사에 문제가 없다', () => {
    expect(demo.length).toBeGreaterThanOrEqual(5);
    expect(demo.length).toBeLessThanOrEqual(10);
    expect(new Set(demo.map((d) => d.code)).size).toBe(demo.length);
  });

  it('가져오기 본문이 서버 검증(ImportPolicyDocumentDto)을 통과한다 — 이 스크립트의 표시(sourceName)를 싣는다', () => {
    // 검증이 실제로 도는지 먼저 본다(장식자가 안 붙으면 무엇이든 통과한다)
    const broken = { ...toImportBody(demo[0]), code: '', chapters: [] };
    expect(validateSync(plainToInstance(ImportPolicyDocumentDto, broken)).length).toBeGreaterThan(0);
    for (const doc of demo) {
      const body = toImportBody(doc);
      const errors = validateSync(plainToInstance(ImportPolicyDocumentDto, body), { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.map((e) => e.toString()), doc.code).toEqual([]);
      expect(body.log.sourceName).toBe(sourceNameOf(doc.code));
    }
  });

  it('항 행은 ①② 표식 없이 글만 싣고(번호는 화면이 붙인다), 항이 있는 조의 머리 행은 본문이 없다', () => {
    const rows = demo.flatMap((d) => toImportBody(d).chapters.flatMap((ch: { articles: { clauseNumber?: number; content: string }[] }) => ch.articles));
    const clauseRows = rows.filter((r) => r.clauseNumber);
    expect(clauseRows.length).toBeGreaterThan(20);
    for (const r of clauseRows) expect(r.content).not.toMatch(/^[①-⑳]/);
    const hr = toImportBody(demo.find((d) => d.code === 'HR-01')).chapters[1].articles;
    expect(hr[0]).toMatchObject({ number: 3, title: '근로시간', content: '' });
    expect(hr[1]).toMatchObject({ number: 3, clauseNumber: 1, title: '' });
  });

  it('인용은 모두 실제 법령 조항 표기이고, 시연 규정마다 하나 이상 — 항이 있는 조는 인용을 항에 단다', () => {
    const cites: Cite[] = demo.flatMap(citesOf);
    expect(cites.length).toBeGreaterThanOrEqual(30);
    for (const c of cites) expect(c.nodeKey, `${c.code} ${c.label}`).toMatch(/^\d+(의\d+)?\/\d*\/\d*$/);
    for (const d of demo) expect(cites.some((c) => c.code === d.code), d.code).toBe(true);
    const laws = new Set(cites.map((c) => normalizeLawName(c.law)));
    expect([...laws].sort()).toEqual(
      ['근로기준법', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', '근로자퇴직급여 보장법', '상법', '개인정보 보호법', '산업안전보건법'].map(normalizeLawName).sort(),
    );
    // 꼴 검사가 조 머리 인용을 막는다
    const bad = { code: 'X', title: 'x', effectiveDate: '2025-01-01', chapters: [{ number: 1, title: 'x', articles: [{ number: 1, title: 'x', clauses: ['a'], cites: [{ law: '상법', article: '제1조' }] }] }] };
    expect(validateDemoPolicies([{ file: 'x.json', doc: bad }]).join()).toContain('항이 있는 조는 인용을 항에 단다');
  });

  it('꼴 검사는 겹치는 코드·이상한 인용·시행일 없음을 잡는다', () => {
    const doc = (over: object) => ({ code: 'A', title: 't', effectiveDate: '2025-01-01', chapters: [{ number: 1, title: 'c', articles: [{ number: 1, title: 'a', content: '본문', cites: [{ law: '상법', article: '제1조' }] }] }], ...over });
    expect(validateDemoPolicies([{ file: 'a', doc: doc({}) }])).toEqual([]);
    expect(validateDemoPolicies([{ file: 'a', doc: doc({}) }, { file: 'b', doc: doc({}) }]).join()).toContain('code 가 겹친다');
    expect(validateDemoPolicies([{ file: 'a', doc: doc({ effectiveDate: undefined }) }]).join()).toContain('effectiveDate');
    const badCite = doc({ chapters: [{ number: 1, title: 'c', articles: [{ number: 1, title: 'a', content: 'x', cites: [{ law: '상법', article: '1조' }] }] }] });
    expect(validateDemoPolicies([{ file: 'a', doc: badCite }]).join()).toContain('인용 표기가 이상하다');
  });
});

describe('스크립트 규칙이 서버 규칙과 같다 (T-216 ②)', () => {
  it('인용 표기 → 법령 조항 키', () => {
    expect(citeNodeKey('제60조')).toBe('60//');
    expect(citeNodeKey('제60조제5항')).toBe('60/5/');
    expect(citeNodeKey('제61조제1항제1호')).toBe('61/1/1');
    expect(citeNodeKey('제76조의2')).toBe('76의2//');
    expect(citeNodeKey('제18조의2제3항')).toBe('18의2/3/');
    for (const bad of ['60조', '제60조 제5항', '제조', '']) expect(citeNodeKey(bad), bad).toBeNull();
  });

  it('변경이 연결 조항에 닿는가 — 서버 linkReachesEvent 와 같다(조·항·호, 제600조·제60조의2 는 제60조가 아니다)', () => {
    const keys = ['60//', '60/5/', '60/5/1', '60/6/', '600//', '60의2//', '60의2/1/', '61/1/1', '61/1/', '61//', '6//'];
    for (const link of keys) {
      for (const ev of keys) {
        expect(reaches(link, ev), `${link} ← ${ev}`).toBe(linkReachesEvent({ lawId: 'L', nodeKey: link }, { lawId: 'L', nodeKey: ev }));
      }
    }
  });

  it('확정 때 후보가 생기는 창 — 서버 inConfirmWindow 와 같다(오늘 − 30일 그날 포함, 미래 시행 포함, 시행일 없으면 밖)', () => {
    const today = '2026-11-19';
    expect(windowStart(today)).toBe('2026-10-20');
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-11-19', '2027-06-10', '2020-01-01', null]) {
      const server = serverInWindow({ lawEffectiveDate: d ? new Date(`${d}T00:00:00Z`) : null }, new Date(`${today}T00:00:00Z`));
      expect(inConfirmWindow(d, today), String(d)).toBe(server);
    }
    expect(kstToday(new Date('2026-11-19T15:30:00Z'))).toBe('2026-11-20');
    expect(kstToday(new Date('2026-11-19T14:59:00Z'))).toBe('2026-11-19');
  });

  it('법령 이름은 띄어쓰기·가운뎃점을 빼고 맞춘다', () => {
    expect(normalizeLawName('남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률')).toBe(normalizeLawName('남녀고용평등과 일·가정 양립 지원에 관한 법률'));
    expect(normalizeLawName('개인정보 보호법')).toBe(normalizeLawName('개인정보보호법'));
    expect(normalizeLawName('상법')).not.toBe(normalizeLawName('상법 시행령'));
  });
});
