import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loginCopy, loginErrorKey, type LoginCopy } from '../apps/web/src/lib/loginCopy';
import { messages } from '../apps/web/src/i18n/messages';

const KEY_FIELDS: (keyof LoginCopy)[] = [
  'tenantHintKey',
  'tenantPlaceholderKey',
  'emailPlaceholderKey',
  'tenantNotFoundKey',
  'invalidCredentialsKey',
];

function values(copy: LoginCopy): string[] {
  return KEY_FIELDS.flatMap((f) => {
    const key = copy[f] as string;
    return [messages.ko[key], messages.en[key]].map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  });
}

describe('로그인 화면 안내 — 가입이 닫힌 서버(운영)에는 데모·가입·시드 안내를 보이지 않는다 (T-212)', () => {
  it('서버 설정을 받기 전(undefined)·받지 못한 때도 닫힌 쪽이다', () => {
    expect(loginCopy(undefined).open).toBe(false);
    expect(loginCopy(false).open).toBe(false);
    expect(loginCopy(true).open).toBe(true);
  });

  it('닫힌 쪽은 기관 코드를 비워 두고, 문구에 demo·회원가입·시드가 없다(ko·en)', () => {
    const closed = loginCopy(undefined);
    expect(closed.defaultTenant).toBe('');
    for (const v of values(closed)) {
      expect(v).not.toMatch(/demo|데모|시드|seed|회원가입|sign[- ]?up|DB|API/i);
    }
  });

  it('닫힌 쪽 문구 키가 ko·en 모두 있다(빠지면 키 이름이 화면에 나온다)', () => {
    const closed = loginCopy(false);
    for (const f of KEY_FIELDS) {
      const key = closed[f] as string;
      expect(typeof messages.ko[key], `ko ${key}`).toBe('string');
      expect(typeof messages.en[key], `en ${key}`).toBe('string');
    }
  });

  it('로그인·가입 화면이 이 판정을 쓴다 — 가입 화면도 설정을 받기 전에는 가입 양식 대신 닫힘 안내', () => {
    const root = join(__dirname, '..');
    const login = readFileSync(join(root, 'apps/web/src/pages/LoginPage.tsx'), 'utf8');
    const register = readFileSync(join(root, 'apps/web/src/pages/RegisterPage.tsx'), 'utf8');
    expect(login).toContain('loginCopy(signupOptions?.publicSignup)');
    expect(login).not.toMatch(/placeholder="(demo|admin@demo\.com)"/);
    expect(login).not.toMatch(/tenantSlug: 'demo'/);
    // 안내 문단·오류 문구가 고른 키를 쓴다 — 옛 키(가입 열린 서버용)를 직접 부르면 운영에 demo·시드 안내가 다시 나온다
    expect(login).not.toMatch(/t\('login\.(tenantHint|tenantNotFound|invalidCredentials)'\)/);
    expect(login).toContain('t(copy.tenantHintKey)');
    expect(login).toContain('loginErrorKey(copy,');
    expect(register).toContain('loginCopy(signupOptions?.publicSignup).open');
  });

  it('로그인 실패 문구 — 서버 영어 원문(요청 한도·입력 검증·서버 오류)을 그대로 보이지 않는다', () => {
    const closed = loginCopy(false);
    expect(loginErrorKey(closed, 401, 'Tenant not found')).toBe('login.tenantNotFoundClosed');
    expect(loginErrorKey(closed, 401, 'Invalid credentials')).toBe('login.invalidCredentialsClosed');
    expect(loginErrorKey(loginCopy(true), 401, 'Tenant not found')).toBe('login.tenantNotFound');
    expect(loginErrorKey(closed, 429, 'ThrottlerException: Too Many Requests')).toBe('login.tooMany');
    expect(loginErrorKey(closed, 400, ['email must be an email'])).toBe('login.error');
    expect(loginErrorKey(closed, 500, 'Internal server error')).toBe('login.error');
    expect(loginErrorKey(closed, undefined, undefined)).toBe('login.error'); // 연결 끊김
    for (const k of ['login.tooMany', 'login.error']) {
      expect(typeof messages.ko[k], k).toBe('string');
      expect(typeof messages.en[k], k).toBe('string');
    }
  });

  it('가입이 열린 서버(개발·시험)는 지금처럼 demo 를 안내한다', () => {
    const open = loginCopy(true);
    expect(open.defaultTenant).toBe('demo');
    expect(messages.ko[open.tenantPlaceholderKey]).toBe('demo');
    expect(messages.ko[open.tenantNotFoundKey]).toMatch(/demo/);
    for (const f of KEY_FIELDS) {
      expect(typeof messages.en[open[f] as string]).toBe('string');
    }
  });
});
