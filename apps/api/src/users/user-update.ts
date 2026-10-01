/**
 * 사용자 정보 수정의 판정 규칙 — DB 없이 검사할 수 있도록 서비스에서 떼어 냈다.
 *
 * 규칙은 두 가지다.
 * 1. 요청 중 **실제로 달라지는 항목만** 변경으로 본다(같은 값을 다시 저장해도 감사 로그를 남기지 않는다).
 * 2. 조직의 **마지막 관리자**는 관리자 자리에서 내려올 수 없다. 관리자가 0명이 되면
 *    사용자 추가·역할 변경·감사 로그 등 관리자 전용 기능을 쓸 사람이 사라지고,
 *    화면에서는 되돌릴 방법이 없다.
 */

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface UserUpdateInput {
  name?: string;
  email?: string;
  role?: UserRole;
}

export interface UserSnapshot {
  name: string;
  email: string;
  role: string;
}

export interface FieldChange<T = string> {
  before: T;
  after: T;
}

export interface UserChanges {
  name?: FieldChange;
  email?: FieldChange;
  role?: FieldChange;
}

export function diffUserUpdate(current: UserSnapshot, input: UserUpdateInput): UserChanges {
  const changes: UserChanges = {};
  if (input.name !== undefined && input.name !== current.name) {
    changes.name = { before: current.name, after: input.name };
  }
  if (input.email !== undefined && input.email !== current.email) {
    changes.email = { before: current.email, after: input.email };
  }
  if (input.role !== undefined && input.role !== current.role) {
    changes.role = { before: current.role, after: input.role };
  }
  return changes;
}

export function hasChanges(changes: UserChanges): boolean {
  return Object.keys(changes).length > 0;
}

/** `adminCount` 는 변경 전 조직의 관리자 수(대상 본인 포함) */
export function removesLastAdmin(changes: UserChanges, adminCount: number): boolean {
  const role = changes.role;
  if (!role) return false;
  return role.before === 'admin' && role.after !== 'admin' && adminCount <= 1;
}
