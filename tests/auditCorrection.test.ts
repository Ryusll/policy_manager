import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  CORRECTION_TARGETS,
  assertCorrectionPair,
  findApprovalAudit,
  findRejectionAudit,
  writeCorrection,
} from '../apps/api/src/audit/audit-correction';
import { buildAuditWhere } from '../apps/api/src/audit/audit-query';
import { assertNoIssuedSource, correctionAfter, detachStaleSources, recordSourceDetach } from '../apps/api/src/amendments/amendment-correction';
import { CORRECTION_ACTIONS, auditEntityHref, entityFilterFrom } from '../apps/web/src/lib/auditCorrection';

/**
 * T-178 (PAT-21 — 특허 도 12) 감사 로그 정정. 원 기록은 그대로 두고, 정정은 원 기록을 가리키는 후속 기록(사유·전·후)이다. 어떤 기록이
 * 어떤 기록을 정정하는지는 표 하나로 정하고, 서버가 고른 원 기록이 짝이 아니면(다른 회사·다른 종류) 쓰지 않는다.
 */

const T = 'tenant-1';
const target = (action: string, tenantId = T) => ({ id: 'orig-1', tenantId, action });
const fakeAudit = () => {
  const create = vi.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new-1', ...args }));
  const findFirst = vi.fn((args: unknown) => Promise.resolve(args ? null : null));
  return { db: { auditLog: { create, findFirst } } as any, create, findFirst };
};
const entry = (over: Record<string, unknown> = {}) => ({
  tenantId: T,
  userId: 'u-1',
  action: 'amendment.reject_correct',
  entityType: 'amendment_candidate',
  entityId: 'c-1',
  reason: '반려 판단 착오',
  before: { reviewState: 'rejected' },
  after: { reviewState: 'draft' },
  ...over,
});

describe('정정 짝 (T-178)', () => {
  it('표에 있는 짝만 — 반려 정정은 반려·옛 철회를, 철회는 후보 승인·일반 승인을 정정한다', () => {
    expect(CORRECTION_TARGETS).toEqual({
      'amendment.reject_correct': ['amendment.reject', 'version.withdraw'],
      'version.withdraw': ['amendment.approve', 'version.approve'],
    });
    for (const [action, targets] of Object.entries(CORRECTION_TARGETS)) {
      for (const t of targets) expect(() => assertCorrectionPair(action, T, target(t))).not.toThrow();
    }
  });

  it('짝이 아닌 기록·다른 회사의 기록·정정이 아닌 action 은 거절한다, 원 기록이 없으면(null) 짝을 따지지 않는다', () => {
    expect(() => assertCorrectionPair('amendment.reject_correct', T, target('amendment.approve'))).toThrow('정정하지 않습니다');
    expect(() => assertCorrectionPair('version.withdraw', T, target('amendment.reject'))).toThrow('정정하지 않습니다');
    expect(() => assertCorrectionPair('version.withdraw', T, target('version.approve', 'tenant-2'))).toThrow('다른 회사');
    expect(() => assertCorrectionPair('amendment.edit', T, target('amendment.reject'))).toThrow('정정 기록이 아닌');
    expect(() => assertCorrectionPair('amendment.edit', T, null)).toThrow('정정 기록이 아닌');
    expect(() => assertCorrectionPair('version.withdraw', T, null)).not.toThrow();
  });
});

