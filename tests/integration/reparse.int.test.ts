import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BASE, api, createTenant, login, waitForApi } from './helpers';

/**
 * 재파싱 검토 (T-110 ①, 특허 청구항 2·도 6).
 *
 * 규정 문서를 다시 가져오면 저장된 조문과 계층 정보·내용 지문 두 축으로 맞춘다. 같은 조문이면 기존 조문 식별자를
 * 그대로 쓰고(옮김), 같은 자리의 본문이 바뀌었으면 사람이 개정인지 새 조문인지 정한다. 이 단계는 비교와 결정만 —
 * 규정 데이터는 바꾸지 않는다.
 */
const FIXTURE = join(__dirname, '..', 'fixtures', 'regulation-sample.pdf');
const PW = 'Reparse!2345';

let seq = 0;
const node = (articleNumber: string, articleTitle: string, content: string, children: any[] = []) => ({
  id: `n${(seq += 1)}`,
  articleNumber,
  articleTitle,
  content,
  parentId: null,
  depth: 0,
  pageNumber: null,
  sortOrder: seq,
  children,
});

const ORIGINAL = () => [
  node('L1', '목적', '이 규정은 회사의 휴가 운영을 정한다.'),
  node('L2', '정의', '', [
    node('C1', '①', '"직원"이란 회사와 근로계약을 맺은 사람을 말한다.'),
    node('C2', '②', '"휴가"란 유급휴가를 말한다.'),
  ]),
  node('L3', '연차휴가', '직원에게는 매년 15일의 연차휴가를 준다.'),
  node('L4', '신청', '휴가는 3일 전까지 운영팀에 신청한다.'),
  node('L5', '경과 조치', '이 조는 다음 개정에서 빠진다.'),
];
// 제2조를 새로 넣어 뒤가 한 칸씩 밀렸다. 정의 ②는 고쳤고, 신청은 PDF 줄바꿈만 달라졌고, 경과 조치는 빠졌고, 제6조가 새로 생겼다
const REVISED = () => [
  node('L1', '목적', '이 규정은 회사의 휴가 운영을 정한다.'),
  node('L2', '적용 범위', '이 규정은 모든 직원에게 적용한다.'),
  node('L3', '정의', '', [
    node('C1', '①', '"직원"이란 회사와 근로계약을 맺은 사람을 말한다.'),
    node('C2', '②', '"휴가"란 유급휴가와 특별휴가를 말한다.'),
  ]),
  node('L4', '연차휴가', '직원에게는 매년 15일의 연차휴가를 준다.'),
  node('L5', '신청', '휴가는 3일 전까지 운영팀에 신청한 다.'),
  node('L6', '보칙', '이 규정에 없는 것은 대표이사가 정한다.'),
];

async function session(token: string, roots: any[]) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(FIXTURE)], { type: 'application/pdf' }), '휴가 규정.pdf');
  const res = await fetch(`${BASE}/regulation-parse/upload`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  let s = await res.json();
  for (let i = 0; i < 30 && s.status === 'processing'; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    s = (await api(`/regulation-parse/${s.id}`, { token })).body;
  }
  expect(s.status).toBe('ready');
  const patched = await api(`/regulation-parse/${s.id}/tree`, { method: 'PATCH', token, json: { roots } });
  expect(patched.status).toBe(200);
  return s.id as string;
}

/** 규정의 조문(번호·제목·버전 수) — 비교가 규정을 바꾸지 않았는지 본다 */
async function snapshot(token: string, policyId: string) {
  const p = (await api(`/policies/${policyId}`, { token })).body;
  const rows: string[] = [];
  for (const c of p.chapters) {
    for (const a of c.articles) {
      const versions = (await api(`/articles/${a.id}/versions`, { token })).body;
      rows.push(`${a.id}|${a.number}|${a.clauseNumber ?? ''}|${a.title}|${versions.length}`);
    }
  }
  return rows.sort();
}

