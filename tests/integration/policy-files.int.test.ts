import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, login, waitForApi, BASE } from './helpers';

/**
 * 규정 첨부파일 (T-90).
 *
 * 삭제 API 는 오래전부터 있었지만 **화면에 연결된 적이 없었다**(T-32 lint 가
 * 쓰이지 않는 mutation 으로 잡아냈다). 붙이려고 보니 두 가지가 먼저 걸렸다.
 *
 *  - 목록의 파일 이름이 `1788213942878-919001.pdf` 였다. 어느 파일을 지우는지
 *    알 수 없는 채로 삭제 버튼을 붙이는 것은 함정을 놓는 일이다.
 *  - 업로드·삭제가 감사 로그에 남지 않았다. 다른 파괴적 동작은 모두 남는다.
 */

const KOREAN_NAME = '취업규칙 개정본.pdf';

async function upload(token: string, policyId: string, name: string) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), name);
  const res = await fetch(`${BASE}/policies/${policyId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const removeFile = (token: string, policyId: string, storedName: string) =>
  fetch(`${BASE}/policies/${policyId}/files/${storedName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

describe('규정 첨부파일 (T-90)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('files');
    const set = await createPolicyWithArticle(t.token, `FL-${Date.now().toString(36)}`, '첨부규정');
    policyId = set.policy.id;
  }, 90_000);

  describe('파일 이름', () => {
    /** 업로드 응답만 맞고 목록이 틀리면, 새로고침하는 순간 이름이 바뀐다 */
    it('한글 이름이 업로드 응답과 목록에서 모두 그대로다', async () => {
      const up = await upload(t.token, policyId, KOREAN_NAME);
      expect(up.status).toBe(201);
      expect(up.body.originalName).toBe(KOREAN_NAME);

      const { body } = await api(`/policies/${policyId}/files`, { token: t.token });
      expect(body.map((f: any) => f.originalName)).toContain(KOREAN_NAME);
    });

    /** T-41 이 세운 저장명 규칙(경로 탈출 방어)을 그대로 지켜야 한다 */
    it('디스크 저장명은 ASCII 안전 문자만 쓴다', async () => {
      const { body } = await api(`/policies/${policyId}/files`, { token: t.token });
      for (const f of body) {
        expect(f.id).toMatch(/^[A-Za-z0-9._-]{1,255}$/);
      }
    });

    it('같은 이름을 두 번 올려도 서로 덮어쓰지 않는다', async () => {
      const before = await api(`/policies/${policyId}/files`, { token: t.token });
      await upload(t.token, policyId, KOREAN_NAME);
      const after = await api(`/policies/${policyId}/files`, { token: t.token });
      expect(after.body.length).toBe(before.body.length + 1);
      const ids = after.body.map((f: any) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('삭제', () => {
    it('올린 파일을 지우면 목록에서 사라진다', async () => {
      const up = await upload(t.token, policyId, '삭제대상.pdf');
      const res = await removeFile(t.token, policyId, up.body.id);
      expect(res.status).toBe(204);

      const { body } = await api(`/policies/${policyId}/files`, { token: t.token });
      expect(body.map((f: any) => f.id)).not.toContain(up.body.id);
    });

    it('이미 지운 파일은 404', async () => {
      const up = await upload(t.token, policyId, '두번삭제.pdf');
      expect((await removeFile(t.token, policyId, up.body.id)).status).toBe(204);
      expect((await removeFile(t.token, policyId, up.body.id)).status).toBe(404);
    });

    /** 첨부는 규정의 근거 자료다. 사라진 뒤 물어볼 곳이 있어야 한다 */
    it('삭제가 파일 이름과 함께 감사 로그에 남는다', async () => {
      const up = await upload(t.token, policyId, '감사확인.pdf');
      await removeFile(t.token, policyId, up.body.id);

      const { body } = await api('/audit-logs?action=policy.file.delete', { token: t.token });
      const row = body.rows.find((r: any) => r.entityId === policyId);
      expect(row).toBeTruthy();
      const detail = await api(`/audit-logs/${row.id}`, { token: t.token });
      expect(detail.body.details.fileName).toBe('감사확인.pdf');
    });

    it('업로드도 감사 로그에 남는다', async () => {
      const { body } = await api('/audit-logs?action=policy.file.upload', { token: t.token });
      expect(body.rows.length).toBeGreaterThan(0);
    });
  });

  describe('권한·격리', () => {
    it('viewer 는 지울 수 없다', async () => {
      const up = await upload(t.token, policyId, '뷰어시도.pdf');
      const email = `viewer-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '뷰어', role: 'viewer' },
      });
      const r = await login(email, t.password, t.slug);

      const res = await removeFile(r.body.accessToken, policyId, up.body.id);
      expect(res.status).toBe(403);

      // 파일은 그대로 있어야 한다
      const { body } = await api(`/policies/${policyId}/files`, { token: t.token });
      expect(body.map((f: any) => f.id)).toContain(up.body.id);
    });

    it('남의 회사 첨부는 지울 수 없다', async () => {
      const up = await upload(t.token, policyId, '격리확인.pdf');
      const other = await createTenant('files-b');
      const res = await removeFile(other.token, policyId, up.body.id);
      expect(res.status).toBe(404);

      const { body } = await api(`/policies/${policyId}/files`, { token: t.token });
      expect(body.map((f: any) => f.id)).toContain(up.body.id);
    });
  });
});
