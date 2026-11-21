import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppendixDialog } from '../apps/web/src/components/policy-detail/AppendixDialog';
import { LengthCap } from '../apps/web/src/components/policy-detail/LengthCap';
import { appendixPayload } from '../apps/web/src/components/policy-detail/appendixDraft';
import { bodyWriteMessages } from '../apps/web/src/i18n/messages.bodyWrites';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-224 단계 C — 부칙·별표·서식 창을 떼어 문구를 키로 옮기고(진행·막힘·창 안 실패), 페이지의 쓰기 셋(부칙·별표·서식, 의견, 조문 추가)을
 * useBodyWrites 로 잇는다. 동작은 tests/bodyWrites.test.ts.
 */
const noop = () => undefined;
const DRAFT = { kind: 'annex' as const, title: '별표 1', body: '본문', sortOrder: '' };
const LABEL = { supplementary: '부칙', annex: '별표', form: '서식' };
const html = (over: Partial<Parameters<typeof AppendixDialog>[0]> = {}) =>
  renderToStaticMarkup(createElement(AppendixDialog, { mode: 'create', draft: DRAFT, onDraft: noop, kindLabel: LABEL, busy: false, locked: false, error: null, onConfirm: noop, onCancel: noop, ...over }));
const confirm = (s: string) => s.match(/<button type="button" class="btn-primary"[^>]*>[^<]*<\/button>/)?.[0] ?? s.match(/<button type="button"[^>]*class="btn-primary"[^>]*>[^<]*<\/button>/)?.[0] ?? '';

