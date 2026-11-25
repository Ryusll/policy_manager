import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApproveDialog, ArchiveDialog, RejectDialog, WithdrawDialog } from '../apps/web/src/components/policy-detail/VersionDialogs';
import { versionDialogMessages } from '../apps/web/src/i18n/messages.versionDialogs';
import { policyWritesMessages } from '../apps/web/src/i18n/messages.policyWrites';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-224 단계 B — 판 확인 창 넷을 페이지에서 떼고 문구를 키로 옮겼다. 진행(busy)은 '처리 중…'과 막힘, 다른 판 쓰기가 도는 동안(locked)도
 * 막힘, 실패는 창 안 role=alert. 진행 중에도 취소는 눌린다(닫은 뒤 결과는 배너·도구 줄·알림).
 */
const noop = () => undefined;
const common = { busy: false, locked: false, error: null as string | null, onConfirm: noop, onCancel: noop };
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const ko = versionDialogMessages.ko as Record<string, string>;
const confirmButton = (s: string) => s.match(/<button type="button"[^>]*class="btn-primary"[^>]*>[^<]*<\/button>/)?.[0] ?? '';
const cancelButton = (s: string) => s.match(/<button type="button"[^>]*class="btn-secondary"[^>]*>[^<]*<\/button>/)?.[0] ?? '';

describe('판 확인 창 (T-224 단계 B — VersionDialogs)', () => {
  const approve = (over: Partial<Parameters<typeof ApproveDialog>[0]> = {}) =>
    html(createElement(ApproveDialog, { ...common, note: '사유', onNote: noop, date: '', onDate: noop, minDate: null, tooEarly: false, today: '2026-11-21', ...over }));

  it('승인 — 이름 붙은 창(role=dialog), 사유가 있어야 누를 수 있고 진행 중이면 처리 중…으로 막힌다, 취소는 늘 눌린다', () => {
    const idle = approve();
    expect(idle).toMatch(/role="dialog" aria-labelledby="version-approve-title"/);
    expect(idle).toContain(`id="version-approve-title"`);
    expect(idle).toContain(ko['versionDialog.approve.title']);
    expect(confirmButton(idle)).not.toContain('disabled');
    expect(confirmButton(approve({ note: '  ' }))).toContain('disabled');
    const busy = approve({ busy: true });
    expect(confirmButton(busy)).toContain('disabled=""');
    expect(confirmButton(busy)).toMatch(/>처리 중…</);
    expect(cancelButton(busy)).not.toContain('disabled');
    expect(confirmButton(approve({ locked: true }))).toContain('disabled=""');
    expect(confirmButton(approve({ locked: true }))).toMatch(/>승인</);
  });

  it('승인 — 더 늦게 시행될 판이 있으면 그 날짜를 알리고, 이른 날을 고르면 붉게 막는다, 미래 시행일은 시행 예정 안내', () => {
    const min = approve({ minDate: '2026-12-01' });
    expect(min).toContain('data-testid="approve-min-date"');
    expect(min).toContain('2026-12-01에 시행될 버전이 있어 그보다 이른 날로는 승인할 수 없습니다.');
    const early = approve({ minDate: '2026-12-01', tooEarly: true });
    expect(early).toContain('시행일을 그날이나 그 뒤로 정하세요.');
    expect(early).toMatch(/class="text-\[11px\] mt-1 text-red-700"/);
    expect(confirmButton(early)).toContain('disabled');
    expect(approve({ date: '2026-12-31' })).toContain(ko['versionDialog.approve.future']);
    expect(approve({ date: '2026-11-21' })).not.toContain(ko['versionDialog.approve.future']);
  });

  it('창 안 실패는 role=alert 로 — 넘겨받은 것만', () => {
    expect(approve()).not.toContain('role="alert"');
    expect(approve({ error: '승인하지 못했습니다.' })).toMatch(/<p role="alert"[^>]*>승인하지 못했습니다\.<\/p>/);
    const reject = html(createElement(RejectDialog, { ...common, reason: '', onReason: noop, error: '반려하지 못했습니다.' }));
    expect(reject).toMatch(/<p role="alert"[^>]*>반려하지 못했습니다\.<\/p>/);
    expect(confirmButton(reject)).toContain('disabled'); // 사유가 없다
    expect(reject).toContain('maxLength="2000"'); // 서버 상한과 같다 — 넘겨 영문 검증 문구로 거절되지 않게(B1 검토)
  });

  it('철회 — 판 번호와 시행 예정일, 알림 안내, 사유가 있어야 누를 수 있다', () => {
    const s = html(createElement(WithdrawDialog, { ...common, versionNum: 4, effectiveDate: '2027-01-01', reason: '재검토', onReason: noop }));
    expect(s).toMatch(/role="dialog" aria-labelledby="version-withdraw-title"/);
    expect(s).toContain('v4');
    expect(s).toContain('(2027-01-01 시행 예정)을 철회할까요?');
    expect(s).toContain((messages.ko as Record<string, string>)['versionWithdraw.dialogNotify']);
    expect(s).toContain('maxLength="500"');
    expect(confirmButton(s)).not.toContain('disabled');
  });

  it('폐지 — 미래 날짜면 폐지 예정 안내와 단추 글, 비우면 오늘부터 빠진다는 안내', () => {
    const today = html(createElement(ArchiveDialog, { ...common, versionNum: 3, date: '', onDate: noop, today: '2026-11-21' }));
    expect(today).toContain('오늘(2026-11-21)부터 이 조문은 시행에서 빠집니다.');
    expect(today).not.toContain('archive-future-note');
    expect(confirmButton(today)).toMatch(/>폐지</);
    expect(today).toContain('min="2026-11-21"');
    const later = html(createElement(ArchiveDialog, { ...common, versionNum: 3, date: '2026-12-31', onDate: noop, today: '2026-11-21' }));
    expect(later).toContain('data-testid="archive-future-note"');
    expect(later).toContain('2026-12-31부터 이 조문은 시행에서 빠집니다.');
    expect(confirmButton(later)).toMatch(/>폐지 예정으로 정하기</);
  });
});

describe('문구 키 (T-224 단계 B)', () => {
  it('창·결과 문구는 ko·en 키가 같고 비어 있지 않으며, 규정 문구 표에 들어 있다', () => {
    for (const table of [versionDialogMessages, policyWritesMessages]) {
      expect(Object.keys(table.en).sort()).toEqual(Object.keys(table.ko).sort());
      for (const [k, v] of Object.entries({ ...table.ko, ...table.en })) expect(v.trim(), k).not.toBe('');
      for (const k of Object.keys(table.ko)) {
        expect((messages.ko as Record<string, string>)[k], k).toBe((table.ko as Record<string, string>)[k]);
        expect((messages.en as Record<string, string>)[k], k).toBe((table.en as Record<string, string>)[k]);
      }
    }
  });

  it('창이 쓰는 키는 모두 있다 — 화면에 키 이름이 그대로 보이지 않게', () => {
    const src = readFileSync(join(__dirname, '..', 'apps/web/src/components/policy-detail/VersionDialogs.tsx'), 'utf8');
    const used = [...src.matchAll(/'(versionDialog\.[\w.]+|versionWithdraw\.[\w.]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(30);
    for (const k of used) expect((messages.ko as Record<string, string>)[k], k).toBeTruthy();
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/[가-힣]/); // 주석 밖에는 화면 문구를 직접 적지 않는다
  });
});
