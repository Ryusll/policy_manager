import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 템플릿 이력 복원 (T-58).
 *
 * 예전에는 화면이 감사 로그에서 스냅샷을 읽어 `PUT /templates/:id` 를 불렀다.
 * 그래서 복원이 감사 로그에 `template.update` 로만 남아 **평범한 편집과 구분되지 않았다**.
 */

function setPlan(plan: 'pro' | 'enterprise', ...slugs: string[]) {
  execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -f -'`,
    {
      encoding: 'utf8',
      input: `UPDATE tenants SET plan='${plan}' WHERE slug IN (${slugs.map((s) => `'${s}'`).join(',')});`,
    },
  );
}
const promoteToPro = (...slugs: string[]) => setPlan('pro', ...slugs);

describe('템플릿 이력 복원 (T-58)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let token: string;
  let templateId: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('tpl-restore');
    promoteToPro(t.slug);
    const fresh = await login(t.email, t.password, t.slug);
    token = fresh.body.accessToken;

    const created = await api('/templates', {
      method: 'POST',
      token,
      json: { name: '원본 템플릿', description: '처음', layoutJson: { showArticleTitle: true }, cssText: '' },
    });
    expect(created.status).toBe(201);
    templateId = created.body.id;

    // 한 번 수정해 되돌릴 지점을 만든다
    await api(`/templates/${templateId}`, {
      method: 'PUT',
      token,
      json: { name: '수정된 템플릿', description: '두번째', layoutJson: { showArticleTitle: false }, cssText: '' },
    });
  });

  it('이력 id 로 복원하면 그 시점 내용으로 돌아간다', async () => {
    const revisions = await api(`/templates/${templateId}/revisions`, { token });
    const createRev = revisions.body.find((r: any) => r.action === 'template.create');
    expect(createRev).toBeTruthy();

    const restored = await api(`/templates/${templateId}/restore`, {
      method: 'POST',
      token,
      json: { revisionId: createRev.id },
    });
    expect(restored.status).toBe(200);
    expect(restored.body.name).toBe('원본 템플릿');
    expect(restored.body.description).toBe('처음');
    expect(restored.body.layoutJson).toMatchObject({ showArticleTitle: true });
  });

  /** T-58의 완료 정의 그 자체 */
  it('감사 로그에서 편집과 복원이 구분된다', async () => {
    const { body } = await api(`/templates/${templateId}/revisions`, { token });
    const actions = body.map((r: any) => r.action);
    expect(actions).toContain('template.update');
    expect(actions).toContain('template.restore');
  });

  it('복원 기록에 어느 이력에서 되돌렸는지 남는다', async () => {
    const { body } = await api(`/templates/${templateId}/revisions`, { token });
    const restoreRev = body.find((r: any) => r.action === 'template.restore');
    const createRev = body.find((r: any) => r.action === 'template.create');
    expect(restoreRev.details.restoredFromRevisionId).toBe(createRev.id);
    expect(restoreRev.details.restoredFromAction).toBe('template.create');
    // before/after 도 그대로 남아 무엇이 바뀌었는지 화면이 계산할 수 있다
    expect(restoreRev.details.before.name).toBe('수정된 템플릿');
    expect(restoreRev.details.after.name).toBe('원본 템플릿');
  });

  it('없는 이력 id 는 404', async () => {
    const { status } = await api(`/templates/${templateId}/restore`, {
      method: 'POST',
      token,
      json: { revisionId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(status).toBe(404);
  });

  it('남의 회사 템플릿은 복원할 수 없다', async () => {
    const other = await createTenant('tpl-restore-b');
    promoteToPro(other.slug);
    const fresh = await login(other.email, other.password, other.slug);
    const { body } = await api(`/templates/${templateId}/revisions`, { token });

    const { status } = await api(`/templates/${templateId}/restore`, {
      method: 'POST',
      token: fresh.body.accessToken,
      json: { revisionId: body[0].id },
    });
    expect(status).toBe(404);
  });

  it('다른 템플릿의 이력 id 로는 복원할 수 없다', async () => {
    // 이력이 이 템플릿 것인지 확인하지 않으면 남의 템플릿 내용을 끌어와 덮어쓸 수 있다.
    // 원본을 **지운 뒤** 시도하는 이유는, 살아 있으면 이름 중복(409)에 먼저 걸려
    // 이력 소속 검사가 실제로 동작하는지 알 수 없기 때문이다.
    const another = await api('/templates', {
      method: 'POST',
      token,
      json: { name: '다른 템플릿', layoutJson: {}, cssText: '' },
    });
    const otherRevs = await api(`/templates/${another.body.id}/revisions`, { token });
    const otherRevId = otherRevs.body[0].id;
    await api(`/templates/${another.body.id}`, { method: 'DELETE', token });

    const { status } = await api(`/templates/${templateId}/restore`, {
      method: 'POST',
      token,
      json: { revisionId: otherRevId },
    });
    expect(status).toBe(404);

    const still = await api(`/templates/${templateId}`, { token });
    expect(still.body.name).not.toBe('다른 템플릿');
  });

  /**
   * 자유 HTML/CSS 는 Enterprise 전용이다. 그 시절 스냅샷이 이력에 남아 있으므로,
   * 플랜을 내린 뒤 복원으로 되살릴 수 있으면 유료 경계가 무너진다.
   */
  it('플랜을 내린 뒤 Enterprise 전용 내용을 복원으로 되살릴 수 없다', async () => {
    const ent = await createTenant('tpl-restore-ent');
    setPlan('enterprise', ent.slug);
    let fresh = await login(ent.email, ent.password, ent.slug);
    let entToken = fresh.body.accessToken;

    const created = await api('/templates', {
      method: 'POST',
      token: entToken,
      json: { name: '자유 HTML', layoutJson: { rawHtml: '<div>사내 양식</div>' }, cssText: '.x{color:red}' },
    });
    expect(created.status).toBe(201);

    // 안전한 내용으로 한 번 덮은 뒤 Pro 로 내린다
    await api(`/templates/${created.body.id}`, {
      method: 'PUT',
      token: entToken,
      json: { name: '평범한 템플릿', layoutJson: {}, cssText: '' },
    });
    setPlan('pro', ent.slug);
    fresh = await login(ent.email, ent.password, ent.slug);
    entToken = fresh.body.accessToken;

    const revs = await api(`/templates/${created.body.id}/revisions`, { token: entToken });
    const entRev = revs.body.find((r: any) => r.action === 'template.create');

    const { status } = await api(`/templates/${created.body.id}/restore`, {
      method: 'POST',
      token: entToken,
      json: { revisionId: entRev.id },
    });
    expect(status).toBe(403);
  });
});
