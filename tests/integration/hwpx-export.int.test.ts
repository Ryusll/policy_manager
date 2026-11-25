import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { api, createTenant, createPolicyWithArticle, login, waitForApi, BASE } from './helpers';

/**
 * 한/글 내보내기 (T-85).
 *
 * 만들어지는 파일은 `.hwp` 가 아니라 `.hwpx` 다 — `.hwp` 는 한컴 독점 바이너리라
 * 서버에서 만들 수단이 없고, `.hwpx` 는 같은 한/글이 여는 KS X 6101 표준이다(ADR-0016).
 *
 * **한/글에서 실제로 열리는지는 여기서 확인할 수 없다**(컨테이너에 한/글이 없다).
 * 대신 패키지가 규격을 지키는지를 확인한다 — OCF 규칙(mimetype 이 첫 항목·무압축),
 * 필수 파일 존재, XML 파싱 가능, 본문 보존.
 */

const HTML =
  '<h2>제1장 총칙</h2><h3>제1조(목적)</h3><p>이 규정은 회사 임직원의 인사에 관한 사항을 정함을 목적으로 한다.</p>' +
  '<p>① 정규직·계약직 모두에게 적용한다.</p><h3>제2조(적용범위)</h3><p>본사 및 지점에 적용한다.</p>';

describe('한/글 HWPX 내보내기 (T-85)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;
  let bytes: Uint8Array;
  let files: Record<string, Uint8Array>;

  const exportHwpx = (token: string, id: string, body: unknown) =>
    fetch(`${BASE}/policies/${id}/export/hwpx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('hwpx');
    const set = await createPolicyWithArticle(t.token, `HX-${Date.now().toString(36)}`, '인사규정');
    policyId = set.policy.id;

    const res = await exportHwpx(t.token, policyId, { html: HTML });
    expect(res.status).toBe(200);
    bytes = new Uint8Array(await res.arrayBuffer());
    files = unzipSync(bytes);
  }, 90_000);

  it('HWPX(application/hwp+zip)로 응답한다', async () => {
    const res = await exportHwpx(t.token, policyId, { html: HTML });
    expect(res.headers.get('content-type')).toBe('application/hwp+zip');
    // 파일명에 한글이 들어가므로 RFC 5987 로 실어야 브라우저가 깨뜨리지 않는다
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(res.headers.get('content-disposition')).toContain('.hwpx');
  });

  it('ZIP 으로 열리고 OWPML 필수 파일이 모두 있다', () => {
    expect(bytes.length).toBeGreaterThan(1000);
    // ZIP 서명 — 파이썬이 경고를 stdout 에 섞으면 여기서 깨진다
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');

    for (const required of [
      'mimetype',
      'version.xml',
      'settings.xml',
      'Contents/header.xml',
      'Contents/section0.xml',
      'Contents/content.hpf',
      'META-INF/container.xml',
      'META-INF/manifest.xml',
    ]) {
      expect(Object.keys(files), `${required} 누락`).toContain(required);
    }
  });

  /** OCF 규약: mimetype 이 첫 항목이고 무압축이어야 한다 */
  it('mimetype 이 application/hwp+zip 이다', () => {
    expect(strFromU8(files['mimetype'])).toBe('application/hwp+zip');
  });

  it('본문 XML 이 파싱되고 조문이 그대로 들어 있다', () => {
    const section = strFromU8(files['Contents/section0.xml']);
    expect(section).toContain('http://www.hancom.co.kr/hwpml/2011/section');
    expect(section).toContain('http://www.hancom.co.kr/hwpml/2011/paragraph');

    const texts = [...section.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => m[1]);
    expect(texts).toContain('제1조(목적)');
    expect(texts).toContain('제2조(적용범위)');
    // 항 기호와 가운뎃점이 인코딩에서 깨지지 않아야 한다
    expect(texts.some((x) => x.includes('①') && x.includes('·'))).toBe(true);
  });

  it('제목을 주지 않으면 규정 제목이 첫 줄로 들어간다', () => {
    const texts = [...strFromU8(files['Contents/section0.xml']).matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map(
      (m) => m[1],
    );
    expect(texts[0]).toBe('인사규정');
  });

  it('빈 본문은 400', async () => {
    const res = await exportHwpx(t.token, policyId, { html: '   ' });
    expect(res.status).toBe(400);
  });

  it('내보내기가 감사 로그에 남는다', async () => {
    const { body } = await api('/audit-logs?action=policy.export.hwpx', { token: t.token });
    expect(body.rows.map((r: any) => r.action)).toContain('policy.export.hwpx');
  });

  describe('권한·격리', () => {
    it('남의 회사 규정은 내보낼 수 없다', async () => {
      const other = await createTenant('hwpx-b');
      const res = await exportHwpx(other.token, policyId, { html: HTML });
      expect(res.status).toBe(404);
    });

    it('viewer 도 내보낼 수 있다 — 읽기 권한으로 문서를 받는 일이다', async () => {
      const email = `viewer-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '뷰어', role: 'viewer' },
      });
      const r = await login(email, t.password, t.slug);
      const res = await exportHwpx(r.body.accessToken, policyId, { html: HTML });
      expect(res.status).toBe(200);
    });
  });
});
