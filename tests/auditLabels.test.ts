import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_GROUPS,
  auditActionLabel,
  auditGroupOf,
  isDestructiveAction,
} from '../apps/web/src/lib/auditLabels';

/**
 * 서버 코드에서 감사 액션 이름을 긁어 온다.
 *
 * 점이 있는 값만 남기는 이유: `orderBy: { action: 'asc' }` 같은 Prisma 정렬 지시가
 * 같은 패턴에 걸린다. 액션 이름은 모두 `분류.동작` 꼴이라 점으로 갈라낼 수 있다.
 */
function serverActions(): string[] {
  const raw = execSync(
    `grep -rho "action: '[^']*'" apps/api/src --include=*.ts | sed "s/action: '//;s/'$//" | sort -u`,
    { encoding: 'utf8' },
  );
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.includes('.'));
}

describe('auditActionLabel (T-11)', () => {
  it('아는 액션은 한국어로 바꾼다', () => {
    expect(auditActionLabel('version.approve')).toBe('시행 승인');
    expect(auditActionLabel('template.restore')).toBe('템플릿 이력 복원');
  });

  it('모르는 액션은 원문 그대로 — 빈칸보다 낫다', () => {
    expect(auditActionLabel('something.new')).toBe('something.new');
  });
});

/**
 * 서버가 새 액션을 기록하기 시작했는데 표시 이름을 안 만들면 화면에 영문 코드가 뜬다.
 * 코드를 직접 훑어 대조한다 — 이름을 추가할 때 여기를 같이 고치게 만드는 것이 목적이다.
 */
describe('표시 이름 누락 감시', () => {
  it('서버가 기록하는 모든 액션에 이름이 있다', () => {
    const actions = serverActions();
    expect(actions.length).toBeGreaterThan(20);

    const missing = actions.filter((a) => !(a in AUDIT_ACTION_LABELS));
    expect(missing, `표시 이름이 없는 액션: ${missing.join(', ')}`).toEqual([]);
  });

  it('쓰이지 않는 이름이 남아 있지 않다', () => {
    const actions = new Set(serverActions());
    const stale = Object.keys(AUDIT_ACTION_LABELS).filter((a) => !actions.has(a));
    expect(stale, `서버가 더는 기록하지 않는 이름: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('AUDIT_GROUPS', () => {
  it('모든 액션이 어떤 묶음에든 든다', () => {
    const prefixes = AUDIT_GROUPS.map((g) => g.value).filter(Boolean);
    const uncovered = Object.keys(AUDIT_ACTION_LABELS).filter(
      (a) => !prefixes.some((p) => a.startsWith(p)),
    );
    expect(uncovered, `묶음이 없는 액션: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('"전체"는 빈 값이라 서버 필터가 무시한다', () => {
    expect(AUDIT_GROUPS[0]).toEqual({ value: '', label: '전체' });
  });
});

describe('isDestructiveAction', () => {
  it('삭제·폐지를 되돌릴 수 없는 동작으로 본다', () => {
    // 감사 화면을 여는 이유의 대부분이 "무엇이 사라졌나"다
    expect(isDestructiveAction('policy.delete')).toBe(true);
    expect(isDestructiveAction('template.delete')).toBe(true);
    expect(isDestructiveAction('version.archive')).toBe(true);
  });

  it('생성·수정은 아니다', () => {
    expect(isDestructiveAction('policy.create')).toBe(false);
    expect(isDestructiveAction('version.approve')).toBe(false);
    expect(isDestructiveAction('template.restore')).toBe(false);
  });
});

describe('auditGroupOf', () => {
  it('첫 점까지가 묶음', () => {
    expect(auditGroupOf('version.approve')).toBe('version.');
    expect(auditGroupOf('policy.revision_reason.create')).toBe('policy.');
    expect(auditGroupOf('점없음')).toBe('점없음');
  });
});
