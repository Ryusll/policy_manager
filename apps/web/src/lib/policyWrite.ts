import { flushSync } from 'react-dom';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { toast } from '../stores/toastStore';
import { serverMessage } from './apiError';
import { bannerFor, bannerOf, bannersOf } from './articleBanner';
import { authScopeGuard, fetchPolicyNowSince, refetchReceived } from './policyRefresh';
import { deliverResult, resultTarget, toolbarFor, type ResultKind, type RunKind, type ShownPolicy } from './policyResult';
import { stillStale, type ResultSource, type ToolStatus } from './toolStatus';
import { sameDialog } from './writeDialogs';

/*
 * 규정 상세 본문 안 쓰기 하나(T-224 단계 B·C, 설계 D3·E1~E10) — useMutation 대신 시작할 때 값을 잡아 끝까지 쓰는 async 함수다(화면이
 * 내려가도 끝난다, 관찰자 상태 isPending·isError 를 쓰지 않는다). 차례:
 *  1. 진행을 규정별 저장소에 건다(start — 같은 규정·같은 종류가 돌고 있으면 시작하지 않는다, ①)
 *  2. 쓰기를 보낸다. 끝나자마자 로그아웃·다른 사용자 로그인이면 받지도 알리지도 않고 진행만 푼다(E10)
 *  3. 성공이든 실패든 그 규정 본문과 기다릴 조회(판 목록 등)를 다시 받는다(곁 조회는 기다리지 않고 무효화만, E13)
 *  4. 결과 — 성공: 시작할 때 잡은 번호의 창이 아직 열려 있으면 닫고(flushSync — 진행을 풀기 전에 그린다, T-225) 완료 문구, 받지 못한
 *     조회가 있으면 낡음 표시(E8). 거절(4xx): 그 창이 열려 있으면 창 안에, 아니면 결과 알림. 응답 없음·5xx: 다시 받은 값으로 반영됐는지
 *     보고(E4) 반영됐으면 '오류로 끝났지만 반영됐습니다', 아니면 '확인하지 못했습니다'(서버 까닭이 있으면 함께) — 창은 닫는다(서버가
 *     잠금을 기다렸다 나중에 반영할 수 있어 옛 상태를 든 창을 두지 않는다)
 *  5. 진행을 푼다(받기가 끝난 뒤, ③)
 * 결과 자리: 시작한 화면이든 같은 규정을 다시 그린 화면이든 그 조문을 분절 보기로 보이면 조문 배너(lib/articleBanner), 아니면 그 화면의
 * 도구 줄, 그리는 화면이 없으면 '코드 제목 — 문구' 알림(lib/policyResult deliverResult 의 규칙 그대로, ②).
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

/** 쓰기의 바탕 — 훅이 화면에서 넘긴다(시작한 화면의 상자·도구 줄) */
export type WriteDeps = {
  qc: QueryClient;
  shown: Readonly<ShownPolicy>;
  toolbar: ToolStatus;
  t: T;
  start: (kind: RunKind, policyId: string, target?: string) => boolean;
  end: (kind: RunKind, policyId: string) => void;
};

export type WriteSpec<R> = {
  kind: RunKind;
  policyId: string;
  /** 이름 붙은 알림에 붙이는 규정 이름(코드 제목) */
  label: string;
  /** 진행 중인 대상 — 그 줄만 '처리 중…'(예 approve:판 id) */
  target?: string;
  /** 결과를 보일 조문 배너의 조문 */
  articleId?: string;
  /** 시작할 때 잡은 창(종류·번호) — 같은 번호의 창이 아직 열려 있을 때만 닫거나 창 안에 실패를 보인다 */
  dialog?: { kind: string; token: number | null };
  /** 작업 이름 — 실패 줄은 같은 작업의 성공이 걷는다 */
  source?: ResultSource;
  /** 이 쓰기의 이름(확인 못 함·반영됨 문구에 들어간다, 예 '시행 승인') */
  action: string;
  call: () => Promise<R>;
  /** 규정 본문 말고 다시 받아 기다릴 조회 */
  waitKeys?: readonly QueryKey[];
  /** 기다리지 않고 무효화만 할 조회(대시보드·목록·개정 후보 등) — 응답(없으면 undefined)을 보고 고른다 */
  sideKeys?: (res: R | undefined) => readonly QueryKey[];
  /** 결과 알림 글에 대상(조문 표기·판 번호)을 붙인다 */
  subject?: (message: string) => string;
  done: (res: R) => string;
  /** 거절(4xx) 문구 — 창 안에는 그대로, 결과 알림에는 대상을 붙인다 */
  refusedText: (err: unknown) => string;
  /**
   * 응답 없음·5xx 뒤 — 반영됐으면 true, 아니면 false, 모르면 undefined. 볼 값을 스스로 새로 받는다(보는 화면이 없는 조회는 다시 받기가
   * 무효로 표시만 하고 받지 않아, 캐시에는 누를 때의 값이 남아 있다 — B1 검토)
   */
  landed?: (qc: QueryClient) => boolean | undefined | Promise<boolean | undefined>;
};

