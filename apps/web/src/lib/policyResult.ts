import { useCallback, useLayoutEffect, useState } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { usePolicyRunsStore } from '../stores/policyRunsStore';
import { TOAST_MS, toast } from '../stores/toastStore';
import { stillStale, type ResultSource, type ToolStatus } from './toolStatus';

/*
 * 규정 상세에서 시작한 비동기 작업 가운데 진행을 규정별로 두는 것(RunKind — PDF·한/글 내보내기, 초안 일괄 시행, 시행 상태 전환, 규정 정보
 * 저장, 적용 양식 저장, 첨부 올리기·지우기, 조 순서 저장)의 진행 표시와 결과를 시작한 규정에 묶는다(T-215 8~13차 검토). 규정을 옮기면
 * 화면을 새로 그리므로(11차 — PolicyDetailPage 가 규정 id 로 key), 진행 중이던 앞 규정의 작업은 내려간 화면에서 끝난다 — 그 결과를 버리지
 * 않고, 같은 규정을 다시 그린 화면이 떠 있으면 그 화면(열린 창·도구 줄)에, 아니면 규정 이름을 붙여 화면 전체 알림으로 알린다. 진행
 * 표시는 화면 밖 저장소(stores/policyRunsStore)에 둬서 새로 그린 화면도 이어 본다(12차) — 같은 규정의 같은 작업은 끝날 때까지 다시
 * 시작하지 않는다. 판 쓰기(전환 다섯·검토 요청)는 'version' 으로 든다(T-224 단계 B — lib/policyWrite). 부칙·조문 추가·댓글은 아직
 * 들지 않는다(T-224 단계 C).
 */

/** 지금 보는 규정(경로의 id)과 화면이 떠 있는지 */
export type ShownPolicy = { id: string | undefined; mounted: boolean };

/** 결과를 알릴 자리 — 시작한 규정을 아직 보고 있으면 도구 줄, 다른 규정으로 옮겼거나 화면을 떠났으면 화면 전체 알림(toast) */
export function resultTarget(startedId: string, shown: Readonly<ShownPolicy>): 'toolbar' | 'toast' {
  return shown.mounted && shown.id === startedId ? 'toolbar' : 'toast';
}

/** 화면 전체 알림에 붙이는 규정 이름 — 코드와 제목 */
export function policyLabel(p: { code?: string | null; title?: string | null } | null | undefined): string {
  return [p?.code, p?.title].filter(Boolean).join(' ');
}

/**
 * 지금 보는 규정을 담은 상자. 그린 직후(useLayoutEffect — 그리기와 같은 동기 구간)에 바꿔, 옮긴 직후 끝난 응답이 옛 규정을 지금
 * 규정으로 읽지 않게 한다(useEffect 면 그리기와 효과 사이에 끝난 응답이 옛 값을 본다). 화면이 내려가면 mounted 가 false 가 된다.
 * ref 대신 useState 로 고정한 객체에 둔다 — 메뉴 항목처럼 그리는 중에 넘기는 함수가 이 상자를 닫아 두면 '렌더 중 ref 접근' 검사에
 * 걸린다(useFlashMessage 와 같은 방식). 그리는 중에는 읽지 않는다.
 */
