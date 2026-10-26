import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios, {
  AxiosError,
  CanceledError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

/**
 * 인증 주체가 바뀌면 앞 사용자의 화면 캐시·진행 중 요청·토큰 갱신·안내·회사 로고를 버린다 (T-181).
 * zustand persist 가 쓰는 localStorage 는 메모리로 흉내 낸다(다른 탭은 이 저장소를 직접 고쳐 흉내 낸다).
 */
const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
});

const { useAuthStore, followOtherTab, listenOtherTabs } = await import('../apps/web/src/stores/authStore');
const { useBrandStore } = await import('../apps/web/src/stores/brandStore');
const { useToastStore } = await import('../apps/web/src/stores/toastStore');
const { queryClient } = await import('../apps/web/src/lib/queryClient');
const { default: client, refreshAccessToken } = await import('../apps/web/src/api/client');
const { authIdentity, currentAuthEpoch, needsReloadOnIdentityChange } = await import(
  '../apps/web/src/lib/authScope'
);

const userOf = (id: string, tenantId: string, role = 'admin') => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role,
  tenantId,
  tenantSlug: tenantId,
  tenantName: tenantId,
  plan: 'starter',
});
const USER_A = userOf('user-a', 'tenant-a');
const USER_A2 = userOf('user-a2', 'tenant-a', 'viewer'); // 같은 회사의 다른 직원
const USER_B = userOf('user-b', 'tenant-b', 'viewer');

/** 다른 탭이 로그인 정보를 바꿨다 — 저장소만 바뀌고 이 탭의 메모리는 그대로다 */
function writeOtherTab(state: Record<string, unknown>) {
  memStore.set('auth-storage', JSON.stringify({ state, version: 0 }));
}
const B_SIGNED_IN = { user: USER_B, accessToken: 'at-b', refreshToken: 'rt-b', remember: true, isAuthenticated: true };

type Pending = { config: InternalAxiosRequestConfig; resolve: (data: unknown) => void; reject: (e: unknown) => void };
let pending: Pending[] = [];

/** 서버 대신 — 끊으면(abort) 거절하고, 아니면 시험이 정한 때 응답한다 */
const fakeAdapter: AxiosAdapter = (config) => {
  return new Promise<AxiosResponse>((resolve, reject) => {
    const signal = config.signal as AbortSignal | undefined;
    signal?.addEventListener('abort', () => reject(new CanceledError('aborted', config)));
    pending.push({
      config,
      resolve: (data) => resolve({ data, status: 200, statusText: 'OK', headers: {}, config }),
      reject,
    });
  });
};

/** 끊는 신호를 듣지 않는 서버 — 늦게 온 결과를 화면 쪽이 버리는지 본다 */
const deafAdapter: AxiosAdapter = (config) => {
  return new Promise<AxiosResponse>((resolve, reject) => {
    pending.push({
      config,
      resolve: (data) => resolve({ data, status: 200, statusText: 'OK', headers: {}, config }),
      reject,
    });
  });
};

const httpError = (config: InternalAxiosRequestConfig, status: number, data: unknown) =>
  new AxiosError('error', 'ERR_BAD_REQUEST', config, null, { status, statusText: '', headers: {}, config, data });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 약속이 끝났는지 — 앞 사용자의 결과는 성공도 실패도 아닌 '끝나지 않음'이어야 한다 */
async function outcome(p: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  p.then(
    () => (state = 'resolved'),
    () => (state = 'rejected'),
  );
  await new Promise((r) => setTimeout(r, 30));
  return state;
}

function fakeWindow() {
  const location = { href: '/policies', replace: vi.fn(), protocol: 'http:' };
  (globalThis as { window?: unknown }).window = { location };
  return location;
}

