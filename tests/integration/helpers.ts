import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

/**
 * 통합 테스트 공용 헬퍼 — 실제로 떠 있는 API를 HTTP로 두드린다.
 *
 * 서비스 클래스를 직접 부르지 않고 HTTP로 가는 이유는, 막고 싶은 사고가 대부분
 * 가드·파이프·라우팅에서 나기 때문이다(권한 누락, 검증 우회, 테넌트 격리).
 * 서비스만 부르면 그 층을 통째로 건너뛴다.
 */

export const BASE = process.env.API_BASE_URL || 'http://localhost:3001/api';

export type Json = Record<string, any>;

/**
 * 요청 하나를 **새 연결**로 보낸다(keep-alive 없음, T-140).
 *
 * fetch 는 쉬는 연결을 다시 쓴다. 시험이 execSync(psql 폴링·도커 명령·CLI)로 이벤트 루프를 몇 초 막는 사이 API 가 그 연결을
 * 닫으면(keepAliveTimeout 5초) 다음 요청이 닫힌 소켓에 실려 ECONNRESET·"fetch failed"·"other side closed" 로 실패한다 —
 * 부하가 높을 때 lock-order·law-sync 시험이 흔들린 까닭. 요청마다 새 연결이면 닫힌 소켓을 다시 쓸 일이 없다.
 * 본문은 문자열이나 FormData(파일 올리기 — 경계 문자열을 붙인 multipart 로 바꿔 보낸다).
 */
async function send(url: string, method: string, headers: Record<string, string>, body: unknown) {
  let payload: Buffer | undefined;
  const h = { ...headers };
  if (body instanceof FormData) {
    const encoded = new Response(body);
    payload = Buffer.from(await encoded.arrayBuffer());
    h['Content-Type'] = encoded.headers.get('content-type')!;
  } else if (typeof body === 'string') {
    payload = Buffer.from(body, 'utf8');
  } else if (body != null) {
    throw new Error('api(): 본문은 문자열이나 FormData 만 보낼 수 있습니다');
  }
  if (payload) h['Content-Length'] = String(payload.length);
  const u = new URL(url);
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method, headers: h, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });
}

export async function api(
  path: string,
  init: RequestInit & { token?: string; json?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const { token, json, headers, method } = init;
  const res = await send(
    `${BASE}${path}`,
    method ?? 'GET',
    {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    json !== undefined ? JSON.stringify(json) : init.body,
  );
  let body: any;
  try {
    body = res.text ? JSON.parse(res.text) : null;
  } catch {
    body = res.text;
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
  return {
    slug,
    email,
    password,
    token: body.accessToken as string,
    refreshToken: body.refreshToken as string,
    user: body.user,
  };
}

/**
 * 회사의 규정 질문(AI)을 켠다 — 회사마다 꺼진 채 시작하고, 관리자가 외부 전송 고지를 확인해야 켜진다(T-146).
 * 화면처럼 상태에서 받은 고지 판을 그대로 보낸다. 관리자 토큰을 넘긴다.
 */
export async function enableAsk(adminToken: string) {
  const st = await api('/ask/status', { token: adminToken });
  const res = await api('/ask/settings', {
    method: 'PATCH',
    token: adminToken,
    json: { enabled: true, noticeVersion: st.body.notice?.version },
  });
  if (res.status >= 300) throw new Error(`규정 질문 켜기 실패 (${res.status}): ${JSON.stringify(res.body)}`);
  return res;
}

/**
 * 로그인. 관리자가 정해 준 비밀번호로 **처음** 들어온 계정(`mustChangePassword`)이면 비밀번호를
 * 바꾸기 전까지 거의 모든 API 가 403 이다(T-122). 테스트의 초대 계정은 "이미 첫 로그인을 마친
 * 직원"으로 다룬다 — 다른 값으로 바꿨다가 원래 비밀번호로 되돌린 뒤 다시 로그인해 돌려준다.
 * 그래야 이후 같은 비밀번호로 다시 로그인하는 테스트가 그대로 돌고, "권한이 없어 403"을 보는
 * 테스트가 "비밀번호를 안 바꿔서 403"으로 엉뚱하게 통과하지 않는다.
 * 강제 변경 자체는 `account-provisioning.int.test.ts` 가 `/auth/login` 을 직접 불러 검증한다.
 */
export async function login(email: string, password: string, tenantSlug: string) {
  const first = await api('/auth/login', { method: 'POST', json: { email, password, tenantSlug } });
  if (first.status !== 200 || !first.body?.user?.mustChangePassword) return first;

  const token = first.body.accessToken as string;
  const interim = `${password}#onboard`;
  for (const [currentPassword, newPassword] of [
    [password, interim],
    [interim, password],
  ]) {
    const changed = await api('/users/me/password', {
      method: 'POST',
      token,
      json: { currentPassword, newPassword },
    });
    if (changed.status !== 200) {
      throw new Error(`초대 계정 첫 로그인 처리 실패 (${changed.status}): ${JSON.stringify(changed.body)}`);
    }
  }
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
