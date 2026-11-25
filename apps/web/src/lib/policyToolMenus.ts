import type { MenuItem } from '../components/DropdownMenuItem';
import { roleCanOpen } from './viewerAccess';

/**
 * 규정 상세 도구 메뉴 셋의 항목(T-215, SRS POLICY-13) — 내보내기·보기 설정·더보기. 역할·플랜·시점 조회·진행 상태에 따라 무엇이
 * 보이고 막히는지를 이 순수 함수들이 정한다(화면은 `components/policy-detail/PolicyToolbar` 가 공용 메뉴 버튼으로 그린다).
 *
 * - 시점 본문 준비 전(`asOfBlocked`)에는 파일·전체화면을 막고 이유를 항목 아래에 보인다(전에는 마우스를 올려야 보이는 설명뿐이었다).
 *   주소 복사는 막지 않는다
 * - 만드는 중인 파일은 그 항목만 막는다 — 끝날 때까지 다시 실행되지 않는다. 버튼 글이 진행 문구가 된다(`exportButtonLabel`)
 * - 글자 크기는 고른 뒤에도 메뉴가 열려 있다(keepOpen) — 이어서 누른다. 끝에 닿으면 그 단계만 막는다
 * - 열람자에게 허용 밖 경로로 가는 항목은 두지 않는다 — 판정은 PrivateRoute 와 같은 roleCanOpen(쿼리를 뗀 경로로)
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

export type ExportMenuInput = {
  t: T;
  asOfBlocked: boolean;
  /** 시점 본문 받기가 실패했다 — 막힌 이유가 '다시 시도하거나 현행으로'를 알린다(기다리면 풀리지 않는다) */
  asOfFailed?: boolean;
  busy: { pdf: boolean; hwpx: boolean };
  onPdf: () => void;
  onHwpx: () => void;
  onTxt: () => void;
  onFullscreen: () => void;
  onCopyUrl: () => void;
};

export function exportMenu(i: ExportMenuInput): MenuItem[] {
  const blocked = i.asOfBlocked ? i.t(i.asOfFailed ? 'policyDetail.export.blockedFailed' : 'asOfView.exportBlocked') : undefined;
  const file = (key: 'pdf' | 'hwpx' | 'txt', label: string, onSelect: () => void, busy = false, busyLabel = ''): MenuItem => ({
    kind: 'action',
    key,
    label: busy ? busyLabel : label,
    onSelect,
    disabled: i.asOfBlocked || busy,
    disabledReason: blocked,
  });
  return [
    file('pdf', i.t('policyDetail.export.pdf'), i.onPdf, i.busy.pdf, i.t('policyDetail.export.pdfBusy')),
    { ...(file('hwpx', i.t('policyDetail.export.hwpx'), i.onHwpx, i.busy.hwpx, i.t('policyDetail.export.hwpxBusy')) as MenuItem & { kind: 'action' }), hint: i.t('policyDetail.export.hwpxHint') },
    file('txt', i.t('policyDetail.export.txt'), i.onTxt),
    { kind: 'action', key: 'fullscreen', label: i.t('policyDetail.export.fullscreen'), onSelect: i.onFullscreen, disabled: i.asOfBlocked, disabledReason: blocked },
    { kind: 'action', key: 'copyUrl', label: i.t('policyDetail.export.copyUrl'), onSelect: i.onCopyUrl },
  ];
}

/**
 * 내보내기 실패 문구 — 사용자가 할 일을 알린다. 서버 쪽 실패(5xx — 만들다 실패·게이트웨이·시간 초과)는 다시 해 볼 일, 규정이 없으면
 * (404 — 다른 사용자가 지웠다) 규정을 다시 찾아 확인, 시간 초과·요청이 많음(408·429)은 잠시 뒤 다시, 그 밖의 거절(4xx)은 상태 번호와 관리자
 * 안내, 응답이 없으면 연결 확인. 파일 요청은 오류 본문도 Blob 이라 서버가 적은 까닭은 읽지 않는다(3차 검토).
 */
export function exportFailedMessage(t: T, kind: 'pdf' | 'hwpx', status: number | undefined): string {
  if (status && status >= 500) return t(`policyDetail.export.${kind}Failed`);
  if (status === 404) return t('policyDetail.export.notFound');
  if (status === 408 || status === 429) return t(`policyDetail.export.${kind}TryLater`, { status });
  if (status) return t(`policyDetail.export.${kind}Rejected`, { status });
  return t(`policyDetail.export.${kind}RequestFailed`);
}

/** 내보내기 버튼 글 — 파일을 만드는 중이면 그 진행 문구(메뉴가 닫혀도 진행이 보이게) */
export function exportButtonLabel(t: T, busy: { pdf: boolean; hwpx: boolean }): string {
  if (busy.pdf) return t('policyDetail.export.pdfBusy');
  if (busy.hwpx) return t('policyDetail.export.hwpxBusy');
  return t('policyDetail.menu.export');
}