beforeEach(() => {
  useAuthStore.getState().logout();
  memStore.clear();
  queryClient.clear();
  useToastStore.setState({ items: [] });
  useBrandStore.getState().clearCache();
  pending = [];
  client.defaults.adapter = fakeAdapter;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('인증 주체 (T-181)', () => {
  it('회사·사용자 id 만 본다 — 로그아웃은 없음', () => {
    expect(authIdentity({ isAuthenticated: true, user: USER_A })).toBe('tenant-a:user-a');
    expect(authIdentity({ isAuthenticated: false, user: USER_A })).toBeNull();
    expect(authIdentity({ isAuthenticated: true, user: null })).toBeNull();
  });

  it('다른 탭에서 바로 다른 사람이 됐을 때만 화면을 새로 연다', () => {
    expect(needsReloadOnIdentityChange('t:a', 't:b')).toBe(true);
    expect(needsReloadOnIdentityChange('t:a', null)).toBe(false); // 로그아웃 — 로그인 화면으로 간다
    expect(needsReloadOnIdentityChange(null, 't:b')).toBe(false); // 로그인 화면에서 들어옴
    expect(needsReloadOnIdentityChange('t:a', 't:a')).toBe(false); // 토큰 갱신
  });
});

describe('주체가 바뀌면 화면 캐시를 버린다 (T-181)', () => {
  it('로그아웃하면 앞 사용자의 캐시가 남지 않는다', () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    queryClient.setQueryData(['policies'], ['A 회사 초안']);
    useAuthStore.getState().logout();
    expect(queryClient.getQueryData(['policies'])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('로그아웃 없이 다른 사람으로 들어와도 비운다', () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    queryClient.setQueryData(['policies'], ['A 회사 초안']);
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    expect(queryClient.getQueryData(['policies'])).toBeUndefined();
  });

  it('같은 사람의 토큰 갱신·이름·역할·요금제 변경은 비우지 않는다', () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    queryClient.setQueryData(['policies'], ['A 회사 규정']);
    const epoch = currentAuthEpoch();
    const s = useAuthStore.getState();
    s.setTokens('at-a2', 'rt-a2');
    s.setAccessToken('at-a3');
    s.setUser({ ...USER_A, name: '새 이름', role: 'viewer', mustChangePassword: true });
    s.updateUserPlan('pro');
    s.setRemember(true);
    expect(queryClient.getQueryData(['policies'])).toEqual(['A 회사 규정']);
    expect(currentAuthEpoch()).toBe(epoch);
  });

  it('로그아웃 전에 보낸 조회의 늦은 응답은 캐시에 들어가지 않는다', async () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const late = deferred<string>();
    const fetching = queryClient
      .fetchQuery({ queryKey: ['policy', 'p1'], queryFn: () => late.promise })
      .catch((e: unknown) => e);
    useAuthStore.getState().logout();
    late.resolve('A 회사 초안');
    await fetching;
    expect(queryClient.getQueryData(['policy', 'p1'])).toBeUndefined();

    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    const fresh = await queryClient.fetchQuery({ queryKey: ['policy', 'p1'], queryFn: () => Promise.resolve('B 회사 규정') });
    expect(fresh).toBe('B 회사 규정');
  });

  it('떠 있는 안내를 내린다 — 로그아웃 뒤에 띄운 안내는 남는다', () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    useToastStore.setState({ items: [{ id: 't1', message: 'A회사 규정을 저장했습니다', variant: 'success' }] });
    useAuthStore.getState().logout();
    expect(useToastStore.getState().items).toHaveLength(0);
    // 비밀번호 변경 화면처럼 로그아웃한 다음에 띄운 안내
    useToastStore.setState({ items: [{ id: 't2', message: '다시 로그인하세요', variant: 'success' }] });
    useAuthStore.getState().setRemember(false); // 주체가 그대로인 변경
    expect(useToastStore.getState().items).toHaveLength(1);
  });

  it('다른 회사 사람이 들어오면 앞 회사의 로고를 첫 화면 전에 지운다 — 로그아웃·같은 회사는 둔다', () => {
    const LOGO = 'data:image/png;base64,QQ==';
    const brandA = () => useBrandStore.setState({ brandMark: 'A', brandLogoDataUrl: LOGO, cachedTenantId: 'tenant-a', loaded: true });

    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    brandA();
    useAuthStore.getState().logout();
    expect(useBrandStore.getState().brandLogoDataUrl).toBe(LOGO); // 로그인 화면의 회사 로고
    useAuthStore.getState().setAuth(USER_A2, 'at-a2', 'rt-a2');
    expect(useBrandStore.getState().brandLogoDataUrl).toBe(LOGO); // 같은 회사 — 기본 배지로 튀지 않는다
    useAuthStore.getState().logout();
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    expect(useBrandStore.getState().brandLogoDataUrl).toBeNull(); // 다른 회사 — 지운다
    expect(useBrandStore.getState().cachedTenantId).toBeNull();
  });

  it('회사 기록이 없는 예전 로고 캐시(v2)는 지우지 않는다 — 첫 동기화가 서버로 올린다', () => {
    const LEGACY = 'data:image/png;base64,TEc=';
    useBrandStore.setState({ brandMark: 'L', brandLogoDataUrl: LEGACY, cachedTenantId: null, loaded: false });
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    expect(useBrandStore.getState().brandLogoDataUrl).toBe(LEGACY);
  });
});