describe('정정 기록 쓰기 (T-178)', () => {
  it('원 기록을 가리키고 details 에 사유·전·후를 담는다 — 덧붙인 값이 사유·전·후를 덮지 못한다', async () => {
    const { db, create } = fakeAudit();
    await writeCorrection(db, target('amendment.reject'), entry({ extra: { reason: '덮기', before: 1, after: 2, correctionId: 's-1' } }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toEqual({
      tenantId: T,
      userId: 'u-1',
      action: 'amendment.reject_correct',
      entityType: 'amendment_candidate',
      entityId: 'c-1',
      correctsId: 'orig-1',
      details: { correctionId: 's-1', reason: '반려 판단 착오', before: { reviewState: 'rejected' }, after: { reviewState: 'draft' } },
    });
  });

  it('원 기록이 없으면 정정 대상을 비워 쓴다(짐작하지 않는다)', async () => {
    const { db, create } = fakeAudit();
    await writeCorrection(db, null, entry({ action: 'version.withdraw' }));
    expect(create.mock.calls[0][0].data.correctsId).toBeNull();
  });

  it('짝이 아니거나 사유가 비면 아무것도 쓰지 않는다', async () => {
    const { db, create } = fakeAudit();
    await expect(writeCorrection(db, target('amendment.approve'), entry())).rejects.toThrow('정정하지 않습니다');
    await expect(writeCorrection(db, target('amendment.reject', 'tenant-2'), entry())).rejects.toThrow('다른 회사');
    await expect(writeCorrection(db, target('amendment.reject'), entry({ reason: '  ' }))).rejects.toThrow('사유');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('원 기록 찾기 (T-178)', () => {
  it('철회 — 그 버전의 마지막 철회 뒤에 남은 일반 승인·(후보로 발행했으면) 후보 승인 가운데 마지막 것', async () => {
    const { db, findFirst } = fakeAudit();
    await findApprovalAudit(db, T, { id: 'v-1', sourceCandidateId: 'c-1' });
    // 먼저 그 버전의 마지막 철회
    expect(findFirst.mock.calls[0][0]).toEqual({
      where: { tenantId: T, action: 'version.withdraw', entityType: 'ArticleVersion', entityId: 'v-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    const args = findFirst.mock.calls[1][0] as any;
    expect(args.where).toEqual({
      tenantId: T,
      OR: [
        { action: 'version.approve', entityType: 'ArticleVersion', entityId: 'v-1' },
        { action: 'amendment.approve', entityType: 'amendment_candidate', entityId: 'c-1', details: { path: ['version', 'id'], equals: 'v-1' } },
      ],
      correctedBy: { none: { action: 'version.withdraw' } },
    });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);

    await findApprovalAudit(db, T, { id: 'v-2', sourceCandidateId: null });
    expect((findFirst.mock.calls[3][0] as any).where.OR).toEqual([{ action: 'version.approve', entityType: 'ArticleVersion', entityId: 'v-2' }]);
  });

  it('철회가 있었던 버전이면 그 철회 뒤의 승인만 — T-178 전 철회는 원 기록을 가리키지 않아 "정정됨"으로 거를 수 없다', async () => {
    const withdrawnAt = new Date('2026-10-20T01:02:03Z');
    const findFirst = vi.fn((args: any) => Promise.resolve(args.where.action === 'version.withdraw' ? { createdAt: withdrawnAt } : null));
    await findApprovalAudit({ auditLog: { findFirst } } as any, T, { id: 'v-1', sourceCandidateId: null });
    expect(findFirst.mock.calls[1][0].where.createdAt).toEqual({ gt: withdrawnAt });
  });

  it('반려 정정 — 검토 → 반려면 그 결정의 반려 감사, 승인 → 반려(옛 철회)면 그 전환 시각 이후 첫 철회 감사', async () => {
    const { db, findFirst } = fakeAudit();
    const at = new Date('2026-10-01T00:00:00Z');
    await findRejectionAudit(db, T, 'c-1', { id: 'd-1', fromState: 'review', createdAt: at });
    expect((findFirst.mock.calls[0][0] as any).where).toEqual({
      tenantId: T,
      action: 'amendment.reject',
      entityType: 'amendment_candidate',
      entityId: 'c-1',
      details: { path: ['decisionId'], equals: 'd-1' },
    });
    await findRejectionAudit(db, T, 'c-1', { id: 'd-2', fromState: 'approved', createdAt: at });
    const old = findFirst.mock.calls[1][0] as any;
    expect(old.where).toEqual({
      tenantId: T,
      action: 'version.withdraw',
      entityType: 'ArticleVersion',
      details: { path: ['candidateId'], equals: 'c-1' },
      createdAt: { gte: at },
    });
    expect(old.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});

describe('후보 화면의 정정 표시·승인 전 원천 연결 떼기 (T-178)', () => {
  it('마지막 결정 뒤 작성 상태로 돌린 정정만 — 결정이 없으면 묻지 않는다, 승인에서 온 정정은 철회', async () => {
    const findFirst = vi.fn(() => Promise.resolve({ fromState: 'approved', revision: 2, reason: '승인 철회 — 보류', actorId: 'u-1', createdAt: new Date() }));
    const db = { amendmentStateChange: { findFirst } } as any;
    expect(await correctionAfter(db, T, 'c-1', null)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    const at = new Date('2026-10-01T00:00:00Z');
    expect(await correctionAfter(db, T, 'c-1', at)).toMatchObject({ kind: 'withdraw', reason: '승인 철회 — 보류' });
    // 승인 → 반려(T-178 전 철회, 마이그레이션이 정정으로 채움)는 그 자체가 결정이라 세지 않는다
    expect((findFirst.mock.calls[0] as any[])[0].where).toEqual({ tenantId: T, candidateId: 'c-1', kind: 'correction', toState: 'draft', createdAt: { gte: at } });
    findFirst.mockReturnValueOnce(Promise.resolve({ fromState: 'rejected', revision: 1, reason: '정정', actorId: null, createdAt: new Date() }));
    expect(await correctionAfter(db, T, 'c-1', at)).toMatchObject({ kind: 'reject' });
  });

  const versions = (holder: { id: string; status: string; versionNum: number; changeEventId: string | null } | null) => {
    const update = vi.fn(() => Promise.resolve({}));
    const findUnique = vi.fn((args: any) => Promise.resolve(holder && args.where.sourceCandidateId === 'c-1' ? holder : null));
    return { tx: { articleVersion: { findUnique, update } } as any, update, findUnique };
  };

  it('발행되지 않은 버전(초안·검토 중)의 원천 연결을 떼고 그 버전을 돌려준다 — 없으면 null', async () => {
    const none = versions(null);
    expect(await detachStaleSources(none.tx, 'c-1')).toBeNull();
    expect(none.update).not.toHaveBeenCalled();
    for (const status of ['draft', 'review']) {
      const h = { id: 'v-1', status, versionNum: 3, changeEventId: 'e-1' };
      const v = versions(h);
      expect(await detachStaleSources(v.tx, 'c-1')).toEqual(h);
      expect(v.update).toHaveBeenCalledWith({ where: { id: 'v-1' }, data: { sourceCandidateId: null, changeEventId: null } });
    }
  });

  it('발행된 버전이 이 후보를 쥐고 있으면 승인도 반려 정정도 409 — 떼지 않는다', async () => {
    for (const status of ['published', 'archived']) {
      const v = versions({ id: 'v-9', status, versionNum: 5, changeEventId: 'e-1' });
      await expect(detachStaleSources(v.tx, 'c-1')).rejects.toBeInstanceOf(ConflictException);
      const err = await assertNoIssuedSource(v.tx, 'c-1', '반려를 정정해도 다시 승인할 수 없습니다').catch((e: ConflictException) => e);
      expect(err).toBeInstanceOf(ConflictException);
      // 화면이 가르는 reason — 승인 막힘(blocked)과 같은 모양
      expect((err as ConflictException).getResponse()).toEqual({
        message: '이 후보로 발행한 버전(v5)이 이미 있어 반려를 정정해도 다시 승인할 수 없습니다 — 규정 화면에서 그 버전을 확인하세요.',
        reason: 'issued_source',
      });
      expect(v.update).not.toHaveBeenCalled();
    }
    for (const status of ['draft', 'review']) {
      await expect(assertNoIssuedSource(versions({ id: 'v-1', status, versionNum: 3, changeEventId: null }).tx, 'c-1', 'x')).resolves.toBeUndefined();
    }
  });

  it('뗀 원천 연결은 그 버전을 대상으로 감사에 남는다(떼게 한 결정, 전·후, 새 버전 — 반려 정정이면 새 버전 없음)', async () => {
    const { db, create } = fakeAudit();
    await recordSourceDetach(db, {
      tenantId: T,
      userId: 'u-1',
      candidateId: 'c-1',
      newVersionId: 'v-new',
      cause: 'amendment.approve',
      detached: { id: 'v-1', status: 'draft', versionNum: 3, changeEventId: 'e-1' },
    });
    expect(create.mock.calls[0][0].data).toEqual({
      tenantId: T,
      userId: 'u-1',
      action: 'version.source_detach',
      entityType: 'ArticleVersion',
      entityId: 'v-1',
      details: {
        candidateId: 'c-1',
        cause: 'amendment.approve',
        newVersionId: 'v-new',
        status: 'draft',
        versionNum: 3,
        before: { sourceCandidateId: 'c-1', changeEventId: 'e-1' },
        after: { sourceCandidateId: null, changeEventId: null },
      },
    });
  });

  it('반려 정정이 뗐으면 새 버전은 없다', async () => {
    const { db, create } = fakeAudit();
    const detached = { id: 'v-1', status: 'review', versionNum: 3, changeEventId: null };
    await recordSourceDetach(db, { tenantId: T, userId: 'u-1', candidateId: 'c-1', newVersionId: null, cause: 'amendment.reject_correct', detached });
    expect(create.mock.calls[0][0].data.details).toMatchObject({ cause: 'amendment.reject_correct', newVersionId: null, status: 'review' });
  });
});

describe('감사 조회 — 대상 필터 (T-178)', () => {
  it('대상 종류·id 는 정확히 일치, 앞뒤 공백은 지우고 빈 값은 걸지 않는다', () => {
    expect(buildAuditWhere(T, { entityType: ' amendment_candidate ', entityId: ' c-1 ' })).toEqual({ tenantId: T, entityType: 'amendment_candidate', entityId: 'c-1' });
    expect(buildAuditWhere(T, { entityType: '', entityId: '   ' })).toEqual({ tenantId: T });
  });
});

describe('감사 화면 도우미 (T-178)', () => {
  it('화면의 정정 action 은 서버 정정 짝 표의 열쇠와 같다', () => {
    expect([...CORRECTION_ACTIONS].sort()).toEqual(Object.keys(CORRECTION_TARGETS).sort());
  });

  it('대상 필터 주소 — 만든 주소를 다시 읽으면 같은 대상, 둘 중 하나라도 없거나 서버 한도(64)를 넘으면 걸지 않는다', () => {
    const href = auditEntityHref('amendment_candidate', 'c-1&x=1');
    expect(href.startsWith('/audit-logs?')).toBe(true);
    expect(entityFilterFrom(new URLSearchParams(href.split('?')[1]))).toEqual({ entityType: 'amendment_candidate', entityId: 'c-1&x=1' });
    expect(entityFilterFrom(new URLSearchParams('entityType=ArticleVersion'))).toBeNull();
    expect(entityFilterFrom(new URLSearchParams('entityId=v-1'))).toBeNull();
    expect(entityFilterFrom(new URLSearchParams(`entityType=ArticleVersion&entityId=${'x'.repeat(65)}`))).toBeNull();
    expect(entityFilterFrom(new URLSearchParams(`entityType=${'x'.repeat(64)}&entityId= v-1 `))).toEqual({ entityType: 'x'.repeat(64), entityId: 'v-1' });
  });
});
