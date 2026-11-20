import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldClearFlash } from '../apps/web/src/lib/flashMessage';

/**
 * T-215 규정 상세 도구 줄의 잠깐 알림(lib/flashMessage)과 최근 값 상자(lib/useLatest) — 6·7·8차 검토 반영.
 * 성공 알림만 잠깐 보이고, 그사이 실패 문구로 바뀌었거나 같은 알림을 다시 띄웠으면 앞 타이머가 지우지 않는다.
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('잠깐 알림 — 지울 때가 됐는가 (T-215 검토)', () => {
  it('자기가 띄운 알림이 그대로이고 그 뒤에 다시 띄운 적이 없을 때만 지운다', () => {
    expect(shouldClearFlash('저장했습니다', '저장했습니다', 3, 3)).toBe(true);
    // 그사이 실패 문구로 바뀌었다 — 남긴다
    expect(shouldClearFlash('요청이 거절되었습니다(오류 413)', '저장했습니다', 3, 3)).toBe(false);
    // 같은 알림을 다시 띄웠다 — 앞 타이머는 지우지 않는다(뒤에 띄운 것이 제 시간을 갖는다)
    expect(shouldClearFlash('저장했습니다', '저장했습니다', 4, 3)).toBe(false);
  });

  it('훅은 띄우고, 번호를 올리고, 시간이 지나면 이 판단으로만 지운다', () => {
    const hook = src('apps/web/src/lib/flashMessage.ts');
    // 번호 상자는 그리기마다 새로 만들지 않는다(새로 만들면 같은 알림을 다시 띄웠을 때 앞 타이머가 지운다)
    expect(hook).toContain('const [counter] = useState(() => ({ seq: 0 }));');
    expect(hook).toMatch(/const mine = \+\+counter\.seq;\s*setMessage\(msg\);\s*setTimeout\(\(\) => \{\s*const latest = counter\.seq;\s*setMessage\(\(m\) => \(shouldClearFlash\(m, msg, latest, mine\) \? '' : m\)\);\s*\}, ms\);/);
    // 최근 값 상자(시행 창이 어느 규정의 것인지)도 한 번만 만들고, 그린 직후(같은 동기 구간)에 바꾼다
    const latest = src('apps/web/src/lib/useLatest.ts');
    expect(latest).toContain('const [box] = useState(() => ({ current: value }));');
    expect(latest).toMatch(/useLayoutEffect\(\(\) => \{\s*box\.current = value;\s*\}\);/);
  });
});
