import { describe, it, expect } from 'vitest';
import {
  AUDIT_MAX_PAGE_SIZE,
  AUDIT_PAGE_SIZE,
  buildAuditQuery,
  buildAuditWhere,
  summarizeDetails,
} from '../apps/api/src/audit/audit-query';

const TENANT = 'tenant-1';

describe('buildAuditWhere (T-11)', () => {
  it('조건이 없으면 테넌트만 건다', () => {
    expect(buildAuditWhere(TENANT, {})).toEqual({ tenantId: TENANT });
  });

  it('액션은 정확히 일치로 건다', () => {
    expect(buildAuditWhere(TENANT, { action: 'version.approve' })).toMatchObject({
      action: 'version.approve',
    });
  });

  /** 액션 이름이 점으로 갈라져 있어 접두어가 곧 분류다 */
  it('끝에 점을 붙이면 접두어 묶음이 된다', () => {
    expect(buildAuditWhere(TENANT, { action: 'version.' })).toMatchObject({
      action: { startsWith: 'version.' },
    });
  });

  it('빈 문자열 필터는 무시한다', () => {
    // 화면의 "전체" 선택이 빈 문자열로 온다. 그대로 걸면 아무것도 안 나온다.
    const where = buildAuditWhere(TENANT, { action: '  ', userId: '', from: '', to: '' });
    expect(where).toEqual({ tenantId: TENANT });
  });

  it('끝날을 포함해서 거른다', () => {
    // `lte: to` 로 두면 그날 00:00 이후 기록이 전부 빠져서, "오늘"을 골라도 오늘 게 안 나온다
    const where = buildAuditWhere(TENANT, { from: '2026-08-01', to: '2026-08-23' }) as any;
    expect(where.createdAt.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(where.createdAt.lte.toISOString()).toBe('2026-08-23T23:59:59.999Z');
  });

  it('형식이 맞지 않는 날짜는 무시한다', () => {
    const where = buildAuditWhere(TENANT, { from: '2026/08/01', to: 'yesterday' });
    expect(where).toEqual({ tenantId: TENANT });
  });
});

describe('buildAuditQuery', () => {
  it('기본 페이지·크기', () => {
    const plan = buildAuditQuery(TENANT, {});
    expect(plan).toMatchObject({ page: 1, limit: AUDIT_PAGE_SIZE, skip: 0, take: AUDIT_PAGE_SIZE });
  });

  it('페이지에 따라 건너뛴다', () => {
    expect(buildAuditQuery(TENANT, { page: '3', limit: '20' })).toMatchObject({ skip: 40, take: 20 });
  });

  it('상한을 넘는 크기는 좁힌다', () => {
    expect(buildAuditQuery(TENANT, { limit: '99999' }).take).toBe(AUDIT_MAX_PAGE_SIZE);
  });

  it('0이나 음수는 최소값으로 올린다', () => {
    expect(buildAuditQuery(TENANT, { page: '0', limit: '0' })).toMatchObject({ page: 1, take: 1 });
    expect(buildAuditQuery(TENANT, { page: '-5' }).page).toBe(1);
  });

  it('숫자가 아니면 기본값으로 돌아간다', () => {
    expect(buildAuditQuery(TENANT, { page: 'abc', limit: 'xyz' })).toMatchObject({
      page: 1,
      limit: AUDIT_PAGE_SIZE,
    });
  });
});

describe('summarizeDetails', () => {
  it('키만 알려 주고 본문은 넘기지 않는다', () => {
    // 템플릿 수정 기록의 details 에는 before/after 스냅샷이 통째로 들어 있다.
    // 50건이면 응답이 수 MB 가 되는데, 목록에서는 펼치기 전까지 쓰지 않는다.
    expect(summarizeDetails({ before: { cssText: 'x'.repeat(9999) }, after: {} })).toEqual({
      hasDetails: true,
      keys: ['before', 'after'],
    });
  });

  it('비어 있으면 없는 것으로 본다', () => {
    expect(summarizeDetails(null)).toEqual({ hasDetails: false, keys: [] });
    expect(summarizeDetails({})).toEqual({ hasDetails: false, keys: [] });
    expect(summarizeDetails('문자열')).toEqual({ hasDetails: false, keys: [] });
    expect(summarizeDetails([1, 2])).toEqual({ hasDetails: false, keys: [] });
  });
});