describe('앞 사용자의 요청 결과는 다음 사용자에게 넘기지 않는다 (T-181)', () => {
  it('진행 중 요청은 끊기고 결과는 끝나지 않은 채 남는다(실패 안내가 뜨지 않는다), 다음 요청은 새 신호로 나간다', async () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const oldRequest = client.post('/law-sync/run');
    useAuthStore.getState().logout();
    expect((pending[0].config.signal as AbortSignal).aborted).toBe(true);
    expect(await outcome(oldRequest)).toBe('pending');

    const next = client.get('/auth/options');
    expect((pending[1].config.signal as AbortSignal).aborted).toBe(false);
    pending[1].resolve({ ok: true });
    await expect(next).resolves.toMatchObject({ data: { ok: true } });
  });

  it('끊는 신호를 듣지 않는 응답이 늦게 와도 넘기지 않는다', async () => {
    client.defaults.adapter = deafAdapter;
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const oldRequest = client.get('/policies/p1', { signal: new AbortController().signal });
    useAuthStore.getState().logout();
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    pending[0].resolve({ title: 'A 회사 초안' });
    expect(await outcome(oldRequest)).toBe('pending');
  });

  it('앞 사용자 요청의 늦은 401 은 갱신·재시도·로그아웃을 하지 않는다', async () => {
    client.defaults.adapter = deafAdapter;
    const post = vi.spyOn(axios, 'post');
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const oldRequest = client.post('/policies/p1/approve', {}, { signal: new AbortController().signal });
    useAuthStore.getState().logout();
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    pending[0].reject(httpError(pending[0].config, 401, {}));
    expect(await outcome(oldRequest)).toBe('pending');
    expect(post).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1); // 다시 보내지 않았다
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.id).toBe('user-b');
    expect(s.accessToken).toBe('at-b');
  });

  it('앞 사용자 요청의 늦은 "비밀번호 변경 필요"는 다음 사용자를 변경 화면으로 보내지 않는다', async () => {
    client.defaults.adapter = deafAdapter;
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const oldRequest = client.get('/policies', { signal: new AbortController().signal });
    useAuthStore.getState().logout();
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    pending[0].reject(httpError(pending[0].config, 403, { code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(await outcome(oldRequest)).toBe('pending');
    expect(useAuthStore.getState().user?.mustChangePassword).toBeUndefined();
  });

  it('갱신을 기다리는 사이 다른 사람이 들어오면 그 사람을 내보내지 않는다', async () => {
    const location = fakeWindow();
    const reply = deferred<{ data: { accessToken: string; refreshToken: string } }>();
    vi.spyOn(axios, 'post').mockReturnValueOnce(reply.promise);
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const request = client.get('/policies');
    pending[0].reject(httpError(pending[0].config, 401, {}));
    await flush(); // 갱신이 시작됐다

    useAuthStore.getState().logout();
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    reply.resolve({ data: { accessToken: 'at-a2', refreshToken: 'rt-a2' } });
    expect(await outcome(request)).toBe('pending');
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.id).toBe('user-b');
    expect(s.accessToken).toBe('at-b');
    expect(location.href).toBe('/policies'); // 로그인 화면으로 보내지 않았다
  });

  it('로그인 요청은 누구의 구간에도 넣지 않는다 — 기다리는 사이 다른 탭이 들어와도 끝까지 받는다', async () => {
    const login = client.post('/auth/login', { email: 'c@example.com' });
    expect(pending[0].config.signal).toBeUndefined();
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    pending[0].resolve({ accessToken: 'at-c' });
    await expect(login).resolves.toMatchObject({ data: { accessToken: 'at-c' } });
  });

  it('로그아웃 요청을 기다리는 사이 다른 탭을 따라 다른 사람이 들어오면, 그 결과를 넘기지 않아 새 사람을 로그아웃시키지 않는다', async () => {
    client.defaults.adapter = deafAdapter; // 끊겨도 서버는 응답한다
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    let loggedOutAfterResponse = false;
    const handleLogout = client.post('/auth/logout').then(() => {
      useAuthStore.getState().logout(); // 화면의 로그아웃 처리(Layout)는 응답 뒤에 로그아웃한다
      loggedOutAfterResponse = true;
    });
    useAuthStore.getState().logout(); // 다른 탭의 로그아웃을 따라갔다
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b'); // 다른 탭의 B 로그인을 따라갔다
    pending[0].resolve({ ok: true });
    expect(await outcome(handleLogout)).toBe('pending');
    expect(loggedOutAfterResponse).toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('user-b');
  });

  it('구간 밖 요청은 메서드·경로가 맞을 때만 — 쿼리·끝 슬래시·/api 접두는 같게, 이름이 비슷한 쓰기 요청은 구간 안이다', () => {
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    void client.get('/platform-branding?v=1');
    void client.post('/auth/login/').catch(() => undefined);
    void client.post('/api/auth/register').catch(() => undefined);
    void client.put('/platform-branding', {}).catch(() => undefined);
    void client.post('/auth/login-history').catch(() => undefined);
    void client.post('/auth/logout').catch(() => undefined);
    expect(pending.map((p) => p.config.signal === undefined)).toEqual([true, true, true, false, false, false]);
  });
});

