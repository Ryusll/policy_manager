import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const updateMock = vi.fn();

/**
 * zustand persist 가 붙어 있어 저장소가 없으면 경고를 쏟는다.
 * 여기서 보려는 건 동기화 규칙이라 localStorage 는 메모리로 흉내만 낸다.
 */
const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
});

vi.mock('../apps/web/src/api/tenantBranding', () => ({
  tenantBrandingApi: {
    get: (...a: unknown[]) => getMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
  },
}));

const {
  useBrandStore,
  isDefaultBranding,
  displayBrandMark,
  DEFAULT_BRAND_MARK,
  DEFAULT_BRAND_VALUES,
} = await import('../apps/web/src/stores/brandStore');

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const serverDto = (over: Record<string, unknown> = {}) => ({
  brandMark: '회',
  logoDataUrl: null,
  logoWidth: 40,
  logoHeight: 40,
  updatedAt: '2026-08-22T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  getMock.mockReset();
  updateMock.mockReset();
  useBrandStore.setState({
    ...DEFAULT_BRAND_VALUES,
    cachedTenantId: null,
    loaded: false,
  });
});

describe('isDefaultBranding', () => {
  it('기본값 그대로면 참', () => {
    expect(isDefaultBranding(DEFAULT_BRAND_VALUES)).toBe(true);
  });

  it('한 가지라도 바뀌면 거짓', () => {
    expect(isDefaultBranding({ ...DEFAULT_BRAND_VALUES, brandMark: '한' })).toBe(false);
    expect(isDefaultBranding({ ...DEFAULT_BRAND_VALUES, brandLogoDataUrl: 'data:image/png;base64,x' })).toBe(false);
    expect(isDefaultBranding({ ...DEFAULT_BRAND_VALUES, brandLogoWidth: 64 })).toBe(false);
  });
});

