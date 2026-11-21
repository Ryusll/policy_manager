import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nextDialogToken, registerWriteDialog, sameDialog, writeDialogFor } from '../apps/web/src/lib/writeDialogs';
import { bannerFor, bannerOf, bannersOf, registerBanner } from '../apps/web/src/lib/articleBanner';
import type { ToolStatus } from '../apps/web/src/lib/toolStatus';

/**
 * T-224 단계 B(설계 E1·E2) — 쓰기 창 등록부는 창을 열 때마다 새 번호를 매기고, 쓰기가 시작할 때 잡은 번호의 창이 아직 열려 있을 때만
 * 그 창을 돌려준다(진행 중에 닫았거나 다시 열었으면 결과는 배너·도구 줄·알림으로). 조문 배너 등록부는 그 규정·그 조문을 보이는 화면의
 * 배너를 찾는다. 둘 다 해제는 자기가 건 것일 때만.
 */
const controls = (token: number) => ({ token, setError: vi.fn(), close: vi.fn() });
const status = () => ({ flash: vi.fn() }) as unknown as ToolStatus;

describe('쓰기 창 등록부 (T-224 단계 B — writeDialogs)', () => {
  it('열 때마다 새 번호 — 시작할 때 잡은 번호의 창이 아직 열려 있을 때만 돌려준다', () => {
    const a = nextDialogToken();
    const b = nextDialogToken();
    expect(b).toBeGreaterThan(a);
    const first = controls(a);
    const off = registerWriteDialog('P1', 'approve', first);
    expect(sameDialog('P1', 'approve', a)).toBe(first);
    expect(sameDialog('P1', 'approve', b)).toBeUndefined(); // 다른 번호(다시 연 창)
    expect(sameDialog('P1', 'reject', a)).toBeUndefined(); // 다른 종류
    expect(sameDialog('P2', 'approve', a)).toBeUndefined(); // 다른 규정
    expect(sameDialog('P1', 'approve', null)).toBeUndefined(); // 창 없이 시작한 쓰기
    off();
    expect(writeDialogFor('P1', 'approve')).toBeUndefined(); // 닫았다
  });

  it('해제는 자기가 건 것일 때만 — 새로 그린 화면이 먼저 다시 걸었으면 그대로 둔다', () => {
    const oldOne = controls(nextDialogToken());
    const offOld = registerWriteDialog('P1', 'archive', oldOne);
    const newOne = controls(nextDialogToken());
    const offNew = registerWriteDialog('P1', 'archive', newOne);
    offOld();
    expect(writeDialogFor('P1', 'archive')).toBe(newOne);
    offNew();
    expect(writeDialogFor('P1', 'archive')).toBeUndefined();
  });
});

describe('창·배너 훅의 차례 (T-224 단계 B — 그리기는 DOM 시험 환경이 없어 원문으로)', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', 'apps/web/src/lib', f), 'utf8');
  it('창을 열면 앞 실패를 비우고 새 번호를 매긴다(E14), 닫으면 실패도 비운다 — 등록은 그린 직후', () => {
    const s = src('writeDialogs.ts');
    expect(s).toMatch(/const open = useCallback\(\(target: T\) => \{\s*setError\(null\);\s*setState\(\{ target, token: nextDialogToken\(\) \}\);/);
    expect(s).toMatch(/const close = useCallback\(\(\) => \{\s*setState\(null\);\s*setError\(null\);/);
    expect(s).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!policyId \|\| token === null\) return undefined;\s*return registerWriteDialog\(policyId, kind, \{ token, setError, close \}\);/);
  });

  it('조문을 바꾸면 배너를 걷고, 조문을 고른 동안 늘 등록해 보이는지는 표시로 둔다 — 받기 실패 줄은 받으면 걷힌다', () => {
    const s = src('articleBanner.ts');
    expect(s).toMatch(/useLayoutEffect\(\(\) => \{\s*status\.clear\(\);\s*\}, \[articleId, status\]\);/);
    expect(s).toContain('() => (policyId && articleId ? registerBanner(policyId, articleId, status, shown) : undefined),'); // 보이지 않아도 등록(shown 은 표시만)
    expect(s).toContain('useClearStaleOnReceive(qc, status);');
  });
});

describe('조문 배너 등록부 (T-224 단계 B — articleBanner)', () => {
  it('그 규정·그 조문을 보이는 화면의 배너만 — 조문이 없으면 찾지 않는다, 해제는 자기 것만', () => {
    const s1 = status();
    const off1 = registerBanner('P1', 'A1', s1);
    expect(bannerFor('P1', 'A1')).toBe(s1);
    expect(bannerFor('P1', 'A2')).toBeUndefined();
    expect(bannerFor('P2', 'A1')).toBeUndefined();
    expect(bannerFor('P1', undefined)).toBeUndefined();
    const s2 = status();
    const off2 = registerBanner('P1', 'A1', s2);
    off1();
    expect(bannerFor('P1', 'A1')).toBe(s2);
    off2();
    expect(bannerFor('P1', 'A1')).toBeUndefined();
  });

  it('보이지 않는 배너(전문 보기)는 결과를 받지 않지만, 그 규정의 배너 목록에는 남아 같은 판의 성공이 옛 줄을 걷을 수 있다(B1 검토)', () => {
    const hidden = status();
    const off = registerBanner('P1', 'A1', hidden, false);
    expect(bannerFor('P1', 'A1')).toBeUndefined();
    expect(bannerOf('P1', 'A1')).toBe(hidden); // 그 조문의 배너는 보이지 않아도 찾는다(반영된 결과가 다른 자리로 가면 비운다)
    expect(bannerOf('P1', undefined)).toBeUndefined();
    expect(bannersOf('P1')).toEqual([hidden]);
    expect(bannersOf('P2')).toEqual([]);
    off();
    expect(bannersOf('P1')).toEqual([]);
  });
});