describe('토큰 갱신은 시작한 주체 안에서만 쓴다 (T-181)', () => {
  it('갱신을 기다리는 사이 다른 사람이 들어오면 앞 사람의 갱신을 끊고, 그 응답이 토큰을 덮지 않는다', async () => {
    const reply = deferred<{ data: { accessToken: string; refreshToken: string } }>();
    const post = vi.spyOn(axios, 'post').mockReturnValueOnce(reply.promise);
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const refreshing = refreshAccessToken('at-a');
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    const staleSignal = (post.mock.calls[0][2] as { signal?: AbortSignal } | undefined)?.signal;
    expect(staleSignal?.aborted).toBe(false);

    useAuthStore.getState().logout();
    expect(staleSignal?.aborted).toBe(true); // 브라우저 잠금 안에서 다음 사람의 갱신을 막지 않게
    useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
    post.mockResolvedValueOnce({ data: { accessToken: 'at-b2', refreshToken: 'rt-b2' } });
    const refreshingB = refreshAccessToken('at-b');
    expect(refreshingB).not.toBe(refreshing); // 앞 사람의 갱신을 같이 기다리지 않는다
    await expect(refreshingB).resolves.toBe('at-b2');

    reply.resolve({ data: { accessToken: 'at-a2', refreshToken: 'rt-a2' } });
    await expect(refreshing).resolves.toBeNull();
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('at-b2');
    expect(s.refreshToken).toBe('rt-b2');
  });

  it('갱신 응답을 기다리는 사이 다른 탭이 로그아웃했으면(이 탭이 아직 모를 때) 저장소를 앞 사람으로 덮지 않고 따라간다', async () => {
    const reply = deferred<{ data: { accessToken: string; refreshToken: string } }>();
    vi.spyOn(axios, 'post').mockReturnValueOnce(reply.promise);
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    const refreshing = refreshAccessToken('at-a');
    await flush();
    writeOtherTab({ user: null, accessToken: null, refreshToken: null, remember: null, isAuthenticated: false });
    reply.resolve({ data: { accessToken: 'at-a2', refreshToken: 'rt-a2' } });

    await expect(refreshing).resolves.toBeNull();
    expect(JSON.parse(memStore.get('auth-storage')!).state.isAuthenticated).toBe(false); // 되살리지 않았다
    expect(useAuthStore.getState().isAuthenticated).toBe(false); // 이 탭도 로그아웃을 따라갔다
  });

  it('갱신이 실패한 사이 다른 탭이 다른 사람으로 바꿨으면 이 탭이 로그아웃하며 그 사람을 내보내지 않는다', async () => {
    const location = fakeWindow();
    let failPost!: (e: unknown) => void;
    vi.spyOn(axios, 'post').mockReturnValueOnce(new Promise((_, reject) => (failPost = reject)));
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    const request = client.get('/policies');
    pending[0].reject(httpError(pending[0].config, 401, {}));
    await flush(); // 갱신이 나갔다
    writeOtherTab(B_SIGNED_IN);
    failPost(new Error('network'));

    expect(await outcome(request)).toBe('pending');
    expect(location.replace).toHaveBeenCalledWith('/');
    expect(JSON.parse(memStore.get('auth-storage')!).state.accessToken).toBe('at-b'); // B 가 그대로다
  });

  it('브라우저 잠금을 기다리는 사이 다른 사람이 들어오면, 잠금을 얻어도 앞 사람의 갱신을 하지 않는다', async () => {
    const gate = deferred<void>();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { locks: { request: (_name: string, fn: () => Promise<unknown>) => gate.promise.then(fn) } },
    });
    try {
      const post = vi.spyOn(axios, 'post');
      useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
      const refreshing = refreshAccessToken('at-a'); // 다른 탭의 갱신이 잠금을 쥐고 있다
      useAuthStore.getState().logout();
      useAuthStore.getState().setAuth(USER_B, 'at-b', 'rt-b');
      gate.resolve();
      await expect(refreshing).resolves.toBeNull(); // B 의 토큰을 앞 사람의 요청에 내주지 않는다
      expect(post).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it('다른 탭이 다른 사람으로 바꿨으면 그 토큰을 앞 사람의 요청에 쓰지도, 그 사람을 내보내지도 않고 새로 연다', async () => {
    const location = fakeWindow();
    const post = vi.spyOn(axios, 'post');
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a');
    const request = client.get('/policies');
    writeOtherTab(B_SIGNED_IN);
    pending[0].reject(httpError(pending[0].config, 401, {}));

    expect(await outcome(request)).toBe('pending');
    expect(post).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1); // B 의 토큰으로 다시 보내지 않았다
    expect(location.replace).toHaveBeenCalledWith('/');
    expect(JSON.parse(memStore.get('auth-storage')!).state.accessToken).toBe('at-b'); // B 를 로그아웃시키지 않았다
  });
});