describe('syncFromServer (T-57)', () => {
  it('서버 값을 화면에 반영한다', async () => {
    getMock.mockResolvedValue(serverDto());
    await useBrandStore.getState().syncFromServer(TENANT_A);

    const s = useBrandStore.getState();
    expect(s.brandMark).toBe('회');
    expect(s.brandLogoWidth).toBe(40);
    expect(s.cachedTenantId).toBe(TENANT_A);
    expect(s.loaded).toBe(true);
  });

  /**
   * 서버 저장으로 바뀌었다는 이유로 이미 설정해 둔 로고가 사라지면
   * 사용자에겐 그냥 기능이 고장 난 것이다.
   */
  it('서버에 없고 로컬에만 있으면 서버로 한 번 올린다', async () => {
    useBrandStore.setState({
      brandMark: '옛',
      brandLogoDataUrl: 'data:image/png;base64,AAA',
      brandLogoWidth: 48,
      brandLogoHeight: 48,
      cachedTenantId: TENANT_A,
    });
    getMock.mockResolvedValue(serverDto({ brandMark: DEFAULT_BRAND_MARK, updatedAt: null }));
    updateMock.mockResolvedValue(serverDto({ brandMark: '옛', logoDataUrl: 'data:image/png;base64,AAA', logoWidth: 48, logoHeight: 48 }));

    await useBrandStore.getState().syncFromServer(TENANT_A, { canWrite: true });

    expect(updateMock).toHaveBeenCalledWith({
      brandMark: '옛',
      logoDataUrl: 'data:image/png;base64,AAA',
      logoWidth: 48,
      logoHeight: 48,
    });
    expect(useBrandStore.getState().brandMark).toBe('옛');
  });

  it('v2 캐시(테넌트 기록 없음)도 이관 대상으로 본다', async () => {
    // 예전 버전은 캐시에 테넌트를 남기지 않았다. null 을 "남의 것"으로 취급하면
    // 기존 사용자의 브랜딩이 첫 로그인에서 통째로 날아간다.
    useBrandStore.setState({ brandMark: '옛', cachedTenantId: null });
    getMock.mockResolvedValue(serverDto({ updatedAt: null }));
    updateMock.mockResolvedValue(serverDto({ brandMark: '옛' }));

    await useBrandStore.getState().syncFromServer(TENANT_A, { canWrite: true });
    expect(updateMock).toHaveBeenCalled();
  });

  it('저장 권한이 없으면 올리지 않되 로컬 값은 유지한다', async () => {
    useBrandStore.setState({ brandMark: '옛', cachedTenantId: TENANT_A });
    getMock.mockResolvedValue(serverDto({ updatedAt: null }));

    await useBrandStore.getState().syncFromServer(TENANT_A, { canWrite: false });

    expect(updateMock).not.toHaveBeenCalled();
    expect(useBrandStore.getState().brandMark).toBe('옛');
  });

  it('이관에 실패해도 화면은 로컬 값을 계속 보여 준다', async () => {
    useBrandStore.setState({ brandMark: '옛', cachedTenantId: TENANT_A });
    getMock.mockResolvedValue(serverDto({ updatedAt: null }));
    updateMock.mockRejectedValue(new Error('403'));

    await useBrandStore.getState().syncFromServer(TENANT_A, { canWrite: true });
    expect(useBrandStore.getState().brandMark).toBe('옛');
  });

  it('다른 회사 캐시는 서버 값으로 덮지 않고 먼저 지운다', async () => {
    // 한 브라우저로 회사를 옮기면 남의 로고가 남는다. 잠깐이라도 보이면 안 된다.
    useBrandStore.setState({
      brandMark: '남',
      brandLogoDataUrl: 'data:image/png;base64,ZZZ',
      cachedTenantId: TENANT_B,
    });
    getMock.mockResolvedValue(serverDto({ brandMark: DEFAULT_BRAND_MARK, updatedAt: null }));

    await useBrandStore.getState().syncFromServer(TENANT_A, { canWrite: true });

    expect(updateMock).not.toHaveBeenCalled();
    const s = useBrandStore.getState();
    expect(s.brandMark).toBe(DEFAULT_BRAND_MARK);
    expect(s.brandLogoDataUrl).toBeNull();
    expect(s.cachedTenantId).toBe(TENANT_A);
  });

  it('서버에 값이 있으면 로컬 캐시보다 서버가 이긴다', async () => {
    useBrandStore.setState({ brandMark: '옛', cachedTenantId: TENANT_A });
    getMock.mockResolvedValue(serverDto({ brandMark: '새' }));

    await useBrandStore.getState().syncFromServer(TENANT_A, { canWrite: true });

    expect(updateMock).not.toHaveBeenCalled();
    expect(useBrandStore.getState().brandMark).toBe('새');
  });
});

describe('saveToServer', () => {
  it('배지 문자는 2자로 자르고, 비면 기본값으로 보낸다', async () => {
    updateMock.mockResolvedValue(serverDto({ brandMark: '가나' }));
    await useBrandStore.getState().saveToServer({
      brandMark: '  가나다  ',
      brandLogoDataUrl: null,
      brandLogoWidth: 40,
      brandLogoHeight: 40,
    });
    expect(updateMock.mock.calls[0][0].brandMark).toBe('가나');

    updateMock.mockResolvedValue(serverDto());
    await useBrandStore.getState().saveToServer({
      brandMark: '   ',
      brandLogoDataUrl: null,
      brandLogoWidth: 40,
      brandLogoHeight: 40,
    });
    expect(updateMock.mock.calls[1][0].brandMark).toBe(DEFAULT_BRAND_MARK);
  });

  it('로고 크기는 허용 범위로 좁힌다', async () => {
    updateMock.mockResolvedValue(serverDto());
    await useBrandStore.getState().saveToServer({
      brandMark: '회',
      brandLogoDataUrl: null,
      brandLogoWidth: 5,
      brandLogoHeight: 500,
    });
    expect(updateMock.mock.calls[0][0].logoWidth).toBe(16);
    expect(updateMock.mock.calls[0][0].logoHeight).toBe(96);
  });
});

describe('displayBrandMark', () => {
  it('비어 있으면 기본 배지 문자', () => {
    expect(displayBrandMark('')).toBe(DEFAULT_BRAND_MARK);
    expect(displayBrandMark(undefined)).toBe(DEFAULT_BRAND_MARK);
    expect(displayBrandMark(' 한글 ')).toBe('한글');
  });
});
