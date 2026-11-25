import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { limitFeedback, policyLimitFromError, policySlotsFull, POLICY_LIMIT_REACHED } from '../apps/web/src/lib/policyLimit';
import { maxPoliciesForPlan, planLabel } from '../apps/api/src/common/plan-limits';
import { validateImport } from '../apps/api/src/admin/import-validate';
import { messages } from '../apps/web/src/i18n/messages';

const slots = (used: number, max = 5) => ({ plan: 'starter' as const, used, max, remaining: Math.max(0, max - used) });

describe('규정 자리가 다 찼는가 (T-198)', () => {
  it('상한보다 적으면 막지 않는다', () => {
    expect(policySlotsFull(slots(4))).toBeNull();
    expect(policySlotsFull(slots(0))).toBeNull();
  });

  it('상한과 같거나 넘으면 요금제·상한·등록 수를 돌려준다', () => {
    expect(policySlotsFull(slots(5))).toEqual({ plan: 'starter', max: 5, used: 5 });
    // 요금제를 내린 회사는 상한보다 많을 수 있다
    expect(policySlotsFull(slots(7))).toEqual({ plan: 'starter', max: 5, used: 7 });
  });

  it('아직 받지 못했으면 막지 않는다 — 저장 때 서버가 다시 센다', () => {
    expect(policySlotsFull(undefined)).toBeNull();
    expect(policySlotsFull(null)).toBeNull();
  });
});

describe('저장이 상한에 막힌 오류 읽기 (T-198)', () => {
  const err = (data: unknown) => ({ response: { status: 403, data } });

  it('상한 코드면 요금제·상한·등록 수를 꺼낸다', () => {
    expect(policyLimitFromError(err({ code: POLICY_LIMIT_REACHED, plan: 'starter', max: 5, used: 5, message: '…' }))).toEqual({
      plan: 'starter',
      max: 5,
      used: 5,
    });
  });

  it('다른 403·코드 없는 예전 문구·네트워크 오류는 상한으로 보지 않는다', () => {
    expect(policyLimitFromError(err({ message: 'Insufficient permissions' }))).toBeNull();
    expect(policyLimitFromError(err({ message: '현재 플랜(starter)에서 등록 가능한 규정은 최대 5건입니다.' }))).toBeNull();
    expect(policyLimitFromError(err({ code: 'PASSWORD_CHANGE_REQUIRED' }))).toBeNull();
    expect(policyLimitFromError(new Error('Network Error'))).toBeNull();
    expect(policyLimitFromError(null)).toBeNull();
  });

  it('값이 빠지거나 모르는 요금제면 상한 안내를 만들지 않는다(서버 문구로 보인다)', () => {
    expect(policyLimitFromError(err({ code: POLICY_LIMIT_REACHED, plan: 'gold', max: 5, used: 5 }))).toBeNull();
    expect(policyLimitFromError(err({ code: POLICY_LIMIT_REACHED, plan: 'starter', max: '5', used: 5 }))).toBeNull();
  });
});

describe('상한 안내 문구 (T-198)', () => {
  it('서버 문구의 요금제 이름은 내부 값이 아니라 요금제 창(ko)과 같은 이름이다', () => {
    const ko = messages.ko as Record<string, string>;
    for (const plan of ['starter', 'pro', 'enterprise'] as const) {
      expect(planLabel(plan)).toBe(ko[`plan.name.${plan}`]);
      expect(planLabel(plan)).not.toBe(plan);
    }
  });

  it('일괄 등록 사전 검사의 상한 문구도 요금제 이름·비활성 포함·문의 안내를 쓴다(\'상한\' 은 그대로)', () => {
    const r = validateImport({
      policies: [{ code: 'A', title: 'a', articles: [{ number: 1, title: '목적', content: '본문' }] }],
      existingCodes: [],
      currentCount: 5,
      maxPolicies: 5,
      planName: planLabel('starter'),
    });
    const msg = r.issues.find((i) => i.level === 'error' && i.message.includes('상한'))?.message ?? '';
    // 상한 판정은 한 곳 — 돌려준 limitIssue 가 issues 안의 바로 그 항목이다
    expect(r.limitIssue?.message).toBe(msg);
    expect(validateImport({ policies: [], existingCodes: [], currentCount: 4, maxPolicies: 5 }).limitIssue).toBeNull();
    expect(msg).toContain('(스타터)');
    expect(msg).toContain('비활성 규정 포함');
    expect(msg).toContain('아스트룸에 문의');
  });

  it('두 언어 모두 상한·등록 수·요금제 자리와 아스트룸 문의가 있다', () => {
    for (const locale of ['ko', 'en'] as const) {
      const body = (messages[locale] as Record<string, string>)['policyLimit.body'];
      expect(body).toContain('{plan}');
      expect(body).toContain('{max}');
      expect(body).toContain('{used}');
      expect(body).toMatch(/아스트룸|Astrum/);
    }
  });
});

describe('상한 안내와 저장 실패를 어디에 보일까 (T-198)', () => {
  const full = { plan: 'starter' as const, max: 5, used: 5 };
  const limitErr = { response: { status: 403, data: { code: POLICY_LIMIT_REACHED, plan: 'starter', max: 5, used: 5 } } };
  const dupErr = { response: { status: 409, data: { message: '규정 코드가 이미 있습니다: A' } } };

  it('자리가 다 찼고 실패가 없으면 입력 전 안내만', () => {
    expect(limitFeedback(null, full)).toEqual({ before: full, atButton: null, otherError: null });
  });

  it('저장이 상한에 막히면 버튼 곁에만 — 다시 세어 다 찼다고 나와도 입력 전 안내로 옮겨 가거나 두 번 뜨지 않는다', () => {
    expect(limitFeedback(limitErr, null)).toEqual({ before: null, atButton: full, otherError: null });
    expect(limitFeedback(limitErr, full)).toEqual({ before: null, atButton: full, otherError: null });
  });

  it('상한이 아닌 실패(409 등)는 자리가 찼어도 숨기지 않는다', () => {
    expect(limitFeedback(dupErr, full)).toEqual({ before: full, atButton: null, otherError: dupErr });
    expect(limitFeedback(dupErr, null)).toEqual({ before: null, atButton: null, otherError: dupErr });
  });

  it('자리가 남았고 실패도 없으면 아무것도 보이지 않는다', () => {
    expect(limitFeedback(null, null)).toEqual({ before: null, atButton: null, otherError: null });
    expect(limitFeedback(undefined, null)).toEqual({ before: null, atButton: null, otherError: null });
  });
});

describe('운영 점검 SQL 의 상한 숫자 (T-198)', () => {
  it('SQL 에 다시 적은 상한이 plan-limits.ts 와 같다 — 상한을 바꾸면 이 시험이 SQL 도 고치라고 알린다', () => {
    const sqlText = readFileSync(join(__dirname, '..', 'scripts', 'oracle', 'sql', 't198-policy-slots-check.sql'), 'utf8');
    const cases = [...sqlText.matchAll(/CASE t\.plan WHEN 'starter' THEN (\d+) WHEN 'pro' THEN (\d+) ELSE (\d+) END/g)];
    expect(cases.length).toBeGreaterThanOrEqual(2);
    for (const m of cases) {
      expect(Number(m[1])).toBe(maxPoliciesForPlan('starter'));
      expect(Number(m[2])).toBe(maxPoliciesForPlan('pro'));
      expect(Number(m[3])).toBe(maxPoliciesForPlan('enterprise'));
    }
    expect(sqlText).toContain('BEGIN TRANSACTION READ ONLY');
    expect(sqlText).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });
});