export function useShownPolicy(id: string | undefined): Readonly<ShownPolicy> {
  const [box] = useState<ShownPolicy>(() => ({ id, mounted: false }));
  useLayoutEffect(() => {
    box.id = id;
  });
  useLayoutEffect(() => {
    box.mounted = true;
    return () => {
      box.mounted = false;
    };
  }, [box]);
  return box;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

// 도구 줄 상태 칸은 lib/toolStatus 로 옮겼다(T-224 — 낡음 표시). 여기서도 함께 내보낸다
export { useToolStatus, type ResultSource, type ToolStatus, type ToolStatusKind } from './toolStatus';

/**
 * 지금 떠 있는 규정 화면의 도구 줄(규정 id → 상태). 규정마다 화면을 새로 그리므로, 작업을 시작한 화면이 내려간 뒤 같은 규정을 다시 그린
 * 화면이 떠 있으면 결과를 그 화면의 도구 줄로 보낸다 — 실패를 4초짜리 알림으로만 보내지 않게(12차 #3). 그린 직후 넣고 내려갈 때 뺀다.
 */
const shownToolbars = new Map<string, ToolStatus>();
export const toolbarFor = (policyId: string): ToolStatus | undefined => shownToolbars.get(policyId);
/** 등록하고 해제 함수를 돌려준다 — 해제는 자기가 건 것일 때만 뺀다(새 화면이 먼저 걸었으면 그대로 둔다) */
export function registerToolbar(policyId: string, status: ToolStatus): () => void {
  shownToolbars.set(policyId, status);
  return () => {
    if (shownToolbars.get(policyId) === status) shownToolbars.delete(policyId);
  };
}
export function useShownToolbar(policyId: string | undefined, status: ToolStatus): void {
  useLayoutEffect(() => (policyId ? registerToolbar(policyId, status) : undefined), [policyId, status]);
}

/**
 * 지금 열려 있는 규정 화면의 창(첨부 'attachments'·조 순서 'reorder')의 오류 칸 — 시작한 화면이 내려간 뒤 끝난 실패를, 같은 규정을
 * 다시 그린 화면에 그 창이 열려 있으면 창 안에 보인다(도구 줄은 창 뒤에 가린다, 13차 #2). 창이 열려 있는 동안만 건다.
 */
const openDialogs = new Map<string, (message: string) => void>();
export const openDialogFor = (kind: string, policyId: string) => openDialogs.get(`${kind}:${policyId}`);
export function registerOpenDialog(kind: string, policyId: string, setError: (message: string) => void): () => void {
  const key = `${kind}:${policyId}`;
  openDialogs.set(key, setError);
  return () => {
    if (openDialogs.get(key) === setError) openDialogs.delete(key);
  };
}
export function useOpenDialog(kind: string, policyId: string | undefined, open: boolean, setError: (message: string) => void): void {
  useLayoutEffect(() => (policyId && open ? registerOpenDialog(kind, policyId, setError) : undefined), [kind, policyId, open, setError]);
}

// 성공을 잠깐 알림과 이름 붙은 알림 가운데 어디로 보낼지는 holds 하나로 판정한다(남긴 실패만 보는 isSticky 는 넘기지 않는다 — 재검토 3차 #6)
type ToolbarSink = Pick<ToolStatus, 'flash' | 'fail' | 'failStale' | 'settle' | 'holds'>;
export type ResultSinks = ToolbarSink & {
  /** 화면 전체 알림 — ms 는 머무는 시간(없으면 알림 저장소의 기본값) */
  toast: (message: string, variant: 'success' | 'error', ms?: number) => void;
  /** 시작한 화면이 아닌, 지금 그 규정을 그리는 화면의 도구 줄(없으면 undefined) */
  screenFor?: (policyId: string) => ToolbarSink | undefined;
};
/** 결과의 종류 — stale 은 받기 실패를 알리는 남기는 실패(낡음 표시, staleKeys 를 그 뒤 모두 받으면 걷힌다 — T-224 ④) */
export type ResultKind = 'success' | 'error' | 'stale';
export type ResultNote = {
  startedId: string;
  label: string;
  message: string;
  kind: ResultKind;
  /** 잠깐 보이는 시간 — 도구 줄(없으면 3초)과 화면 전체 알림(없으면 알림 저장소의 기본값)에 같이 쓴다 */
  flashMs?: number;
  /** 낡음 표시가 기다리는 조회(받지 못한 key) */
  staleKeys?: readonly QueryKey[];
  /** 작업 이름(예 'info') — 실패는 그 작업의 앞 실패 줄을 바꾸고, 성공은 그 작업이 남긴 실패 줄을 걷는다(T-224) */
  source?: ResultSource;
};
/** 결과 알림의 덧붙임 — 숫자면 잠깐 보이는 시간(옛 꼴) */
export type ReportExtra = { flashMs?: number; staleKeys?: readonly QueryKey[]; source?: ResultSource };

/**
 * 결과 알림 — 시작한 규정을 아직 보고 있으면 도구 줄: 실패는 오류 번호를 옮겨 적을 수 있게 남기고(앞 실패가 떠 있으면 덧붙인다), 성공은
 * 잠깐 보이되 남긴 실패가 떠 있으면 그 줄을 덮지 않고 이름 붙은 화면 전체 알림으로(사용자가 새 동작을 하면 남긴 실패는 바뀐다).
 * 시작한 화면이 내려갔어도 같은 규정을 다시 그린 화면이 떠 있으면 그 화면의 도구 줄로 같은 규칙을 쓴다(12차 #3). 다른 규정으로
 * 옮겼거나 화면을 떠났으면 그 규정 이름을 붙여 화면 전체 알림으로. 어느 쪽이든 결과를 버리지 않는다.
 */
export function deliverResult(shown: Readonly<ShownPolicy>, sinks: ResultSinks, t: T, note: ResultNote): void {
  const bar = resultTarget(note.startedId, shown) === 'toolbar' ? sinks : sinks.screenFor?.(note.startedId);
  if (bar) {
    if (note.kind === 'stale') return bar.failStale(note.message, note.staleKeys ?? [], note.source);
    if (note.kind === 'error') return bar.fail(note.message, note.source);
    // 그 작업이 성공했다 — 그 작업이 남긴 실패 줄(진행 문구)을 먼저 걷는다(다시 저장해 성공하면 '저장하지 못했습니다'가 남지 않게). 칸을
    // 남긴 실패나 다른 작업의 진행 문구가 쓰고 있으면 덮지 않고 이름 붙은 알림으로(내보내기 중에 저장이 끝나도 진행 문구가 남게 — 재검토 #3)
    if (note.source) bar.settle(note.source);
    if (!bar.holds()) return bar.flash(note.message, note.flashMs ?? 3000);
  }
  const text = t('policyDetail.result.forPolicy', { label: note.label, message: note.message });
  const variant = note.kind === 'success' ? 'success' : 'error';
  // 긴 안내만 알림에도 그만큼 오래 둔다 — 기본값보다 짧게 줄이지는 않는다(T-224)
  if (note.flashMs !== undefined && note.flashMs > TOAST_MS) sinks.toast(text, variant, note.flashMs);
  else sinks.toast(text, variant);
}

/** 결과 알림 함수(deliverResult 에 화면 전체 알림·지금 떠 있는 화면을 이어 붙인 것) — 돌려주는 함수는 인자가 같으면 늘 같다 */
export function useReportResult(shown: Readonly<ShownPolicy>, status: ToolStatus, t: T) {
  return useCallback(
    (startedId: string, label: string, message: string, kind: ResultKind, extra?: number | ReportExtra) => {
      const x: ReportExtra = typeof extra === 'number' ? { flashMs: extra } : (extra ?? {});
      deliverResult(
        shown,
        { flash: status.flash, fail: status.fail, failStale: status.failStale, settle: status.settle, holds: status.holds, toast, screenFor: toolbarFor },
        t,
        { startedId, label, message, kind, flashMs: x.flashMs, staleKeys: x.staleKeys, source: x.source },
      );
    },
    [shown, status, t],
  );
}

/** 결과 알림 함수의 꼴(useReportResult 가 돌려주는 것) — 훅·페이지가 같은 꼴로 넘긴다 */
export type ReportFn = (startedId: string, label: string, message: string, kind: ResultKind, extra?: number | ReportExtra) => void;

/**
 * 끝난 쓰기의 결과(T-224 ④) — 다시 받았으면 완료 문구(성공), 받지 못했으면 완료 문구에 '받아 오지 못했습니다'를 덧붙여 낡음 표시로(그
 * 조회들을 그 뒤에 받으면 걷힌다 — 다시 저장해 성공하면 '새로 고침해 확인'이 남지 않게, C-116 ⑥). since 는 이 쓰기의 다시 받기를 시작한
 * 때(fetchPolicyNowSince) — 그 뒤에 다른 받기가 이미 받았으면 성공으로 본다. keys 를 주지 않으면 그 규정 본문 ['policy', id]. source 는
 * 작업 이름(성공은 그 작업의 앞 실패 줄을 걷고, 낡음 표시는 그 작업의 줄로)
 */
export function reportAfterRefresh(
  qc: QueryClient,
  report: ReportFn,
  t: T,
  v: { startedId: string; label: string; done: string; received: boolean; since: number; keys?: readonly QueryKey[]; flashMs?: number; source?: ResultSource },
): void {
  const stale = v.received ? [] : stillStale(qc, v.keys ?? [['policy', v.startedId]], v.since);
  if (stale.length === 0) return report(v.startedId, v.label, v.done, 'success', { flashMs: v.flashMs, source: v.source });
  report(v.startedId, v.label, `${v.done} ${t('policyDetail.result.refreshFailed')}`, 'stale', { staleKeys: stale, source: v.source });
}

/**
 * 창(초안 일괄 시행·상태 전환 확인)에서 시작한 작업의 실패를 어디에 알릴지 — 그 규정을 보고 있고 그 규정의 창이 열려 있으면 창 안(창이
 * 오류를 그린다), 아니면 결과 알림(deliverResult). 창을 닫았거나 다른 규정으로 옮긴 뒤의 실패를 버리지 않는다.
 */
export function dialogErrorTarget(startedId: string, shown: Readonly<ShownPolicy>, dialogFor: string | null | undefined): 'dialog' | 'report' {
  return resultTarget(startedId, shown) === 'toolbar' && dialogFor === startedId ? 'dialog' : 'report';
}

/**
 * 시점 본문을 받는 중에 고른 조(보류한 이동)를 어떻게 할지 — 다른 규정으로 옮겼거나 분절 보기로 갔으면 버리고, 아직 받는 중이면
 * 기다리고, 받았으면 간다.
 */
export function pendingJumpAction(
  pending: { policyId: string | undefined } | null,
  s: { asOfBlocked: boolean; fullView: boolean; id: string | undefined },
): 'none' | 'wait' | 'run' | 'drop' {
  if (!pending) return 'none';
  if (pending.policyId !== s.id || !s.fullView) return 'drop';
  if (s.asOfBlocked) return 'wait';
  return 'run';
}

export type ExportKind = 'pdf' | 'hwpx';
/**
 * 규정별로 진행을 두는 작업 — 내보내기 둘, 초안 일괄 시행, 시행 상태 전환, 규정 정보(날짜·알림) 저장, 적용 양식 저장, 첨부 올리기·지우기,
 * 조 순서 저장, 판 쓰기(version — 전환 다섯·검토 요청, 한 규정에서 한 번에 하나, 초안 일괄 시행과 서로 막는다, T-224)
 */
export type RunKind = ExportKind | 'publish' | 'toggle' | 'info' | 'template' | 'upload' | 'deleteFile' | 'reorder' | 'version';

/** 진행 이름 — 규정마다 따로 둔다(다른 규정에서 시작한 작업이 이 규정의 버튼·항목을 막지 않는다) */
export const runKey = (kind: RunKind, policyId: string) => `${kind}:${policyId}`;

/** 그 규정의 그 작업이 진행 중인가 */
export const isRunning = (running: readonly string[], kind: RunKind, policyId: string | undefined) => policyId !== undefined && running.includes(runKey(kind, policyId));

/** 지금(그린 값이 아니라 저장소의 지금 값으로) 그 규정의 그 작업이 진행 중인가 — 서로 막는 작업의 시작이 본다(한 번 그리는 사이에 둘 다 눌려도) */
export const runningNow = (kind: RunKind, policyId: string) => usePolicyRunsStore.getState().running.includes(runKey(kind, policyId));

/** 지금 보는 규정의 내보내기 진행 표시 */
export function exportBusyFor(running: readonly string[], policyId: string | undefined): Record<ExportKind, boolean> {
  return { pdf: isRunning(running, 'pdf', policyId), hwpx: isRunning(running, 'hwpx', policyId) };
}

/**
 * 규정별 작업 진행. 같은 규정·같은 작업은 끝날 때까지 다시 시작하지 않는다 — 함수가 스스로 본다(한 번 그리는 사이에 두 번 눌려도).
 * 진행은 화면 밖 저장소(stores/policyRunsStore)에 둔다 — 규정을 옮겼다 돌아와 화면을 새로 그려도 진행 중 표시와 막음이 이어진다(12차).
 * running 이 바뀌면 다시 그려 버튼 글·메뉴 항목이 따라간다. start·end 는 늘 같은 함수다.
 */
export function useRuns() {
  const running = usePolicyRunsStore((s) => s.running);
  const targets = usePolicyRunsStore((s) => s.targets);
  const startKey = usePolicyRunsStore((s) => s.start);
  const endKey = usePolicyRunsStore((s) => s.end);
  const start = useCallback((kind: RunKind, policyId: string, target?: string) => startKey(runKey(kind, policyId), target), [startKey]);
  const end = useCallback((kind: RunKind, policyId: string) => endKey(runKey(kind, policyId)), [endKey]);
  /** 진행 중인 그 작업이 보낸 값(없으면 undefined) */
  const targetOf = (kind: RunKind, policyId: string | undefined) => (policyId === undefined ? undefined : targets[runKey(kind, policyId)]);
  return { running, start, end, targetOf };
}
