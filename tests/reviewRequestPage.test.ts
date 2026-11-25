import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** T-224 단계 B2 — 검토 요청 둘(편집기·목록)의 페이지 연결. 동작은 tests/reviewRequest.test.ts */
describe('페이지 연결 (T-224 단계 B2)', () => {
  const page = readFileSync(join(__dirname, '..', 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');
  it('검토 요청 둘은 페이지의 useMutation 이 아니고, 편집기는 등록부에 걸려 실패·초안 이어받기를 받는다', () => {
    expect(page).not.toContain('requestReviewMutation');
    expect(page).not.toContain('submitMutation');
    expect(page).toContain("useWriteDialogRegistration('review', id, editorToken, { setError: setEditorError, close: finishVersionEditor, adopt: setEditingDraftVersionId });");
    expect(page).toMatch(/if \(!selectedArticle \|\| !id \|\| runningNow\('version', id\) \|\| runningNow\('publish', id\)\) return;[\s\S]{0,400}setEditorToken\(nextDialogToken\(\)\);\s*setEditorError\(null\);/);
    expect(page).toMatch(/\{editorError && \(\s*<p role="alert"/);
    // 편집기가 보이지 않게 되면(고른 조문이 풀리거나 바뀜, 전문 보기로) 닫는다 — 등록부에 남아 결과를 삼키지 않게(B2 검토)
    expect(page).toContain("const editorShownFor = showVersionEditor && articleViewMode === 'segment' ? (selectedArticle?.id ?? null) : null;");
    expect(page).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!showVersionEditor \|\| editorShownFor === editorArticleId\) return;\s*closeVersionEditor\(\);/);
    expect(page).toContain('setEditorArticleId(selectedArticle.id);');
    expect(page).toContain("toast(t('versionDialog.editorClosed'), 'info');");
    // 재파싱 묶음 초안은 편집기가 이어 쓰지 않는다, 같은 글 초안은 내가 만든 것만(보내는 사람을 싣는다) — B2 재검토
    expect(page).toContain("const draft = (versions as any[]).find((v) => v.status === 'draft' && !v.reparseItem);");
    expect(page).toContain('userId: user?.id,');
    expect(page).toContain('token: editorToken,');
    expect(page).toContain("disabled={!versionContent.trim() || versionLock}");
    expect(page.match(/onClick=\{closeVersionEditor\}/g) ?? []).toHaveLength(2);
    expect(page.match(/void versionActions\.submit\(versionTargetArgs\(versionTargetOf\((v|version)\)\)\)/g) ?? []).toHaveLength(2);
  });
});
