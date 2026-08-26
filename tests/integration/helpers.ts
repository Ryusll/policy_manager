/**
 * 통합 테스트 공용 헬퍼 — 실제로 떠 있는 API를 HTTP로 두드린다.
 *
 * 서비스 클래스를 직접 부르지 않고 HTTP로 가는 이유는, 막고 싶은 사고가 대부분
 * 가드·파이프·라우팅에서 나기 때문이다(권한 누락, 검증 우회, 테넌트 격리).
 * 서비스만 부르면 그 층을 통째로 건너뛴다.
 */

export const BASE = process.env.API_BASE_URL || 'http://localhost:3001/api';

export type Json = Record<string, any>;

export async function api(
  path: string,
  init: RequestInit & { token?: string; json?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const { token, json, headers, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : (rest.body as any),
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** API가 뜰 때까지 기다린다. 안 뜨면 바로 실패시켜 원인을 드러낸다. */
export async function waitForApi(timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  let lastErr = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `API(${BASE})가 ${timeoutMs}ms 안에 응답하지 않았습니다 (${lastErr}). ` +
      '`docker compose up -d` 로 먼저 띄우세요.',
  );
}

/**
 * 테스트마다 새 테넌트를 만든다. 서로의 데이터를 보지 않게 하려는 것이 요점이다.
 *
 * 테넌트 삭제 API가 없어서 개발 DB에는 `it-…` 테넌트가 쌓인다.
 * 정리는 `npm run test:int:clean`. CI는 매번 빈 DB라 해당 없다.
 */
export async function createTenant(tag: string) {
  const slug = `it-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@example.test`;
  const password = 'IntegrationTest!234';
  const { status, body } = await api('/auth/register', {
    method: 'POST',
    json: { tenantName: `통합테스트 ${tag}`, tenantSlug: slug, email, password, name: '통합테스트' },
  });
  if (status >= 300) {
    throw new Error(`테넌트 생성 실패 (${status}): ${JSON.stringify(body)}`);
  }
  return { slug, email, password, token: body.accessToken as string, user: body.user };
}

export async function login(email: string, password: string, tenantSlug: string) {
  return api('/auth/login', { method: 'POST', json: { email, password, tenantSlug } });
}

/** 규정 하나에 장 + 조문까지 만들어 준다 */
export async function createPolicyWithArticle(
  token: string,
  code: string,
  title = '통합테스트 규정',
) {
  const policy = await api('/policies', { method: 'POST', token, json: { code, title } });
  if (policy.status >= 300) throw new Error(`규정 생성 실패: ${JSON.stringify(policy.body)}`);
  const chapter = await api(`/policies/${policy.body.id}/chapters`, {
    method: 'POST',
    token,
    json: { number: 1, title: '본문', suppressHeader: true },
  });
  const article = await api(`/policies/${policy.body.id}/chapters/${chapter.body.id}/articles`, {
    method: 'POST',
    token,
    json: { number: 1, title: '목적', content: '이 규정은 통합테스트를 목적으로 한다.' },
  });
  return { policy: policy.body, chapter: chapter.body, article: article.body };
}
