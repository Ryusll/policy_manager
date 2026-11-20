// 시연 데이터 채우기(T-216) — 공개 API 부르기. 토큰은 이 객체 안에만 두고 출력하지 않는다(오류 글에도 싣지 않는다).
// 비밀번호 변경 요구(403 PASSWORD_CHANGE_REQUIRED)는 멈춤으로, 요청 한도(429)는 기다렸다 다시, 토큰 만료(401)는 한 번 갱신한다.

/** 사람이 먼저 할 일이 있어 멈춘다(비밀번호 변경·로그인 실패·권한) — 종료 코드 3 */
export class StopError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 오류 글에 싣는 경로 — 쿼리는 떼고, 숫자가 든 칸(규정·연결·후보 id)은 가린다(실패 글을 대장·보고에 그대로 옮겨도 id 가 남지 않게) */
export const maskPath = (path) =>
  path
    .split('?')[0]
    .split('/')
    .map((seg) => (/\d/.test(seg) ? ':id' : seg))
    .join('/');

/** API 가 거절했다 — status·본문(message·code)을 갖고, 글에는 토큰·비밀번호·id 가 없다. config: 주소가 VEDA API 가 아니다 */
export class ApiError extends Error {
  constructor(status, method, path, body, { config = false } = {}) {
    const msg = typeof body?.message === 'string' ? body.message : Array.isArray(body?.message) ? body.message.join(', ') : '';
    super(`${method} ${maskPath(path)} → ${status}${msg ? ` ${msg.slice(0, 200)}` : ''}`);
    this.status = status;
    this.body = body;
    this.config = config;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_429 = 4;

/** 로그인 401 의 까닭 — 고객사 없음·계정 틀림·비밀번호 미설정(화면 로그인과 같은 구분, lib/loginCopy) */
export function loginFailedText(body) {
  if (body?.code === 'PASSWORD_NOT_SET') return '이 계정에는 비밀번호가 설정되어 있지 않습니다 — 회사 관리자에게 비밀번호 재설정을 요청하세요.';
  if (body?.message === 'Tenant not found') return '고객사를 찾지 못했습니다 — VEDA_DEMO_TENANT(고객사 구분자)를 확인하세요.';
  return '로그인하지 못했습니다 — 이메일과 비밀번호를 확인하세요.';
}

/**
 * @param {{ base: string, fetchImpl?: typeof fetch, paceMs?: number, sleepImpl?: (ms: number) => Promise<void>, now?: () => number, log?: (s: string) => void }} o
 *   paceMs — 요청 사이 최소 간격(서버 기본 한도 분당 100회를 넘지 않게)
 */
export function createClient({ base, fetchImpl = fetch, paceMs = 700, sleepImpl = sleep, now = Date.now, log = () => {} }) {
  let access = null;
  let refresh = null;
  let last = -Infinity;

  async function send(method, path, body, auth) {
    const wait = last + paceMs - now();
    if (wait > 0) await sleepImpl(wait);
    last = now();
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && access) headers.authorization = `Bearer ${access}`;
    // 넘겨주기(3xx)를 따라가지 않는다 — 따라가면 비밀번호가 실린 본문이 다른 주소(http 포함)로 갈 수 있다
    const res = await fetchImpl(`${base}${path}`, { method, headers, redirect: 'error', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    let nonJson = false;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // JSON 이 아닌 본문(프록시 오류 화면 등)은 옮겨 적지 않는다 — 주소·내부 정보가 들어 있을 수 있다. 5xx 는 앞단이 낸 장애 화면이다
      // (api 가 내려가 있거나 다시 뜨는 중이면 web nginx 가 HTML 502 를 준다) — 어느 경로든 서버를 확인하게 한다(6차 #8)
      nonJson = true;
      data = { message: res.status >= 500 ? `JSON 이 아닌 서버 오류 응답(${res.status}) — VEDA 서버(api)가 떠 있는지 확인하세요` : `JSON 이 아닌 응답(${res.status})` };
    }
    return { status: res.status, data, nonJson, retryAfter: Number(res.headers?.get?.('retry-after')) || 0 };
  }

  /** 성공 응답인데 JSON 이 아니면(일부 경로만 화면 HTML 로 붙은 프록시 등) 성공 값으로 쓰지 않고 멈춘다 — 엉뚱한 원인으로 안내하지 않게 */
  const notApi = (status, method, path) =>
    new ApiError(status, method, path, { message: 'JSON 이 아닌 응답 — 주소가 VEDA API(/api)를 가리키는지 확인하세요' }, { config: true });

  /** 요청 한도(429)면 Retry-After 만큼 기다렸다 RETRY_429 번까지 다시 보낸다 — 토큰 갱신도 같다(9차 #8: 갱신의 429 하나로 실행이 멈췄다) */
  async function sendPatiently(method, path, body, auth, what = '요청') {
    for (let attempt = 0; ; attempt++) {
      const r = await send(method, path, body, auth);
      if (r.status !== 429 || attempt >= RETRY_429) return r;
      const s = r.retryAfter || 15;
      log(`  ${what} 한도에 걸려 ${s}초 기다렸다 다시 보냅니다.`);
      await sleepImpl(s * 1000);
    }
  }

  async function renew() {
    if (!refresh) return false;
    const r = await sendPatiently('POST', '/auth/refresh', { refreshToken: refresh }, false);
    // 갱신이 서버 장애(5xx)로 실패하거나 다시 보내도 요청 한도(429)를 넘지 못하면 원래 401 대신 그 상태를 알린다 — 인증 문제로 보이지
    // 않게(7차 #8·8차 #7). 그 밖의 거절(갱신 토큰이 낡음 등)은 원래 401 로
    if (r.status >= 500 || r.status === 429) throw new ApiError(r.status, 'POST', '/auth/refresh', r.data);
    if (r.status >= 300 || !r.data?.accessToken) return false;
    access = r.data.accessToken;
    if (r.data.refreshToken) refresh = r.data.refreshToken;
    return true;
  }

  async function request(method, path, body) {
    let renewed = false;
    for (;;) {
      const r = await sendPatiently(method, path, body, true);
      if (r.status === 401 && !renewed && (await renew())) {
        renewed = true;
        continue;
      }
      if (r.status === 403 && r.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
        throw new StopError('PASSWORD_CHANGE_REQUIRED', '이 계정은 비밀번호를 먼저 바꿔야 합니다. 화면에서 한 번 로그인해 임시 비밀번호를 바꾼 뒤 다시 실행하세요.');
      }
      if (r.status >= 300) throw new ApiError(r.status, method, path, r.data);
      if (r.nonJson) throw notApi(r.status, method, path);
      return r.data;
    }
  }

  return {
    /** 로그인 — 로그인 응답의 사용자(role·tenantName·mustChangePassword)를 돌려준다 */
    async login({ tenant, email, password }) {
      const r = await sendPatiently('POST', '/auth/login', { tenantSlug: tenant, email, password }, false, '로그인 요청');
      // 로그인 응답이 JSON 이 아니면 VEDA API 가 낸 응답이 아니다(그 API 의 로그인은 늘 JSON). 주소가 다른 곳으로 가는 상태 — 성공인데
      // 화면 HTML, 없는 경로·허용 안 되는 메서드(404·405), 앞단의 인증 관문(401·403) — 는 주소 문제다(4차). 그 밖의 상태(앞단의
      // 429·408·413, 5xx 장애 화면)는 그 상태대로 알린다 — 맞는 주소를 고치게 하거나 비밀번호 탓으로 돌리지 않는다(5차 #2·6차 #7)
      if (r.nonJson && (r.status < 300 || [401, 403, 404, 405].includes(r.status))) throw notApi(r.status, 'POST', '/auth/login');
      if (r.nonJson) throw new ApiError(r.status, 'POST', '/auth/login', r.data);
      // 계정이 틀린 것(400·401)만 계정 확인을 안내하고, 서버가 가르는 까닭대로 알린다 — 서버 장애·주소 오류를 비밀번호 탓으로
      // 돌려 거듭 넣게 하지 않는다. 서버의 로그인 401 은 셋이다(auth.service — 잠김·비활성 계정은 없다)
      if (r.status === 401) throw new StopError('LOGIN_FAILED', loginFailedText(r.data));
      if (r.status === 400) throw new StopError('LOGIN_FAILED', '로그인 요청이 거절되었습니다(400) — 이메일 형식과 비밀번호(6자 이상)를 확인하세요.');
      if (r.status >= 300) throw new ApiError(r.status, 'POST', '/auth/login', r.data);
      if (!r.data?.accessToken) throw new ApiError(r.status, 'POST', '/auth/login', { message: '토큰이 없는 로그인 응답' });
      access = r.data.accessToken;
      refresh = r.data.refreshToken ?? null;
      return r.data.user ?? {};
    },
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body = {}) => request('PUT', path, body),
    patch: (path, body = {}) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
  };
}
