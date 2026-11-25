import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { messages } from '../apps/web/src/i18n/messages';

/*
 * 고객 화면 문구 정리 (T-212, SRS NFR-9) — 구현 사정·내부 식별자·예시 데이터를 화면에서 걷어 낸 것이
 * 다시 들어오지 않게 막는다. 화면 코드는 원문을 읽어 본다(렌더 시험 환경이 없다).
 */

const ROOT = join(__dirname, '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const allValues = (locale: 'ko' | 'en') =>
  Object.entries(messages[locale]).filter(([, v]) => typeof v === 'string') as [string, string][];

describe('고객 화면 문구 (T-212)', () => {
  it("'데모 버전'이 화면 문구(ko·en)에 남지 않는다 — 대시보드 제목 교체, 쓰이지 않던 머리 문구 삭제", () => {
    for (const locale of ['ko', 'en'] as const) {
      const hits = allValues(locale).filter(([, v]) => /데모 버전|demo version/i.test(v));
      expect(hits, locale).toEqual([]);
      expect(messages[locale]['layout.headerTagline'], locale).toBeUndefined();
    }
    expect(messages.ko['dashboard.bannerHeadline']).toBe('규정·법령 현황');
  });

  it('규정 상세 도구 줄에 개발 안내("단계적으로 확장 중")가 없다', () => {
    expect(src('apps/web/src/pages/PolicyDetailPage.tsx')).not.toContain('단계적으로 확장');
  });

  it('법령 변경 빈 상태 문구는 개발 메모 같은 말투를 걷되 뜻(조항 단위·감지·확정 연결만·추천 제외)은 남긴다', () => {
    expect(src('apps/web/src/components/LawChangeList.tsx')).not.toContain('확정된 연결만 셉니다');
    const ko = messages.ko['lawChanges.emptyAffected'] as string;
    expect(ko).toMatch(/조항/);
    expect(ko).toMatch(/감지/);
    expect(ko).toMatch(/확정/);
    expect(ko).toMatch(/추천/);
    expect(ko).not.toMatch(/매핑/); // 제품 용어는 '연결' — '자동 매핑'은 영업 문구 기준표 금지 표현
    expect(typeof messages.en['lawChanges.emptyAffected']).toBe('string');
    expect(typeof messages.en['lawChanges.empty']).toBe('string');
  });

  it('예시 주소(example.com)를 고객 화면에 두지 않는다 — 회사 소개 문의', () => {
    for (const locale of ['ko', 'en'] as const) {
      expect(allValues(locale).filter(([, v]) => /example\.com/.test(v)), locale).toEqual([]);
    }
    expect(src('apps/web/src/pages/AboutPage.tsx')).not.toContain('about.contactEmail');
  });

  it('한국어 화면에 내부 토큰 이름·영어 탭 이름이 섞이지 않는다', () => {
    expect(messages.ko['settings.themeHint']).not.toMatch(/navy|gold/);
    expect(messages.ko['settings.tabInvite']).not.toMatch(/[A-Za-z]/);
    expect(messages.ko['settings.tabUi']).not.toMatch(/UI/);
    expect(messages.ko['settings.logoHint']).not.toMatch(/브라우저 저장 한도/); // 로고는 서버에 저장한다(BRAND-2)
    expect(messages.ko['policies.placeholderCode']).not.toMatch(/DEMO/);
  });

  it('경로 표시가 규정 전문을 따로 받지 않는다 — 숨긴 경로 표시용 헛요청 삭제(T-183 ⑤)', () => {
    const layout = src('apps/web/src/components/Layout.tsx');
    expect(layout).not.toContain('breadcrumb-policy-title');
    expect(layout).not.toContain('policiesApi');
  });

  it('새로 넣은 문구 키는 ko·en 짝이 맞다', () => {
    const keys = [
      'layout.breadcrumb.label',
      'layout.breadcrumb.detail',
      'lawChanges.emptyAffected',
      'lawChanges.empty',
      'login.tenantHintClosed',
      'login.tenantNotFoundClosed',
      'login.invalidCredentialsClosed',
      'login.tenantPlaceholder',
      'login.emailPlaceholder',
      'login.tenantPlaceholderDemo',
      'login.emailPlaceholderDemo',
    ];
    for (const k of keys) {
      expect(typeof messages.ko[k], `ko ${k}`).toBe('string');
      expect(typeof messages.en[k], `en ${k}`).toBe('string');
    }
  });
});
