import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROUTE_SECTIONS, breadcrumbFor } from '../apps/web/src/lib/routeSections';
import { messages } from '../apps/web/src/i18n/messages';
import { amendmentDetailQuery, lawDetailQuery } from '../apps/web/src/api/detailQueries';

const ROOT = join(__dirname, '..');
const appSource = readFileSync(join(ROOT, 'apps/web/src/App.tsx'), 'utf8');

/** App.tsx 의 Layout 아래 화면 경로(상대 경로) — `<Route path="...">` 원문에서 뽑는다 */
function layoutChildPaths(): string[] {
  const paths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  // 맨 앞 '/' 로 시작하는 것은 Layout 밖(로그인·가입·옛 콜백)이거나 Layout 자신('/')이다
  return paths.filter((p) => !p.startsWith('/'));
}

/** ':id' 같은 자리를 실제 값처럼 채운다 */
function sample(path: string): string {
  return '/' + path.replace(/:[A-Za-z]+/g, 'x1');
}

describe('경로 표시 경로 표 (T-212)', () => {
  it('App.tsx 의 Layout 아래 경로를 원문에서 뽑아 낸다 — 뽑기가 고장 나면 아래 대조가 헛돈다', () => {
    const paths = layoutChildPaths();
    expect(paths).toContain('laws/:id');
    expect(paths).toContain('amendments/:id');
    expect(paths).toContain('audit-logs');
    expect(paths.length).toBeGreaterThanOrEqual(15);
  });

  it('모든 화면 경로의 첫 마디가 경로 표에 있다 — 새 화면을 더하면 표에도 더해야 한다', () => {
    const known = new Set(ROUTE_SECTIONS.map((s) => s.segment));
    const missing = layoutChildPaths().filter((p) => !known.has(p.split('/')[0]));
    expect(missing).toEqual([]);
  });

  it('모든 화면 경로가 숨김이거나, 그리는 마디마다 ko·en 이름이 있다 — 영문 경로를 그대로 내보이지 않는다', () => {
    for (const path of layoutChildPaths()) {
      const crumbs = breadcrumbFor(sample(path));
      if (!crumbs) continue;
      for (const c of crumbs) {
        if (c.kind !== 'section') continue;
        expect(typeof messages.ko[c.labelKey], `${path} ko ${c.labelKey}`).toBe('string');
        expect(typeof messages.en[c.labelKey], `${path} en ${c.labelKey}`).toBe('string');
      }
    }
  });

  it('법령 관리·개정 검토·감사 로그는 메뉴와 같은 이름이다 (영문 경로 laws·amendments·audit-logs 가 보이던 것)', () => {
    expect(breadcrumbFor('/laws')).toEqual([{ kind: 'section', labelKey: 'layout.nav.laws', to: '/laws' }]);
    expect(breadcrumbFor('/amendments')).toEqual([
      { kind: 'section', labelKey: 'layout.nav.amendments', to: '/amendments' },
    ]);
    expect(breadcrumbFor('/audit-logs')).toEqual([
      { kind: 'section', labelKey: 'layout.nav.auditLogs', to: '/audit-logs' },
    ]);
  });

  it('법령·개정 후보 상세는 id 원문 대신 상세 이름 자리로 그린다', () => {
    expect(breadcrumbFor('/laws/abc-123')).toEqual([
      { kind: 'section', labelKey: 'layout.nav.laws', to: '/laws' },
      { kind: 'detail', detail: 'law', id: 'abc-123' },
    ]);
    expect(breadcrumbFor('/amendments/c9')?.[1]).toEqual({ kind: 'detail', detail: 'amendment', id: 'c9' });
  });

  it('통합 관리(/admin)와 그 옛 주소(/platform-admin)는 경로 표시를 그리지 않는다', () => {
    expect(breadcrumbFor('/admin')).toBeNull();
    expect(breadcrumbFor('/platform-admin')).toBeNull();
  });

  it('규정 상세·가져오기·재파싱 검토는 화면이 자체 경로를 그리므로 그리지 않는다', () => {
    expect(breadcrumbFor('/policies')).toEqual([
      { kind: 'section', labelKey: 'layout.nav.policies', to: '/policies' },
    ]);
    expect(breadcrumbFor('/policies/import')).toBeNull();
    expect(breadcrumbFor('/policies/p1')).toBeNull();
    expect(breadcrumbFor('/policies/p1/reparse/r1')).toBeNull();
  });

  it('대시보드·표에 없는 경로·깊이는 그리지 않는다 — 원문 마디를 내보이지 않는다', () => {
    expect(breadcrumbFor('/')).toBeNull();
    expect(breadcrumbFor('/no-such-screen')).toBeNull();
    expect(breadcrumbFor('/laws/l1/extra')).toBeNull();
    expect(breadcrumbFor('/search/extra')).toBeNull();
  });

  it('라우터처럼 첫 마디의 퍼센트 인코딩을 풀고 대소문자를 가리지 않는다(상세 id 는 그대로)', () => {
    expect(breadcrumbFor('/Laws')).toEqual([{ kind: 'section', labelKey: 'layout.nav.laws', to: '/laws' }]);
    expect(breadcrumbFor('/%6Caws')).toEqual([{ kind: 'section', labelKey: 'layout.nav.laws', to: '/laws' }]);
    expect(breadcrumbFor('/AMENDMENTS/AbC')?.[1]).toEqual({ kind: 'detail', detail: 'amendment', id: 'AbC' });
    expect(breadcrumbFor('/Platform-Admin')).toBeNull();
  });

  it('상세 구역(법령·개정 후보) 아래에는 고정 경로가 없다 — 생기면 상세 이름 자리로 잘못 그리므로 표를 먼저 고쳐야 한다', () => {
    const detailSections = new Set(ROUTE_SECTIONS.filter((s) => s.detail).map((s) => s.segment));
    const fixedUnderDetail = layoutChildPaths().filter((p) => {
      const [first, second] = p.split('/');
      return detailSections.has(first) && second !== undefined && !second.startsWith(':');
    });
    expect(fixedUnderDetail).toEqual([]);
  });

  it('상세 이름은 상세 화면과 같은 조회(키·함수)로 읽는다 — 키가 갈라지면 경로 표시가 조용히 "상세"로 남는다', () => {
    expect(lawDetailQuery('L1').queryKey).toEqual(['laws', 'L1']);
    expect(amendmentDetailQuery('A1').queryKey).toEqual(['amendment', 'A1']);
    const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
    expect(read('apps/web/src/pages/LawDetailPage.tsx')).toContain('lawDetailQuery(');
    expect(read('apps/web/src/pages/AmendmentDetailPage.tsx')).toContain('amendmentDetailQuery(');
    const crumbs = read('apps/web/src/components/Breadcrumbs.tsx');
    expect(crumbs).toContain('lawDetailQuery(id)');
    expect(crumbs).toContain('amendmentDetailQuery(id)');
    expect(crumbs).not.toMatch(/queryKey:\s*\[/); // 키를 따로 적지 않는다
  });

  it('잘못 인코딩된 주소에도 멈추지 않는다', () => {
    expect(breadcrumbFor('/laws/%E0%A4%A')?.[1]).toEqual({ kind: 'detail', detail: 'law', id: '%E0%A4%A' });
    expect(breadcrumbFor('/laws/%EB%B2%95')?.[1]).toEqual({ kind: 'detail', detail: 'law', id: '법' });
  });
});
