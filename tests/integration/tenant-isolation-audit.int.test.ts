import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi, BASE } from './helpers';

/**
 * T-41 격리 감사에서 실제로 뚫렸던 경로들.
 *
 * 전 서비스 쿼리를 훑어 찾은 뒤 **살아 있는 API로 재현시킨** 것만 남겼다.
 * 다시 뚫리면 여기서 잡는다.
 */
describe('T-41 격리 감사 회귀', () => {
  let attacker: Awaited<ReturnType<typeof createTenant>>;
  let victim: Awaited<ReturnType<typeof createTenant>>;
  let attackerPolicy: any;
  let victimSet: Awaited<ReturnType<typeof createPolicyWithArticle>>;

  beforeAll(async () => {
    await waitForApi();
    [attacker, victim] = await Promise.all([createTenant('aud-atk'), createTenant('aud-vic')]);
    attackerPolicy = (await createPolicyWithArticle(attacker.token, 'AUD-ATK-1')).policy;
    victimSet = await createPolicyWithArticle(victim.token, 'AUD-VIC-1', '피해자 규정');
  });

  /**
   * 조문 경로는 `/policies/:id/chapters/:chapterId/articles/:articleId` 다.
   * 예전에는 `:id` 가 내 규정인지만 보고 `:chapterId` 가 그 규정 소속인지는 안 봤다.
   * 그래서 **내 규정 id + 남의 장·조문 id** 조합이 그대로 통과했다.
   */
  it('내 규정 id에 남의 장·조문 id를 붙여도 수정되지 않는다', async () => {
    const { status } = await api(
      `/policies/${attackerPolicy.id}/chapters/${victimSet.chapter.id}/articles/${victimSet.article.id}`,
      { method: 'PUT', token: attacker.token, json: { title: 'HACKED' } },
    );
    expect(status).toBe(404);

    const owner = await api(`/policies/${victimSet.policy.id}`, { token: victim.token });
    expect(owner.body.chapters[0].articles[0].title).toBe('목적');
  });

  it('같은 조합으로 남의 조문을 삭제할 수 없다', async () => {
    const { status } = await api(
      `/policies/${attackerPolicy.id}/chapters/${victimSet.chapter.id}/articles/${victimSet.article.id}`,
      { method: 'DELETE', token: attacker.token },
    );
    expect(status).toBe(404);

    const owner = await api(`/policies/${victimSet.policy.id}`, { token: victim.token });
    expect(owner.body.chapters[0].articles).toHaveLength(1);
  });

  it('남의 장에 조문을 새로 넣을 수 없다', async () => {
    const { status } = await api(
      `/policies/${attackerPolicy.id}/chapters/${victimSet.chapter.id}/articles`,
      { method: 'POST', token: attacker.token, json: { number: 99, title: '침입', content: 'x' } },
    );
    expect(status).toBe(404);
  });

  /**
   * 첨부파일 경로는 `join('/app/uploads', tenantId, id, filename)` 으로 조립됐다.
   * Express 는 라우트를 인코딩된 상태로 맞춘 뒤 값을 풀기 때문에, 인코딩한 슬래시를
   * 넣으면 `:id` 하나에 상위 이동이 통째로 들어온다. 테넌트 경계가 디렉터리 이름
   * 하나에만 걸려 있어서 경로 탈출은 곧 격리 붕괴다.
   */
  describe('첨부파일 경로 탈출', () => {
    let victimFile: string;

    beforeAll(async () => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('%PDF-1.4 피해자 문서')], { type: 'application/pdf' }), 'v.pdf');
      const res = await fetch(`${BASE}/policies/${victimSet.policy.id}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${victim.token}` },
        body: form,
      });
      victimFile = (await res.json()).id;
      expect(victimFile).toBeTruthy();
    });

    /** 공격자는 남의 테넌트 id를 알면 디렉터리를 거슬러 올라가 파일을 집을 수 있었다. */
    const escapePath = () =>
      `/policies/..%2F${victim.user.tenantId}%2F${victimSet.policy.id}/files/${victimFile}`;

    it('경로를 거슬러 남의 첨부파일을 읽을 수 없다', async () => {
      const res = await fetch(BASE + escapePath(), {
        headers: { Authorization: `Bearer ${attacker.token}` },
      });
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('피해자 문서');
    });

    it('경로를 거슬러 남의 첨부파일을 지울 수 없다', async () => {
      const res = await fetch(BASE + escapePath(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${attacker.token}` },
      });
      expect(res.status).not.toBe(204);

      // 소유자 쪽에서 파일이 그대로인지 확인한다
      const { body } = await api(`/policies/${victimSet.policy.id}/files`, { token: victim.token });
      expect(body.map((f: any) => f.id)).toContain(victimFile);
    });

    it('규정 id 자리로 컨테이너 파일을 읽을 수 없다', async () => {
      const res = await fetch(`${BASE}/policies/..%2F..%2F..%2Fetc/files/hostname`, {
        headers: { Authorization: `Bearer ${attacker.token}` },
      });
      // 규정 소유 확인이 경로 조립보다 먼저라서 404다. 없는 규정과 같은 답이면 충분하다.
      expect(res.status).toBe(404);
    });

    it('파일명 자리로도 나갈 수 없다', async () => {
      // 규정 디렉터리는 `/app/uploads/<테넌트>/<규정>` 이라 루트까지 다섯 칸이다
      const res = await fetch(
        `${BASE}/policies/${attackerPolicy.id}/files/..%2F..%2F..%2F..%2F..%2Fetc%2Fhostname`,
        { headers: { Authorization: `Bearer ${attacker.token}` } },
      );
      expect(res.status).toBe(400);
    });

    it('남의 규정 첨부 목록을 열 수 없다', async () => {
      const { status } = await api(`/policies/${victimSet.policy.id}/files`, {
        token: attacker.token,
      });
      expect(status).toBe(404);
    });
  });
});
