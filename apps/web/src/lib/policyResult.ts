import { useCallback, useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePolicyRunsStore } from '../stores/policyRunsStore';
import { toast } from '../stores/toastStore';

/*
 * 규정 상세에서 시작한 비동기 작업 가운데 진행을 규정별로 두는 것(RunKind — PDF·한/글 내보내기, 초안 일괄 시행, 시행 상태 전환, 규정 정보
 * 저장, 적용 양식 저장, 첨부 올리기·지우기, 조 순서 저장)의 진행 표시와 결과를 시작한 규정에 묶는다(T-215 8~13차 검토). 규정을 옮기면
 * 화면을 새로 그리므로(11차 — PolicyDetailPage 가 규정 id 로 key), 진행 중이던 앞 규정의 작업은 내려간 화면에서 끝난다 — 그 결과를 버리지
 * 않고, 같은 규정을 다시 그린 화면이 떠 있으면 그 화면(열린 창·도구 줄)에, 아니면 규정 이름을 붙여 화면 전체 알림으로 알린다. 진행
 * 표시는 화면 밖 저장소(stores/policyRunsStore)에 둬서 새로 그린 화면도 이어 본다(12차) — 같은 규정의 같은 작업은 끝날 때까지 다시
 * 시작하지 않는다. 본문 안의 다른 쓰기(승인·반려·폐지·철회·부칙·조문 추가·댓글)는 여기에 들지 않는다(T-224).
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

/** 도구 줄 상태 한 줄 — 실패는 남기고(오류 번호를 옮겨 적게), 사용자의 다음 동작(진행 문구·잠깐 알림)이 바꾼다 */
export type ToolStatus = {
  /** 진행 문구 등 사용자 동작 — 남긴 실패를 바꾼다 */
  show: (message: string) => void;
  /** 남기는 실패(끝난 작업의 결과) — 앞 실패가 떠 있으면 덧붙인다(둘 다 남는다, 같은 글은 한 번만) */
  fail: (message: string) => void;
  /** 사용자 동작의 실패 — 앞에 남은 실패를 바꾸고 남긴다(누를 때마다 길어지지 않게) */
  failNow: (message: string) => void;
  /** 잠깐 보이는 알림(사용자 동작의 결과) */
  flash: (message: string, ms: number) => void;
  clear: () => void;
  /** 남긴 실패가 떠 있는가 */
  isSticky: () => boolean;
};

/**
 * 도구 줄 상태(ToolStatus) — 남긴 실패인지를 상자에 같이 적는다(9차 검토: 같은 규정에서 PDF·한/글을 함께 돌리면 나중에 끝난 성공이
 * 앞의 실패를 덮고 지웠다). 상자는 useState 로 고정한 객체(그리는 중에 넘기는 함수가 닫아 두므로 ref 를 쓰지 않는다 — useShownPolicy 와
 * 같은 방식). 돌려주는 객체는 인자가 같으면 늘 같다.
 */
export function useToolStatus(setMsg: Dispatch<SetStateAction<string>>, flash: (message: string, ms: number) => void): ToolStatus {
  // fails — 남긴 실패 글들(덧붙인 차례). 글을 ' / ' 로 잘라 같은지 보면 서버 문구에 ' / ' 가 들면 어긋나 목록으로 둔다(12차 #5)
  const [box] = useState(() => ({ sticky: false, fails: [] as string[] }));
  return useMemo(() => {
    const reset = () => {
      box.sticky = false;
      box.fails = [];
    };
    return {
      show: (m: string) => {
        reset();
        setMsg(m);
      },
      fail: (m: string) => {
        // 남긴 실패가 이미 떠 있으면 덧붙인다 — 나중 실패를 4초짜리 알림으로 보내면 그 까닭(오류 번호)이 사라졌다(10차). 같은 글은 한 번만(11차).
        // 남긴 실패가 없으면 목록도 비어 있다(실패가 아닌 동작은 모두 reset 으로 비운다)
        if (!box.fails.includes(m)) box.fails = [...box.fails, m];
        box.sticky = true;
        setMsg(box.fails.join(' / '));
      },
      failNow: (m: string) => {
        box.sticky = true;
        box.fails = [m];
        setMsg(m);
      },
      flash: (m: string, ms: number) => {
        reset();
        flash(m, ms);
      },
      clear: () => {
        reset();
        setMsg('');
      },
      isSticky: () => box.sticky,
    };
  }, [box, setMsg, flash]);
}

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

