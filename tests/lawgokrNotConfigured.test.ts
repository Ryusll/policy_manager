import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LawGoKrService } from '../apps/api/src/lawgokr/lawgokr.service';
import { messages } from '../apps/web/src/i18n/messages';

/*
 * 법제처 연동 안내 (T-212, SRS NFR-9) — 서버 오류 응답과 고객사 화면에 환경변수 이름·운영 안내를 싣지 않는다.
 * 응답 본문은 법령 등록 창·법제처 가져오기 패널의 오류 줄에 그대로 나간다. 설정 안내는 통합 관리자 화면에만.
 */

function service() {
  const store = new Map<string, unknown>();
  const cache: any = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: unknown) => (store.set(k, v), Promise.resolve()),
  };
  return new LawGoKrService(cache);
}

async function failureOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e: any) {
    return { status: e.getStatus?.(), body: e.getResponse?.() };
  }
  throw new Error('실패해야 하는데 성공했다');
}

describe('법제처 오류 응답에 운영 안내를 싣지 않는다 (T-212)', () => {
  const oc = process.env.LAW_GO_KR_OC;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (oc === undefined) delete process.env.LAW_GO_KR_OC;
    else process.env.LAW_GO_KR_OC = oc;
  });

  it('인증값이 없으면 503 LAWGOKR_NOT_CONFIGURED — 본문에 환경변수 이름·.env·재기동 안내가 없다', async () => {
    delete process.env.LAW_GO_KR_OC;
    const f = await failureOf(service().searchVersions('001872', 1));
    expect(f.status).toBe(503);
    expect(f.body).toMatchObject({ code: 'LAWGOKR_NOT_CONFIGURED' });
    expect(JSON.stringify(f.body)).not.toMatch(/LAW_GO_KR_OC|\.env|재기동|환경변수/);
  });

  it('법제처가 인증을 거절하면 503 LAWGOKR_AUTH — 법제처 사유·등록 IP 안내는 응답에 없다(로그에만)', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: '사용자 정보 검증에 실패하였습니다.', msg: 'OPEN API 호출 시 IP주소 및 도메인주소를 등록해 주세요.' }), { status: 200 }),
      ),
    );
    const f = await failureOf(service().searchVersions('001872', 1));
    expect(f.status).toBe(503);
    expect(f.body).toMatchObject({ code: 'LAWGOKR_AUTH' });
    expect(JSON.stringify(f.body)).not.toMatch(/IP|도메인|검증에 실패|인증값/);
  });
});

describe('법제처 호출 실패 502 — 원인 원문을 싣지 않는다 (T-212)', () => {
  const oc = process.env.LAW_GO_KR_OC;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (oc === undefined) delete process.env.LAW_GO_KR_OC;
    else process.env.LAW_GO_KR_OC = oc;
  });

  it('닿지 못함·오류 응답·읽을 수 없는 본문 모두 502 고객 문구 — Node 오류 원문·HTTP 상태·"API" 낱말 없음(원인은 로그에만)', async () => {
    process.env.LAW_GO_KR_OC = 'test-oc';
    const cases: [() => Promise<Response>, RegExp][] = [
      [() => Promise.reject(new TypeError('fetch failed')), /fetch failed|TypeError/],
      [() => Promise.resolve(new Response('oops', { status: 500 })), /HTTP|\b500\b/],
      [() => Promise.resolve(new Response('<html>not json</html>', { status: 200 })), /API|형식/],
    ];
    for (const [fetchImpl, leak] of cases) {
      vi.stubGlobal('fetch', fetchImpl);
      const f = await failureOf(service().searchVersions('001872', 1));
      expect(f.status).toBe(502);
      expect(JSON.stringify(f.body)).not.toMatch(leak);
      expect(JSON.stringify(f.body)).toMatch(/잠시 뒤 다시 시도하세요/);
    }
  });
});

describe('법제처 미설정 안내 화면 — 설정 안내는 통합 관리자에게만 (T-212)', () => {
  const root = join(__dirname, '..');
  const src = (p: string) => readFileSync(join(root, p), 'utf8');

  it('법령 등록 창·법제처 가져오기 패널은 공용 안내를 쓰고 환경변수 이름을 직접 적지 않는다', () => {
    for (const p of ['apps/web/src/components/RegisterLawModal.tsx', 'apps/web/src/components/LawGoKrSearchPanel.tsx']) {
      const s = src(p);
      expect(s, p).toContain('<LawGoKrNotConfigured />');
      expect(s, p).not.toContain('LAW_GO_KR_OC');
    }
  });

  it('공용 안내의 환경변수 이름은 통합 관리자 갈래에만 있다', () => {
    const s = src('apps/web/src/components/LawGoKrNotConfigured.tsx');
    const m = s.match(/isPlatformAdmin \? \(([\s\S]*?)\) : \(([\s\S]*?)\)\}/);
    expect(m, '갈래 모양').not.toBeNull();
    const [, operator, customer] = m!;
    expect(operator).toContain('LAW_GO_KR_OC');
    expect(customer).not.toContain('LAW_GO_KR_OC');
    expect(customer).toContain('lawGoKr.notConfigured.customer');
    expect(s).toContain("platformRole === 'global_admin'");
  });

  it('고객용 문구는 문의 안내이고 운영 낱말이 없다(ko·en), 옛 키는 지웠다', () => {
    expect(messages.ko['lawGoKr.notConfigured.customer']).toMatch(/아스트룸에 문의/);
    for (const locale of ['ko', 'en'] as const) {
      for (const k of ['lawGoKr.notConfigured.title', 'lawGoKr.notConfigured.customer']) {
        const v = messages[locale][k];
        expect(typeof v, `${locale} ${k}`).toBe('string');
        expect(v as string, `${locale} ${k}`).not.toMatch(/LAW_GO_KR_OC|환경변수|environment|IP/);
      }
      expect(messages[locale]['laws.register.notConfiguredLead'], locale).toBeUndefined();
      const leak = Object.entries(messages[locale]).filter(([, v]) => typeof v === 'string' && v.includes('LAW_GO_KR_OC'));
      expect(leak, locale).toEqual([]);
    }
  });
});
