import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { followOtherTab, readStoredAuth, useAuthStore } from '../stores/authStore';
import { authIdentity, authScopeOpen, authScopeSignal, currentAuthEpoch } from '../lib/authScope';

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

/** 요청을 보낸 인증 구간(T-181) — 401 재시도도 처음 보낸 구간을 그대로 들고 간다 */
type AuthRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean; _authEpoch?: number };

/** `POST /auth/login` 꼴 — 쿼리·끝 슬래시·`/api` 접두가 달라도 같은 경로로 본다 */
const routeOf = (config: InternalAxiosRequestConfig) => {
  const path = (config.url ?? '').split('?')[0].replace(/^\/api(?=\/)/, '').replace(/(.)\/+$/, '$1');
  return `${(config.method ?? 'get').toUpperCase()} ${path}`;
};

/** 로그인·가입·공개 브랜딩 — 로그인 없이 부르는 요청이라 401 이어도 토큰을 갱신하지 않는다 */
const PUBLIC_ROUTES = new Set(['POST /auth/login', 'POST /auth/register', 'GET /platform-branding']);
const isPublicAuthRequest = (config: InternalAxiosRequestConfig) => PUBLIC_ROUTES.has(routeOf(config));

// 부른 그 순간에 돈다(synchronous) — 비동기로 돌면 부른 직후 로그아웃했을 때 요청이 다음 구간으로 찍힌다
client.interceptors.request.use(
  (config: AuthRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) config.headers.Authorization = 'Bearer ' + token;
    // 공개 요청만 구간 밖이다. 로그아웃 요청은 구간 안 — 기다리는 사이 다른 탭을 따라 다른 사람이 들어오면
    // 응답 뒤의 `logout()` 이 그 사람을 지우지 않게 결과를 넘기지 않는다(이 탭은 이미 다른 탭을 따라갔다)
    if (!isPublicAuthRequest(config)) {
      // 로그아웃·다른 사용자 로그인 때 이 요청을 끊는다 — 앞 사용자의 응답이 다음 사용자에게 닿지 않게.
      // 호출자가 자기 신호를 넘기면 끊기지는 않지만, 응답은 아래 구간 검사가 막는다
      config._authEpoch ??= currentAuthEpoch();
      config.signal ??= authScopeSignal();
    }
    return config;
  },
  null,
  { synchronous: true },
);

/** 앞 인증 구간의 요청이다 — 로그아웃했거나 다른 사람이 들어온 뒤(또는 화면을 새로 여는 중에) 결과가 왔다 */
const isStaleScope = (config: AuthRequestConfig | undefined) =>
  config?._authEpoch !== undefined && (config._authEpoch !== currentAuthEpoch() || !authScopeOpen());

/** 갱신을 시작한 구간이 아직 이어지는가 */
const sameScope = (epoch: number) => currentAuthEpoch() === epoch;

/**
 * 다른 탭이 로그아웃했거나 다른 사람으로 들어왔는데 이 탭이 아직 모른다(저장소 이벤트 전) — 저장소를
 * 따라가고 참. 그 토큰을 앞 사람의 요청에 쓰거나 앞 사람의 토큰으로 저장소를 덮지 않게 한다
 * (주체가 바뀌어 구간이 닫히고, 기다리던 요청의 결과는 버려진다).
 */
async function followedOtherTab(): Promise<boolean> {
  const stored = readStoredAuth();
  if (!stored || stored.identity === authIdentity(useAuthStore.getState())) return false;
  await followOtherTab();
  return true;
}

/**
 * 앞 구간 요청의 결과(성공·실패·끊김)는 어디에도 넘기지 않는다 — 끝나지 않은 채로 둔다.
 * 그 결과를 기다리던 화면은 이미 사라졌고, 넘기면 다음 사용자의 화면에 앞 사람의 데이터가
 * 들어가거나(onSuccess 의 캐시 쓰기) 로그인 화면에 "실패" 토스트가 뜬다 — 서버는 그 작업을 끝까지
 * 했을 수 있어 사실과도 다르다. 기다리는 쪽이 없어진 약속은 가비지로 사라진다.
 */
const dropStaleResult = () => new Promise<never>(() => {});