describe('부칙·별표·서식 창 (T-224 단계 C — AppendixDialog)', () => {
  it('이름 붙은 창, 제목이 있어야 저장, 진행 중이면 처리 중…으로 막히고 다른 부칙 쓰기가 돌면 막힌다, 실패는 role=alert', () => {
    const idle = html();
    expect(idle).toMatch(/role="dialog" aria-labelledby="appendix-dialog-title"/);
    expect(idle).toContain('부칙·별표·서식 추가');
    expect(confirm(idle)).not.toContain('disabled');
    expect(confirm(html({ draft: { ...DRAFT, title: '  ' } }))).toContain('disabled');
    expect(confirm(html({ busy: true }))).toMatch(/disabled=""[^>]*>처리 중…</);
    expect(confirm(html({ locked: true }))).toContain('disabled');
    expect(html({ error: '저장하지 못했습니다.' })).toMatch(/<p role="alert"[^>]*>저장하지 못했습니다\.<\/p>/);
    expect(html({ mode: 'edit' })).toContain('부칙·별표·서식 수정');
    // 표를 평문으로 쓰는 본문 칸이라 넓은 창, 낮은 화면에서도 단추에 닿게 창 안에서 스크롤, 길이 상한은 서버 DTO 와 같다
    expect(idle).toMatch(/max-h-\[90vh\] overflow-y-auto max-w-2xl" role="dialog"/);
    expect(idle).toContain('id="appendix-title" class="input text-sm" placeholder="예) 부칙, 별표 1, 서식 제1호" maxLength="500"');
    expect(idle).toContain('maxLength="500000"');
    // 상한에 닿으면(붙여 넣은 글이 잘렸을 수 있다) 그 칸 밑에 알린다
    expect(idle).not.toContain('자까지만 들어갑니다');
    expect(html({ draft: { ...DRAFT, title: 'ㄱ'.repeat(500) } })).toContain('500자까지만 들어갑니다.');
    expect(html({ draft: { ...DRAFT, body: 'ㄱ'.repeat(500000) } })).toContain('500,000자까지만 들어갑니다.');
  });

  it('길이 알림은 상한에 닿았을 때만 — 의견 칸·반려 사유 칸도 같은 알림', () => {
    const cap = (value: string, max: number) => renderToStaticMarkup(createElement(LengthCap, { value, max }));
    expect(cap('ㄱ'.repeat(1999), 2000)).toBe('');
    expect(cap('ㄱ'.repeat(2000), 2000)).toContain('2,000자까지만 들어갑니다. 붙여 넣은 글의 뒷부분은 잘렸을 수 있습니다.');
    const pageSrc = readFileSync(join(__dirname, '..', 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');
    expect(pageSrc).toMatch(/<\/button>\s*<\/div>\s*<LengthCap value=\{commentDraft\} max=\{COMMENT_MAX\} \/>/);
    const dialogs = readFileSync(join(__dirname, '..', 'apps/web/src/components/policy-detail/VersionDialogs.tsx'), 'utf8');
    expect(dialogs).toContain('<LengthCap value={p.reason} max={REJECT_REASON_MAX} />');
    expect(dialogs).toContain('<LengthCap value={p.reason} max={WITHDRAW_REASON_MAX} />');
  });

  it('보낼 값 — 제목 앞뒤 공백을 빼고, 정렬 순서는 비우면 없음·음수와 소수는 0 이상의 정수로', () => {
    expect(appendixPayload({ ...DRAFT, title: ' 별표 1 ' })).toEqual({ kind: 'annex', title: '별표 1', body: '본문', sortOrder: undefined });
    expect(appendixPayload({ ...DRAFT, sortOrder: '3.7' }).sortOrder).toBe(3);
    expect(appendixPayload({ ...DRAFT, sortOrder: '-2' }).sortOrder).toBe(0);
  });

  it('창·결과 문구는 ko·en 키가 같고 규정 문구 표에 들어 있다, 창 파일에는 화면 문구를 직접 적지 않는다', () => {
    expect(Object.keys(bodyWriteMessages.en).sort()).toEqual(Object.keys(bodyWriteMessages.ko).sort());
    for (const k of Object.keys(bodyWriteMessages.ko)) expect((messages.ko as Record<string, string>)[k], k).toBe((bodyWriteMessages.ko as Record<string, string>)[k]);
    const src = readFileSync(join(__dirname, '..', 'apps/web/src/components/policy-detail/AppendixDialog.tsx'), 'utf8');
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')).not.toMatch(/[가-힣]/);
  });
});

describe('페이지 연결 (T-224 단계 C)', () => {
  const page = readFileSync(join(__dirname, '..', 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');
  it('쓰기 셋은 페이지의 useMutation 이 아니고 useBodyWrites — 부칙 창·조문 추가 양식은 등록부에 걸린다', () => {
    for (const name of ['createCommentMutation', 'resolveCommentMutation', 'createAppendixMutation', 'updateAppendixMutation', 'deleteAppendixMutation', 'addArticleMutation', 'appendixModal']) {
      expect(page, name).not.toContain(name);
    }
    expect(page).toContain("const appendixDlg = useWriteDialogState<{ mode: 'create' } | { mode: 'edit'; id: string }>('appendix', id);");
    expect(page).toContain("useWriteDialogRegistration('addArticle', id, newArticle ? addArticleToken : null, { setError: setAddArticleError, close: closeAddArticle });");
    expect(page).toMatch(/setAddArticleToken\(nextDialogToken\(\)\);\s*setAddArticleError\(null\);\s*setNewArticle\(\{/);
    expect(page).toContain('token: appendixDlg.token,');
    expect(page).toContain('token: addArticleToken });');
    expect(page).toMatch(/\{addArticleError && \(\s*<p role="alert"/);
  });

  it('부칙 삭제는 확인 문구가 키이고 진행 중 막힘, 의견은 길이 상한·진행 중 막힘, 입력칸은 보낸 글 그대로일 때만 비운다(설계 E7 — 칸이 하나라 조문을 옮겼어도)', () => {
    expect(page).toContain("if (!window.confirm(t('bodyWrites.appendix.confirmDelete', { title }))) return;");
    expect(page).toContain('onApplied: () => setSelectedAppendixId((prev) => (prev === appendixId ? null : prev)),');
    expect(page).toContain('maxLength={COMMENT_MAX}');
    expect(page).toContain('disabled={!commentDraft.trim() || commentBusy}');
    expect(page).toContain("if (commentNow.current.draft.trim() === content) setCommentDraft('');");
    expect(page).toContain('const commentNow = useLatest({ draft: commentDraft });');
    // 누를 때 의견 목록을 받지 못했으면 반영 판정을 하지 않는다(null), 내 글인지는 사용자 id 로
    expect(page).toMatch(/idsBefore: commentsLoaded \? \(comments as \{ id: string \}\[\]\)\.map\(\(x\) => x\.id\) : null,\s*userId: user\?\.id,\s*clearInput:/);
    expect(page).toContain('disabled={!canSubmitNewArticleForm(newArticle) || addArticleBusy}');
  });

  it('진행 중 막힘은 그 규정의 같은 종류 쓰기로 — 부칙 창·삭제, 의견 처리 표시, 반영 판정의 누르기 전 목록', () => {
    for (const kind of ['appendix', 'comment', 'addArticle']) {
      const name = kind === 'addArticle' ? 'addArticleBusy' : `${kind}Busy`;
      expect(page, name).toContain(`const ${name} = isRunning(runs, '${kind}', id);`);
    }
    expect(page).toMatch(/disabled=\{commentBusy\}\s*title=\{[^\n]*\}\s*onClick=\{\(\) => \{\s*const article = liveSelectedArticle \?\? selectedArticle;\s*if \(!article\) return;\s*void bodyWrites\.resolveComment/);
    expect(page).toMatch(/disabled=\{appendixBusy\}\s*onClick=\{\(\) => \{\s*const appendixId = selectedAppendix\.id;/);
    expect(page).toContain('locked={appendixBusy}');
    expect(page).toContain("busy={appendixRun === (appendixDlg.target.mode === 'edit' ? `appendix:${appendixDlg.target.id}` : 'appendix:new')}");
    expect(page).toContain('idsBefore: ((policy?.appendices ?? []) as { id: string }[]).map((a) => a.id),');
  });

  it('조문 추가가 도는 동안은 양식을 열지 않고, 의견 단추의 처리 중은 고른 조문의 등록일 때만 — 다른 의견 쓰기가 막으면 까닭을 단다, 막힌 삭제 단추는 막힌 모양', () => {
    expect(page).toMatch(/if \(!id \|\| !canEdit\) return;\s*\/\/[^\n]*\n\s*if \(runningNow\('addArticle', id\)\) return toast\(t\('bodyWrites\.article\.running'\), 'info'\);/);
    expect(page).toContain("const commentPostRun = `comment:new:${(liveSelectedArticle ?? selectedArticle)?.id ?? ''}`;");
    expect(page).toContain("{commentRun === commentPostRun ? t('versionDialog.busy') : t('bodyWrites.comment.submit')}");
    expect(page).toContain("title={commentBusy && commentRun !== commentPostRun ? t('bodyWrites.comment.otherRunning') : undefined}");
    expect(page).toContain("title={commentBusy && commentRun !== `resolve:${c.id}` ? t('bodyWrites.comment.otherRunning') : undefined}");
    expect(page).toMatch(/hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"\s*disabled=\{appendixBusy\}/);
  });
});
