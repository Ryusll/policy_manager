import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 비교 화면의 위치 칸이 같은 주소 함수를 쓰는지 (T-229).
 *
 * 대비표와 규정 간 비교는 '변동 없는 조문 숨기기'·'다른 조문만'이 조 머리 행을 숨기므로, 위치 칸이 행 자기 번호만 적으면
 * `1.`·`③`처럼 어느 조인지 모른다(대표 11/20). 두 화면은 `lib/compareTableGroups` 의 주소(`제12조 ② 1.`)를 쓴다 —
 * 화면 그리기 시험 환경이 없어 소스로 본다(그물이지 증명이 아니다. 주소 규칙 자체는 compareTableGroups.test.ts).
 */
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

const SCREENS = [
  'apps/web/src/components/ComparisonTableModal.tsx',
  'apps/web/src/components/ComparisonTable.tsx',
  'apps/web/src/components/CrossPolicyComparePanel.tsx',
];

describe('비교 화면의 위치 칸 (T-229)', () => {
  it.each(SCREENS)('%s 는 행 자기 번호만 적는 짧은 라벨을 쓰지 않는다', (path) => {
    const src = read(path);
    expect(src).not.toMatch(/articleShortLabel|formatClauseHang|formatItemMok/);
    expect(src).not.toMatch(/function articleLabel|function rowLabel/);
  });

  it('대비표 창은 조 묶음으로 그리고, 규정 간 비교는 같은 주소 함수로 위치 칸을 적는다', () => {
    expect(read('apps/web/src/components/ComparisonTableModal.tsx')).toMatch(/groupComparisonRows\(/);
    expect(read('apps/web/src/components/ComparisonTable.tsx')).toMatch(/\{item\.address\}/);
    expect(read('apps/web/src/components/CrossPolicyComparePanel.tsx')).toMatch(/compareAddress\(row\)/);
  });
});