type ToolbarSink = Pick<ToolStatus, 'flash' | 'fail' | 'isSticky'>;
export type ResultSinks = ToolbarSink & {
  toast: (message: string, variant: 'success' | 'error') => void;
  /** 시작한 화면이 아닌, 지금 그 규정을 그리는 화면의 도구 줄(없으면 undefined) */
  screenFor?: (policyId: string) => ToolbarSink | undefined;
};
export type ResultNote = { startedId: string; label: string; message: string; kind: 'success' | 'error'; flashMs?: number };

/**
 * 결과 알림 — 시작한 규정을 아직 보고 있으면 도구 줄: 실패는 오류 번호를 옮겨 적을 수 있게 남기고(앞 실패가 떠 있으면 덧붙인다), 성공은
 * 잠깐 보이되 남긴 실패가 떠 있으면 그 줄을 덮지 않고 이름 붙은 화면 전체 알림으로(사용자가 새 동작을 하면 남긴 실패는 바뀐다).
 * 시작한 화면이 내려갔어도 같은 규정을 다시 그린 화면이 떠 있으면 그 화면의 도구 줄로 같은 규칙을 쓴다(12차 #3). 다른 규정으로
 * 옮겼거나 화면을 떠났으면 그 규정 이름을 붙여 화면 전체 알림으로. 어느 쪽이든 결과를 버리지 않는다.
 */
export function deliverResult(shown: Readonly<ShownPolicy>, sinks: ResultSinks, t: T, note: ResultNote): void {
  const bar = resultTarget(note.startedId, shown) === 'toolbar' ? sinks : sinks.screenFor?.(note.startedId);
  if (bar) {
    if (note.kind === 'error') return bar.fail(note.message);
    if (!bar.isSticky()) return bar.flash(note.message, note.flashMs ?? 3000);
  }
  sinks.toast(t('policyDetail.result.forPolicy', { label: note.label, message: note.message }), note.kind);
}

/** 결과 알림 함수(deliverResult 에 화면 전체 알림·지금 떠 있는 화면을 이어 붙인 것) — 돌려주는 함수는 인자가 같으면 늘 같다 */
export function useReportResult(shown: Readonly<ShownPolicy>, status: ToolStatus, t: T) {
  return useCallback(
    (startedId: string, label: string, message: string, kind: 'success' | 'error', flashMs = 3000) =>
      deliverResult(shown, { flash: status.flash, fail: status.fail, isSticky: status.isSticky, toast, screenFor: toolbarFor }, t, { startedId, label, message, kind, flashMs }),
    [shown, status, t],
  );
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
/** 규정별로 진행을 두는 작업 — 내보내기 둘, 초안 일괄 시행, 시행 상태 전환, 규정 정보(날짜·알림) 저장, 적용 양식 저장, 첨부 올리기·지우기, 조 순서 저장 */
export type RunKind = ExportKind | 'publish' | 'toggle' | 'info' | 'template' | 'upload' | 'deleteFile' | 'reorder';

/** 진행 이름 — 규정마다 따로 둔다(다른 규정에서 시작한 작업이 이 규정의 버튼·항목을 막지 않는다) */
export const runKey = (kind: RunKind, policyId: string) => `${kind}:${policyId}`;

/** 그 규정의 그 작업이 진행 중인가 */
export const isRunning = (running: readonly string[], kind: RunKind, policyId: string | undefined) => policyId !== undefined && running.includes(runKey(kind, policyId));

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