describe('다른 탭 따라가기 (T-181)', () => {
  it('저장소 이벤트를 듣고 따라간다 — 다른 키는 무시한다', async () => {
    const location = fakeWindow();
    const listeners: Array<(e: { key: string | null }) => void> = [];
    listenOtherTabs({
      addEventListener: (type: string, fn: (e: { key: string | null }) => void) => {
        if (type === 'storage') listeners.push(fn);
      },
    } as unknown as Pick<Window, 'addEventListener'>);
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    writeOtherTab(B_SIGNED_IN);

    listeners[0]({ key: 'veda-theme' });
    await flush();
    expect(location.replace).not.toHaveBeenCalled();

    listeners[0]({ key: 'auth-storage' });
    await flush();
    expect(location.replace).toHaveBeenCalledWith('/');
  });

  it('다른 탭이 로그아웃하면 로그아웃만 따라가고(로그인 화면으로 간다) 새로 열지 않는다', async () => {
    const location = fakeWindow();
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    queryClient.setQueryData(['policies'], ['A 회사 초안']);
    writeOtherTab({ user: null, accessToken: null, refreshToken: null, remember: null, isAuthenticated: false });

    await followOtherTab();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(queryClient.getQueryData(['policies'])).toBeUndefined();
    expect(location.replace).not.toHaveBeenCalled();
  });

  it('다른 탭이 바로 다른 사람이 되면 새 사람으로 다시 그리지 않고 요청을 끊은 뒤 첫 화면부터 새로 연다', async () => {
    const location = fakeWindow();
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    const inFlight = client.get('/policies/a-policy');
    const epoch = currentAuthEpoch();
    writeOtherTab(B_SIGNED_IN);

    await followOtherTab();
    expect(location.replace).toHaveBeenCalledWith('/');
    expect(useAuthStore.getState().user?.id).toBe('user-a'); // B 의 토큰으로 A 의 주소를 부르지 않는다
    expect(currentAuthEpoch()).toBe(epoch + 1);
    expect((pending[0].config.signal as AbortSignal).aborted).toBe(true);
    expect(await outcome(inFlight)).toBe('pending');
  });

  it('새로 여는 중에는 요청을 보내지도 끝내지도 않고, 갱신으로 저장소(다른 탭의 B)를 덮지 않는다', async () => {
    fakeWindow();
    const post = vi.spyOn(axios, 'post');
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    writeOtherTab(B_SIGNED_IN);
    await followOtherTab();

    const late = client.get('/policies'); // 앞 사람의 화면이 새로 열리기 전에 보낸 요청
    expect(pending).toHaveLength(0); // 보내지 않았다
    expect(await outcome(late)).toBe('pending');
    await expect(refreshAccessToken('at-a')).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(JSON.parse(memStore.get('auth-storage')!).state.accessToken).toBe('at-b');

    // 닫힌 구간은 다음 주체 변경이 다시 연다(실제로는 그 전에 새로 열린다)
    useAuthStore.getState().logout();
    const after = client.get('/auth/options');
    expect(pending).toHaveLength(1);
    pending[0].resolve({ ok: true });
    await expect(after).resolves.toMatchObject({ data: { ok: true } });
  });

  it('다른 탭의 토큰 갱신은 같은 사람이라 캐시를 두고 새로 열지 않는다', async () => {
    const location = fakeWindow();
    useAuthStore.getState().setAuth(USER_A, 'at-a', 'rt-a', true);
    queryClient.setQueryData(['policies'], ['A 회사 규정']);
    writeOtherTab({ user: USER_A, accessToken: 'at-a2', refreshToken: 'rt-a2', remember: true, isAuthenticated: true });

    await followOtherTab();
    expect(useAuthStore.getState().accessToken).toBe('at-a2');
    expect(queryClient.getQueryData(['policies'])).toEqual(['A 회사 규정']);
    expect(location.replace).not.toHaveBeenCalled();
  });
});
