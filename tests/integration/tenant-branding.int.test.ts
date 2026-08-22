import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 회사 브랜딩 서버 저장 (T-57).
 *
 * 핵심은 "기기·브라우저를 바꿔도 남아 있는가"라서, 저장한 뒤 **새로 로그인해** 확인한다.
 */

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

/** 플랜 승격은 플랫폼 관리자 API가 필요해서, 개발 DB를 직접 바꾼다 */
function promoteToPro(...slugs: string[]) {
  execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -f -'`,
    {
      encoding: 'utf8',
      input: `UPDATE tenants SET plan='pro' WHERE slug IN (${slugs.map((s) => `'${s}'`).join(',')});`,
    },
  );
}

describe('회사 브랜딩 (T-57)', () => {
  let a: Awaited<ReturnType<typeof createTenant>>;
  let b: Awaited<ReturnType<typeof createTenant>>;
  let proTokenA: string;
  let proTokenB: string;

  beforeAll(async () => {
    await waitForApi();
    [a, b] = await Promise.all([createTenant('brand-a'), createTenant('brand-b')]);
  });

  it('저장 전에는 기본값을 돌려주고 updatedAt 이 null 이다', async () => {
    // null 이어야 "아직 서버에 없다"를 구분할 수 있고, 그 신호로 로컬 브랜딩을 이관한다
    const { status, body } = await api('/tenant-branding', { token: a.token });
    expect(status).toBe(200);
    expect(body.brandMark).toBe('베');
    expect(body.updatedAt).toBeNull();
  });

  it('Starter 플랜은 저장할 수 없다', async () => {
    const { status } = await api('/tenant-branding', {
      method: 'PUT',
      token: a.token,
      json: { brandMark: '가' },
    });
    expect(status).toBe(403);
  });

  describe('Pro 승격 후', () => {
    beforeAll(async () => {
      promoteToPro(a.slug, b.slug);
      const [ra, rb] = await Promise.all([
        login(a.email, a.password, a.slug),
        login(b.email, b.password, b.slug),
      ]);
      proTokenA = ra.body.accessToken;
      proTokenB = rb.body.accessToken;
    });

    it('관리자가 저장하면 배지 문자는 2자로 잘린다', async () => {
      const { status, body } = await api('/tenant-branding', {
        method: 'PUT',
        token: proTokenA,
        json: { brandMark: '가나다', logoDataUrl: LOGO, logoWidth: 48, logoHeight: 48 },
      });
      expect(status).toBe(200);
      expect(body.brandMark).toBe('가나');
      expect(body.logoWidth).toBe(48);
      expect(body.updatedAt).not.toBeNull();
    });

    /** T-57이 존재하는 이유 — 예전에는 브라우저를 바꾸면 여기서 기본값이 나왔다 */
    it('다시 로그인해도(다른 기기) 같은 값이 나온다', async () => {
      const fresh = await login(a.email, a.password, a.slug);
      const { body } = await api('/tenant-branding', { token: fresh.body.accessToken });
      expect(body.brandMark).toBe('가나');
      expect(body.logoDataUrl).toBe(LOGO);
    });

    it('남의 회사 브랜딩은 보이지 않는다', async () => {
      const { body } = await api('/tenant-branding', { token: proTokenB });
      expect(body.brandMark).toBe('베');
      expect(body.logoDataUrl).toBeNull();
    });

    it('로고는 이미지 data URL 만 받는다', async () => {
      // 외부 URL 을 받으면 헤더가 매번 남의 서버를 부르게 된다
      const { status } = await api('/tenant-branding', {
        method: 'PUT',
        token: proTokenA,
        json: { logoDataUrl: 'https://evil.example/logo.png' },
      });
      expect(status).toBe(400);
    });

    it('로고 크기가 범위를 벗어나면 거부한다', async () => {
      const { status } = await api('/tenant-branding', {
        method: 'PUT',
        token: proTokenA,
        json: { logoWidth: 5 },
      });
      expect(status).toBe(400);
    });

    describe('viewer 권한', () => {
      let viewerToken: string;

      beforeAll(async () => {
        const email = `viewer-${a.slug}@example.test`;
        await api('/users', {
          method: 'POST',
          token: proTokenA,
          json: { email, password: a.password, name: '뷰어', role: 'viewer' },
        });
        const r = await login(email, a.password, a.slug);
        viewerToken = r.body.accessToken;
      });

      it('조회는 된다 — 헤더는 모든 구성원이 그린다', async () => {
        const { status, body } = await api('/tenant-branding', { token: viewerToken });
        expect(status).toBe(200);
        expect(body.brandMark).toBe('가나');
      });

      /**
       * 역할 제한은 서버 저장으로 옮기면서 새로 생긴 요구다. 예전에는 각자 자기
       * 브라우저만 바뀌었지만, 이제 한 사람이 바꾸면 회사 전체 화면이 바뀐다.
       */
      it('저장은 막힌다', async () => {
        const { status } = await api('/tenant-branding', {
          method: 'PUT',
          token: viewerToken,
          json: { brandMark: '탈' },
        });
        expect(status).toBe(403);
      });
    });

    it('저장이 감사 로그에 남는다', async () => {
      const { body } = await api('/audit-logs?limit=20', { token: proTokenA });
      expect(body.map((r: any) => r.action)).toContain('branding.update');
    });
  });
});