/** 여러 탭이 같은 갱신 토큰으로 동시에 갱신하지 않게 브라우저 전체에서 한 번에 하나씩 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  // Web Locks 가 없는 오래된 브라우저는 탭 안에서만 한 번으로 묶는다(같은 탭 동시 요청은 inflight 가 막는다)
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('pm-auth-refresh', () => fn()) as Promise<T>;
  }
  return fn();
}

let inflight: { epoch: number; promise: Promise<string | null> } | null = null;

/**
 * 접근 토큰 갱신 (T-137).
 *
 * 서버는 갱신할 때마다 **갱신 토큰도 새로 주고 옛 것은 막는다**(회전, T-42). 예전 화면은 새 갱신
 * 토큰을 버리고 처음 받은 것을 계속 내서, 로그인 30분쯤 뒤 두 번째 갱신이 거절돼 로그인 화면으로
 * 튕겼다. 이제 둘 다 저장하고, 같은 탭의 동시 요청은 한 번만, 다른 탭과는 잠금으로 순서대로 갱신한다.
 * 다른 탭이 먼저 갱신했으면 저장소의 새 토큰을 그대로 쓴다.
 *
 * 갱신은 시작한 인증 구간 안에서만 쓴다(T-181) — 기다리는 사이 로그아웃하고 다른 사람이 들어오면
 * 앞 사람의 갱신 응답이 새 사람의 토큰을 덮거나, 새 사람의 토큰을 앞 사람의 재시도에 내주게 된다.
 */
export function refreshAccessToken(staleAccessToken: string | null): Promise<string | null> {
  const epoch = currentAuthEpoch();
  if (inflight?.epoch !== epoch) {
    // 주체가 바뀌면 이 갱신 요청도 끊는다 — 브라우저 잠금 안에서 기다리는 다음 사람의 갱신을 막지 않게
    const signal = authScopeSignal();
    const promise: Promise<string | null> = withRefreshLock(async () => {
      if (!sameScope(epoch) || (await followedOtherTab())) return null;
      const stored = readStoredAuth();
      if (stored?.accessToken && stored.accessToken !== staleAccessToken) {
        useAuthStore.getState().setTokens(stored.accessToken, stored.refreshToken);
        return stored.accessToken;
      }
      const refreshToken = stored?.refreshToken ?? useAuthStore.getState().refreshToken;
      if (!refreshToken) return null;
      try {
        const { data } = await axios.post('/api/auth/refresh', { refreshToken }, { signal });
        // 응답을 기다리는 사이 다른 탭이 로그아웃·전환했을 수 있다 — 쓰면 저장소 전체를 앞 사람으로 덮는다
        if (!sameScope(epoch) || (await followedOtherTab())) return null;
        useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
        return data.accessToken as string;
      } catch {
        // 실패한 사이 다른 탭이 로그아웃·전환했으면 따라간다 — 아니면 이 실패로 이 탭이 로그아웃하며
        // 저장소를 비워 다른 탭에 들어온 사람까지 내보낸다
        await followedOtherTab();
        return null;
      }
    }).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { epoch, promise };
  }
  return inflight.promise;
}

client.interceptors.response.use(
  (res) => (isStaleScope(res.config) ? dropStaleResult() : res),
  async (error: AxiosError) => {
    // `_retry` 는 우리가 붙이는 표시다 — 같은 요청으로 무한히 갱신을 돌지 않게 한다.
    const original = error.config as AuthRequestConfig | undefined;
    // 앞 사용자의 요청이 늦게 실패했거나 끊겼다 — 갱신·재시도·로그아웃·변경 화면 전환을 지금 사용자에게 하지 않는다
    if (isStaleScope(original)) return dropStaleResult();
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isPublicAuthRequest(original)
    ) {
      original._retry = true;
      const sent = String(original.headers?.Authorization ?? '').replace(/^Bearer /, '') || null;
      const token = await refreshAccessToken(sent ?? useAuthStore.getState().accessToken);
      // 갱신을 기다리는 사이 주체가 바뀌었다 — 새 사용자의 토큰으로 다시 보내거나 그 사람을 내보내지 않는다
      if (isStaleScope(original)) return dropStaleResult();
      if (token) {
        original.headers.Authorization = 'Bearer ' + token;
        return client(original);
      }
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    // 다른 곳(관리자 재설정 등)에서 변경 필요 상태가 됐다 — 화면을 비밀번호 변경으로 돌린다(T-122)
    const code = (error.response?.data as { code?: string } | undefined)?.code;
    if (error.response?.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
      const { user, setUser } = useAuthStore.getState();
      if (user && !user.mustChangePassword) setUser({ ...user, mustChangePassword: true });
    }
    return Promise.reject(error);
  },
);

export default client;