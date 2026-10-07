import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BASE, api, createTenant, waitForApi } from './helpers';

/**
 * PDF 가져오기 — 실제 추출기(파이썬)를 거쳐 등록까지, 그리고 원문 PDF 자동 첨부.
 *
 * 파서·커밋 단위 테스트는 따로 있지만, 이번 버그(항 첫 줄 유실)는 두 단계가 각자 맞고
 * 이어 붙였을 때만 틀렸다. 여기서는 진짜 PDF 한 장을 올려 끝까지 본다.
 */
const FIXTURE = join(__dirname, '..', 'fixtures', 'regulation-sample.pdf');
const FILE_NAME = '시험 규정.pdf';

describe('PDF 가져오기 — 끝까지', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let session: any;
  let policyId: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('pdf-import');
    const form = new FormData();
    form.append('file', new Blob([readFileSync(FIXTURE)], { type: 'application/pdf' }), FILE_NAME);
    const res = await fetch(`${BASE}/regulation-parse/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.token}` },
      body: form,
    });
    session = await res.json();
    for (let i = 0; i < 30 && session.status === 'processing'; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      session = (await api(`/regulation-parse/${session.id}`, { token: t.token })).body;
    }
  });

  it('한글 파일 이름이 깨지지 않는다', () => {
    expect(session.status).toBe('ready');
    expect(session.fileName).toBe(FILE_NAME);
  });

  it('원문 PDF를 등록 전까지 보관해 둔다', () => {
    expect(session.extractMeta.sourceFile).toBe(`${session.id}.pdf`);
  });

  it('등록하면 조·항 본문과 가지 조문이 그대로 들어간다', async () => {
    const commit = await api(`/regulation-parse/${session.id}/commit`, {
      method: 'POST',
      token: t.token,
      json: { code: `PDF-${Date.now().toString(36)}`, title: '시험규정', effectiveDate: '2024-01-01' },
    });
    expect(commit.status).toBe(201);
    policyId = commit.body.policyId;

    const { body } = await api(`/policies/${policyId}`, { token: t.token });
    const rows = body.chapters.flatMap((c: any) =>
      c.articles.map((a: any) => [a.number, a.branchNumber, a.clauseNumber, a.title, a.versions[0]?.content ?? null]),
    );
    expect(rows).toEqual([
      [1, null, null, '목적', '이 규정은 가져오기 통합 테스트를 목적으로 한다.'],
      [2, null, null, '적용범위', null],
      [2, null, 1, '', '이 규정은 시험용 회사에 적용한다.'],
      [2, null, 2, '', '그 밖의 사항은 따로 정한다.'],
      [2, 2, null, '특례', '특례는 두지 않는다.'],
    ]);
  });

  it('원문 PDF가 규정 첨부파일로 붙고, 로그인 정보로 내려받을 수 있다', async () => {
    const { body: files } = await api(`/policies/${policyId}/files`, { token: t.token });
    expect(files.map((f: any) => f.originalName)).toEqual([FILE_NAME]);

    const res = await fetch(`${BASE}/policies/${policyId}/files/${encodeURIComponent(files[0].id)}`, {
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
  });
});