/** 서버가 거절했다(4xx) — 반영되지 않았다. 응답이 없거나 5xx 면 반영됐는지 모른다 */
export function refusedWrite(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** 서버 거절 문구가 사람에게 보일 한국어면 그것 — 영문 기본 문구·검증 문구면 null(쓰기마다의 대체 문구를 쓴다, E12) */
export function koreanReason(err: unknown): string | null {
  const m = serverMessage(err);
  return m && /[가-힣]/.test(m) ? m : null;
}

/** 도구 줄·알림에 머무는 시간 — 글 길이에 따라 3~10초(긴 폐지·철회 안내를 다 읽게, D4) */
export const readMs = (message: string) => Math.min(10000, Math.max(3000, 1500 + message.length * 50));

/**
 * 결과를 알린다 — 그 조문 배너가 보이면 거기, 아니면 deliverResult(시작한 화면의 도구 줄 → 다시 그린 화면 → 이름 붙은 알림). 쓰기가
 * 반영된 갈래(applied — 성공, 성공했지만 받지 못함, 5xx 뒤 반영 확인)면 같은 작업(판)의 옛 줄을 결과가 가지 않는 자리(시작한 화면의 도구
 * 줄·다시 그린 화면의 도구 줄·보이지 않는 배너)에서도 걷고, 그 조문의 보이지 않는 배너는 비운다(배너의 성공 글은 줄이 아니라 settle 로
 * 걷히지 않는다) — 배너엔 '승인했습니다', 도구 줄엔 그 판의 '확인하지 못했습니다'가 함께 남지 않게(B1 검토). 실패는 다른 자리를 건드리지
 * 않는다(앞 성공의 받기 실패 안내가 새 실패에 묻히지 않게)
 */
function deliver(deps: WriteDeps, spec: WriteSpec<unknown>, message: string, kind: ResultKind, staleKeys?: readonly QueryKey[], applied = false) {
  const here = bannerFor(spec.policyId, spec.articleId) ?? deps.toolbar;
  if (applied && spec.source) {
    const target = resultTarget(spec.policyId, deps.shown) === 'toolbar' ? here : (bannerFor(spec.policyId, spec.articleId) ?? toolbarFor(spec.policyId));
    for (const place of new Set([deps.toolbar, toolbarFor(spec.policyId), ...bannersOf(spec.policyId)])) {
      if (place && place !== target) place.settle(spec.source);
    }
    const own = bannerOf(spec.policyId, spec.articleId);
    if (own && own !== target) own.clear();
  }
  deliverResult(
    deps.shown,
    {
      flash: here.flash,
      fail: here.fail,
      failStale: here.failStale,
      settle: here.settle,
      holds: here.holds,
      toast,
      screenFor: (policyId) => bannerFor(policyId, spec.articleId) ?? toolbarFor(policyId),
    },
    deps.t,
    { startedId: spec.policyId, label: spec.label, message, kind, flashMs: readMs(message), staleKeys, source: spec.source },
  );
}

/** 쓰기 하나를 끝까지 — 시작하지 못했으면(같은 규정의 같은 종류가 도는 중) false */
export async function runWrite<R>(deps: WriteDeps, spec: WriteSpec<R>): Promise<boolean> {
  if (!deps.start(spec.kind, spec.policyId, spec.target)) return false;
  try {
    await settle(deps, spec);
  } finally {
    deps.end(spec.kind, spec.policyId);
  }
  return true;
}

async function settle<R>(deps: WriteDeps, spec: WriteSpec<R>) {
  const inScope = authScopeGuard();
  let res: R | undefined;
  let failure: { err: unknown } | null = null;
  try {
    res = await spec.call();
  } catch (err) {
    failure = { err };
  }
  if (!inScope()) return;
  for (const queryKey of spec.sideKeys?.(res) ?? []) void deps.qc.invalidateQueries({ queryKey });
  const waitKeys = spec.waitKeys ?? [];
  const [{ fresh, since }, ...got] = await Promise.all([
    fetchPolicyNowSince(deps.qc, spec.policyId, inScope),
    ...waitKeys.map((k) => refetchReceived(deps.qc, k).then((ok) => ({ fresh: ok, since: 0 }))),
  ]);
  if (!inScope()) return;
  // 받지 못한 조회만 — 그중 내 받기를 시작한 뒤 다른 받기가 이미 받은 것은 뺀다(받은 것까지 따지면 같은 때에 받은 것이 낡은 쪽으로 남는다)
  const failed = [...(fresh === null ? [['policy', spec.policyId]] : []), ...waitKeys.filter((_, i) => !got[i].fresh)];
  const missed = failed.length > 0 ? stillStale(deps.qc, failed, since) : [];
  const dialog = spec.dialog ? sameDialog(spec.policyId, spec.dialog.kind, spec.dialog.token) : undefined;
  const subject = spec.subject ?? ((m: string) => m);
  const say = (message: string, kind: ResultKind, stale?: readonly QueryKey[], applied = false) =>
    deliver(deps, spec as WriteSpec<unknown>, message, kind, stale, applied);
  if (!failure) {
    if (dialog) flushSync(() => dialog.close());
    const message = subject(spec.done(res as R));
    if (missed.length > 0) say(`${message} ${deps.t('policyDetail.result.refreshFailed')}`, 'stale', missed, true);
    else say(message, 'success', undefined, true);
    return;
  }
  if (refusedWrite(failure.err)) {
    const message = spec.refusedText(failure.err);
    if (dialog) flushSync(() => dialog.setError(message));
    else say(subject(message), 'error');
    return;
  }
  // 응답 없음·5xx — 다시 받은 값을 다 받았을 때만 반영 여부를 본다(못 받았으면 모른다)
  if (dialog) flushSync(() => dialog.close());
  const landed = missed.length === 0 ? await spec.landed?.(deps.qc) : undefined;
  if (!inScope()) return;
  if (landed === true) {
    say(subject(deps.t('policyWrites.landed', { action: spec.action })), 'error', undefined, true);
    return;
  }
  // 확인하지 못했다는 줄은 받기로 걷지 않는다 — 뒤에 받은 값이 옛 상태여도 서버가 잠금을 기다렸다 나중에 반영할 수 있다(재검토 #2)
  const why = serverMessage(failure.err);
  say(subject(why ? deps.t('policyWrites.unknownWhy', { action: spec.action, reason: why }) : deps.t('policyWrites.unknown', { action: spec.action })), 'error');
}