export type ViewMenuInput = {
  t: T;
  scale: { percent: number; canSmaller: boolean; canLarger: boolean; isDefault: boolean };
  onScale: (step: -1 | 0 | 1) => void;
  a11yOn: boolean;
  onToggleA11y: () => void;
  /**
   * 적용 양식 — feature: 플랜이 양식을 쓸 수 있다(Pro 이상), selectedId: '' 는 기본 양식(자동).
   * saving: 고른 양식을 저장하는 중 — 끝날 때까지 다른 양식을 고를 수 없다(저장이 겹치면 늦게 끝난 실패가 앞선 성공을 덮는다)
   */
  templates: {
    feature: boolean;
    list: { id: string; name: string; isDefault?: boolean }[];
    selectedId: string;
    saving?: boolean;
    onSelect: (id: string) => void;
    onPro: () => void;
  };
  onDictionary: () => void;
};

export function viewMenu(i: ViewMenuInput): MenuItem[] {
  const { t, scale, templates } = i;
  const font: MenuItem = {
    kind: 'group',
    key: 'font',
    label: t('policyDetail.viewMenu.fontGroup'),
    items: [
      { kind: 'action', key: 'smaller', label: t('policyDetail.viewMenu.fontSmaller'), keepOpen: true, disabled: !scale.canSmaller, onSelect: () => i.onScale(-1) },
      { kind: 'action', key: 'reset', label: t('policyDetail.viewMenu.fontReset', { n: scale.percent }), keepOpen: true, disabled: scale.isDefault, onSelect: () => i.onScale(0) },
      { kind: 'action', key: 'larger', label: t('policyDetail.viewMenu.fontLarger'), keepOpen: true, disabled: !scale.canLarger, onSelect: () => i.onScale(1) },
    ],
  };
  const a11y: MenuItem = { kind: 'checkbox', key: 'a11y', label: t('policyDetail.viewMenu.a11y'), checked: i.a11yOn, onToggle: i.onToggleA11y };
  let template: MenuItem;
  if (!templates.feature) {
    // 플랜 제한 안내 — 요금제 창을 연다(T-125: 바꾸기는 아스트룸에 문의)
    template = { kind: 'action', key: 'templatePro', label: t('policyDetail.viewMenu.templatePro'), onSelect: templates.onPro };
  } else if (templates.list.length === 0) {
    template = { kind: 'action', key: 'templateNone', label: t('policyDetail.viewMenu.templateNone'), onSelect: () => undefined, disabled: true };
  } else {
    // 저장 중에는 모두 막고, 저장 중이라는 이유는 고른 항목 아래에만 적는다
    const radio = (key: string, label: string, id: string): MenuItem & { kind: 'radio' } => {
      const checked = templates.selectedId === id;
      return {
        kind: 'radio',
        key,
        label,
        checked,
        onSelect: () => templates.onSelect(id),
        disabled: templates.saving,
        disabledReason: templates.saving && checked ? t('policyDetail.viewMenu.templateSaving') : undefined,
      };
    };
    template = {
      kind: 'group',
      key: 'template',
      label: t('policyDetail.viewMenu.templateGroup'),
      items: [
        radio('tpl:', t('policyDetail.viewMenu.templateAuto'), ''),
        ...templates.list.map((row) =>
          radio(`tpl:${row.id}`, row.isDefault ? `${row.name}${t('policyDetail.viewMenu.templateDefaultMark')}` : row.name, row.id),
        ),
      ],
    };
  }
  return [font, a11y, template, { kind: 'action', key: 'dictionary', label: t('policyDetail.viewMenu.dictionary'), onSelect: i.onDictionary }];
}

export type MoreMenuInput = {
  t: T;
  role: string | null | undefined;
  canEdit: boolean;
  policyId: string;
  onReasons: () => void;
  onCrossCompare: () => void;
};

export function moreMenu(i: MoreMenuInput): MenuItem[] {
  const items: MenuItem[] = [
    { kind: 'action', key: 'reasons', label: i.t('policyDetail.more.reasons'), onSelect: i.onReasons },
    { kind: 'action', key: 'crossCompare', label: i.t('policyDetail.more.crossCompare'), onSelect: i.onCrossCompare },
  ];
  // 규정체계도는 규정 목록 화면이다 — 열람자는 열 수 없다
  if (roleCanOpen(i.role, '/policies')) items.push({ kind: 'link', key: 'hierarchy', to: '/policies', label: i.t('policyDetail.more.hierarchy') });
  // 원문 다시 가져오기(재파싱, T-110) — 판정은 쿼리를 뗀 경로로(쿼리가 붙으면 열람자 판정이 규정 상세로 읽는다)
  if (i.canEdit && roleCanOpen(i.role, '/policies/import')) {
    items.push({ kind: 'link', key: 'reimport', to: `/policies/import?target=${encodeURIComponent(i.policyId)}`, label: i.t('policyDetail.more.reimport') });
  }
  return items;
}
