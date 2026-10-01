import { describe, it, expect } from 'vitest';
import {
  diffUserUpdate,
  hasChanges,
  removesLastAdmin,
} from '../apps/api/src/users/user-update';

/**
 * 사용자 정보 수정의 판정 규칙.
 * 가장 막고 싶은 사고는 "조직에 관리자가 한 명도 없는 상태"다 — 관리자 전용 화면(사용자 추가·
 * 역할 변경·감사 로그)을 쓸 사람이 사라지고, 화면에서는 되돌릴 방법이 없다.
 */

const hong = { name: '홍길동', email: 'hong@example.test', role: 'editor' };

describe('diffUserUpdate', () => {
  it('보낸 항목 중 실제로 달라지는 것만 변경으로 본다', () => {
    const changes = diffUserUpdate(hong, { name: '홍길순', email: 'hong@example.test' });
    expect(changes).toEqual({ name: { before: '홍길동', after: '홍길순' } });
  });

  it('같은 값을 다시 보내면 변경이 없다 — 감사 로그를 남기지 않기 위함', () => {
    const changes = diffUserUpdate(hong, { name: '홍길동', role: 'editor' });
    expect(hasChanges(changes)).toBe(false);
  });

  it('보내지 않은 항목은 건드리지 않는다', () => {
    const changes = diffUserUpdate(hong, { role: 'admin' });
    expect(changes).toEqual({ role: { before: 'editor', after: 'admin' } });
    expect(changes.name).toBeUndefined();
    expect(changes.email).toBeUndefined();
  });

  it('이름·이메일·역할을 한 번에 바꿀 수 있다', () => {
    const changes = diffUserUpdate(hong, { name: 'A', email: 'a@example.test', role: 'viewer' });
    expect(Object.keys(changes).sort()).toEqual(['email', 'name', 'role']);
  });
});

describe('removesLastAdmin', () => {
  it('관리자가 한 명뿐인데 그 사람을 강등하면 막는다', () => {
    const changes = diffUserUpdate({ ...hong, role: 'admin' }, { role: 'editor' });
    expect(removesLastAdmin(changes, 1)).toBe(true);
  });

  it('관리자가 둘 이상이면 한 명을 강등해도 된다', () => {
    const changes = diffUserUpdate({ ...hong, role: 'admin' }, { role: 'viewer' });
    expect(removesLastAdmin(changes, 2)).toBe(false);
  });

  it('관리자가 아닌 사람의 역할 변경은 관리자 수와 무관하다', () => {
    const toAdmin = diffUserUpdate(hong, { role: 'admin' });
    expect(removesLastAdmin(toAdmin, 1)).toBe(false);
    const toViewer = diffUserUpdate(hong, { role: 'viewer' });
    expect(removesLastAdmin(toViewer, 1)).toBe(false);
  });

  it('관리자 역할을 그대로 두는 변경(이름만 수정)은 막지 않는다', () => {
    const changes = diffUserUpdate({ ...hong, role: 'admin' }, { name: '새이름', role: 'admin' });
    expect(removesLastAdmin(changes, 1)).toBe(false);
  });

  it('역할 변경이 없으면 막을 것이 없다', () => {
    expect(removesLastAdmin({}, 1)).toBe(false);
  });
});