describe('재파싱 검토 (T-110 ①)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let editorToken: string;
  let viewerToken: string;
  let policyId: string;
  let ids: Record<string, string>;
  let reparseSession: string;
  let review: any;

  const parsedItem = (r: any, label: string) => r.items.find((i: any) => i.parsed?.label === label);
  const missingItem = (r: any, label: string) => r.items.find((i: any) => i.kind === 'missing' && i.stored?.label === label);
  const decide = (token: string, id: string, items: any[]) => api(`/reparse-reviews/${id}/decisions`, { method: 'PATCH', token, json: { items } });

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('reparse-a');
    other = await createTenant('reparse-b');
    for (const role of ['editor', 'viewer'] as const) {
      const email = `${role}-${t.slug}@example.test`;
      await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: role, role } });
      const token = (await login(email, PW, t.slug)).body.accessToken;
      if (role === 'editor') editorToken = token;
      else viewerToken = token;
    }
    // 처음 가져오기 — 새 규정으로 등록(바로 시행)
    const first = await session(t.token, ORIGINAL());
    const commit = await api(`/regulation-parse/${first}/commit`, {
      method: 'POST',
      token: t.token,
      json: { code: `RP-${Date.now().toString(36)}`, title: '휴가 규정', effectiveDate: '2024-01-01' },
    });
    expect(commit.status).toBe(201);
    policyId = commit.body.policyId;
    const p = (await api(`/policies/${policyId}`, { token: t.token })).body;
    ids = {};
    for (const a of p.chapters.flatMap((c: any) => c.articles)) ids[`${a.number}${a.clauseNumber ? `-${a.clauseNumber}` : ''}`] = a.id;
    reparseSession = await session(t.token, REVISED());
  }, 120_000);

  it('비교 — 계층·지문 2축으로 맞추고 규정 데이터는 그대로 둔다', async () => {
    const before = await snapshot(t.token, policyId);
    const res = await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: editorToken, json: { policyId } });
    expect(res.status).toBe(201);
    review = res.body;
    expect(review).toMatchObject({ status: 'open', policyId, algorithm: 'reparse/1', normalizer: 'norm/1', stale: false, sourceChanged: false });
    expect(review.summary.counts).toEqual({ same: 1, moved: 4, changed: 1, ambiguous: 0, new: 2, missing: 1 });

    expect(parsedItem(review, '제1조')).toMatchObject({ kind: 'same', articleId: ids['1'] });
    // 끼어든 제2조 — 새 조문 후보(미리 골라 둠)
    expect(parsedItem(review, '제2조')).toMatchObject({ kind: 'new', decision: 'new', recommended: true });
    // 정의(옛 제2조) → 제3조: 머리 행은 하위 항이 따라와서, ①은 본문이 같아서 옮김 — 기존 조문 식별자를 그대로 쓴다
    expect(parsedItem(review, '제3조')).toMatchObject({ kind: 'moved', articleId: ids['2'], decision: 'accept', recommended: true });
    expect(parsedItem(review, '제3조')?.reasons).toEqual(expect.arrayContaining(['children']));
    expect(parsedItem(review, '제3조제1항')).toMatchObject({ kind: 'moved', articleId: ids['2-1'], decision: 'accept' });
    // ②는 같은 자리(대응된 조의 둘째 항)인데 본문이 바뀜 — 개정인지 사람이 정한다. 낱말 단위 비교를 함께 준다
    const changed = parsedItem(review, '제3조제2항');
    expect(changed).toMatchObject({ kind: 'changed', articleId: ids['2-2'], decision: null, recommended: false });
    expect(changed.diff.some((d: any) => d.added && d.value.includes('특별휴가'))).toBe(true);
    expect(changed.stored.base).toMatchObject({ status: 'published', effectiveDate: '2024-01-01' });
    // 연차휴가(옛 제3조) → 제4조: 본문이 같고 앞 조도 같은 쪽으로 대응돼 추천
    expect(parsedItem(review, '제4조')).toMatchObject({ kind: 'moved', articleId: ids['3'], decision: 'accept' });
    // 신청(옛 제4조) → 제5조: 줄바꿈만 다름 — 짝으로 보이되 추천하지 않는다(같은 번호의 옛 제5조와 묶지 않는다)
    expect(parsedItem(review, '제5조')).toMatchObject({ kind: 'moved', articleId: ids['4'], decision: null, recommended: false });
    expect(parsedItem(review, '제5조').changes).toMatchObject({ content: false, spacingOnly: true, position: true });
    expect(parsedItem(review, '제6조')).toMatchObject({ kind: 'new' });
    // 빠진 경과 조치 — 지우지 않고 삭제 여부 확인 대상
    expect(missingItem(review, '제5조')).toMatchObject({ articleId: ids['5'], decision: null });
    expect(review.undecided).toBe(2);
    expect(await snapshot(t.token, policyId)).toEqual(before);
  });

  it('결정 — 종류마다 허용된 것만, 한 조문은 한 항목만, 폐지는 관리자', async () => {
    const id = review.id;
    const changed = parsedItem(review, '제3조제2항');
    const spacing = parsedItem(review, '제5조');
    const sixth = parsedItem(review, '제6조');
    const second = parsedItem(review, '제2조');
    const gone = missingItem(review, '제5조');

    const ok = await decide(editorToken, id, [
      { id: changed.id, decision: 'amend' },
      { id: spacing.id, decision: 'accept' },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.undecided).toBe(0);
    expect(parsedItem(ok.body, '제3조제2항')).toMatchObject({ decision: 'amend', decidedBy: expect.any(String) });

    expect((await decide(editorToken, id, [{ id: spacing.id, decision: 'amend' }])).status).toBe(400);
    expect((await decide(editorToken, id, [{ id: parsedItem(review, '제1조').id, decision: 'accept' }])).status).toBe(400);
    // 새 조문 후보를 원문에 없는 조문에 잇기 — 이은 조문은 따로 그대로 둠·폐지를 정하지 않는다
    expect((await decide(editorToken, id, [{ id: sixth.id, decision: 'link', targetArticleId: ids['5'] }])).status).toBe(200);
    expect((await decide(editorToken, id, [{ id: gone.id, decision: 'keep' }])).status).toBe(400);
    const twice = await decide(editorToken, id, [{ id: second.id, decision: 'link', targetArticleId: ids['5'] }]);
    expect(twice.status).toBe(400);
    expect(String(twice.body.message)).toContain('이미 가리킵니다');
    // 원문에 없는 조문이 아닌 조문에는 잇지 않는다
    expect((await decide(editorToken, id, [{ id: second.id, decision: 'link', targetArticleId: ids['1'] }])).status).toBe(400);
    // 잇기를 풀고 폐지 — 편집자는 못 하고 관리자는 된다
    expect((await decide(editorToken, id, [{ id: sixth.id, decision: 'new' }])).status).toBe(200);
    expect((await decide(editorToken, id, [{ id: gone.id, decision: 'repeal' }])).status).toBe(400);
    const repeal = await decide(t.token, id, [{ id: gone.id, decision: 'repeal' }]);
    expect(repeal.status).toBe(200);
    expect(missingItem(repeal.body, '제5조').decision).toBe('repeal');
    // 관리자가 정해 둔 폐지가 있어도 편집자는 다른 항목을 정할 수 있다(폐지 권한은 바꾸는 항목에만 본다)
    const other = await decide(editorToken, id, [{ id: second.id, decision: 'hold' }]);
    expect(other.status).toBe(200);
    expect(missingItem(other.body, '제5조').decision).toBe('repeal');
    expect((await decide(editorToken, id, [{ id: second.id, decision: 'new' }])).status).toBe(200);
    // 다른 검토의 항목 id 는 받지 않는다
    const foreign = await decide(editorToken, id, [{ id: '00000000-0000-4000-8000-000000000000', decision: 'new' }]);
    expect(foreign.status).toBe(400);
    expect(String(foreign.body.message)).toContain('이 검토의 항목이 아닙니다');
  });

  it('다시 비교하면 앞 검토는 지나가고, 사람이 정한 결정은 같은 항목으로 옮겨 온다', async () => {
    const again = await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: editorToken, json: { policyId } });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(review.id);
    expect(parsedItem(again.body, '제3조제2항').decision).toBe('amend');
    expect(parsedItem(again.body, '제5조').decision).toBe('accept');
    expect(missingItem(again.body, '제5조').decision).toBe('repeal');
    expect(again.body.undecided).toBe(0);
    const old = await api(`/reparse-reviews/${review.id}`, { token: editorToken });
    expect(old.body.status).toBe('superseded');
    expect((await decide(editorToken, review.id, [{ id: parsedItem(review, '제2조').id, decision: 'hold' }])).status).toBe(409);
    review = again.body;

    const list = await api(`/policies/${policyId}/reparse-reviews`, { token: editorToken });
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ id: review.id, status: 'open', undecided: 0, deletionUndecided: 0, sourceName: '휴가 규정.pdf' });
    expect(list.body[1]).toMatchObject({ status: 'superseded' });
  });

  it('다시 비교해 더는 맞지 않게 된 결정은 옮기지 않는다 — 이은 조문이 원문에 다시 나타나면 잇기를 버린다', async () => {
    const sixth = parsedItem(review, '제6조');
    const gone = missingItem(review, '제5조');
    expect((await decide(t.token, review.id, [{ id: gone.id, decision: null }, { id: sixth.id, decision: 'link', targetArticleId: ids['5'] }])).status).toBe(200);
    // 빠졌던 경과 조치를 원문 끝에 되살린다 — 제6조(보칙)의 행 순번은 그대로
    const tree = REVISED();
    tree.push(node('L7', '경과 조치', '이 조는 다음 개정에서 빠진다.'));
    expect((await api(`/regulation-parse/${reparseSession}/tree`, { method: 'PATCH', token: editorToken, json: { roots: tree } })).status).toBe(200);
    const again = await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: editorToken, json: { policyId } });
    expect(again.status).toBe(201);
    expect(missingItem(again.body, '제5조')).toBeUndefined();
    expect(parsedItem(again.body, '제7조')).toMatchObject({ kind: 'moved', articleId: ids['5'] });
    // 옮겨 오면 한 조문을 두 항목이 가리키게 되므로 미리 골라 둔 "새 조문"으로 남는다
    expect(parsedItem(again.body, '제6조')).toMatchObject({ decision: 'new', targetArticleId: null });
    expect(parsedItem(again.body, '제3조제2항').decision).toBe('amend');
    // 원래 원문으로 되돌려 다음 시험이 같은 출발점에서 보게 한다
    expect((await api(`/regulation-parse/${reparseSession}/tree`, { method: 'PATCH', token: editorToken, json: { roots: REVISED() } })).status).toBe(200);
    review = (await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
  });

  it('비교한 뒤 규정이 바뀌거나 원문 트리를 고치면 다시 비교하라고 알린다', async () => {
    const draft = await api(`/articles/${ids['1']}/versions`, { method: 'POST', token: t.token, json: { content: '이 규정은 휴가를 정한다.', changeNote: '시험' } });
    expect(draft.status).toBe(201);
    expect((await api(`/reparse-reviews/${review.id}`, { token: editorToken })).body).toMatchObject({ stale: true, sourceChanged: false });
    const tree = REVISED();
    tree[1].content = '이 규정은 모든 직원과 파견 근로자에게 적용한다.';
    expect((await api(`/regulation-parse/${reparseSession}/tree`, { method: 'PATCH', token: editorToken, json: { roots: tree } })).status).toBe(200);
    expect((await api(`/reparse-reviews/${review.id}`, { token: editorToken })).body).toMatchObject({ stale: true, sourceChanged: true });
    // 작업본이 생긴 조문은 항목에 따로 보인다
    const again = await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: editorToken, json: { policyId } });
    expect(parsedItem(again.body, '제1조')).toMatchObject({ kind: 'same' });
    expect(parsedItem(again.body, '제1조').stored.pending).toMatchObject({ status: 'draft' });
    review = again.body;
  });

  it('다른 회사의 원문·규정·검토는 없는 것으로, 열람자는 쓸 수 없다', async () => {
    expect((await api(`/reparse-reviews/${review.id}`, { token: other.token })).status).toBe(404);
    expect((await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: other.token, json: { policyId } })).status).toBe(404);
    expect((await api(`/policies/${policyId}/reparse-reviews`, { token: other.token })).status).toBe(404);
    expect((await decide(other.token, review.id, [])).status).toBe(404);
    const otherPolicy = await api('/policies', { method: 'POST', token: other.token, json: { code: `X-${Date.now().toString(36)}`, title: '남의 규정' } });
    expect((await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: t.token, json: { policyId: otherPolicy.body.id } })).status).toBe(404);
    expect((await api(`/reparse-reviews/${review.id}`, { token: viewerToken })).status).toBe(403);
    expect((await api(`/regulation-parse/${reparseSession}/reparse`, { method: 'POST', token: viewerToken, json: { policyId } })).status).toBe(403);
  });

  it('이미 새 규정으로 등록한 원문은 비교하지 않는다', async () => {
    const committed = await session(t.token, ORIGINAL());
    expect(
      (await api(`/regulation-parse/${committed}/commit`, { method: 'POST', token: t.token, json: { code: `RP2-${Date.now().toString(36)}`, title: '다른 규정', effectiveDate: '2024-01-01' } })).status,
    ).toBe(201);
    const res = await api(`/regulation-parse/${committed}/reparse`, { method: 'POST', token: t.token, json: { policyId } });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('이미 새 규정으로 등록한 원문');
  });
});
