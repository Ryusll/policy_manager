import { useEffect, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { policiesApi } from '../../api/policies';
import { apiErrorMessage, errorCode, serverMessage } from '../../lib/apiError';
import { dialogErrorTarget, isRunning, useRuns, type ShownPolicy } from '../../lib/policyResult';
import { authScopeGuard, fetchPolicyNow } from '../../lib/policyRefresh';
import { useLatest } from '../../lib/useLatest';
import { baseStep, noteLeft, staleKey, type ReorderBase, type ReorderNote } from './reorderNotice';

// 안내 칸의 규칙은 reorderNotice.ts — 페이지·시험이 여기서 함께 가져다 쓴다
export { baseStep, noteLeft, reorderNotice, staleKey, type ReorderBase, type ReorderNote } from './reorderNotice';

type Report = (startedId: string, label: string, message: string, kind: 'success' | 'error', flashMs?: number) => void;
type Order = Parameters<typeof policiesApi.reorderArticles>[1];
type Chapters = readonly unknown[] | null | undefined;
type Chapter = { id?: string; number?: number; articles?: { id?: string; number?: number; branchNumber?: number | null }[] };
const listOf = (chapters: Chapters) => (chapters ?? []) as Chapter[];
/** 조문 하나의 자리 — 장·조 번호·가지 번호(0 과 없음은 같다 — 서버의 짝 맞추기와 같게) */
const placeOf = (chapterId: string | undefined, number: number | undefined, branch: number | null | undefined) => `${chapterId}/${number}/${branch || ''}`;

/**
 * 조 순서를 가르는 서명 — 조가 있는 장(id·번호)과 조문마다의 자리(id·장·번호·가지 번호)를 id 차례로 늘어놓는다. 순서 창은 이 값이
 * 바뀌면 새로 그린다(화면이 key 로 쓴다): 연 창은 열 때의 순서를 들고 있어, 그 뒤에 받은 새 순서로 다시 저장하면 바뀐 번호에 옛 순서를
 * 보낸다(T-215 14차 #1·#2). 응답 배열의 차례에는 기대지 않는다 — 자리가 같은 조문(중복 번호로 가져온 규정)은 다시 받을 때마다 차례가
 * 바뀔 수 있다(15차 #4). 빈 장은 창에 그리지 않으므로 넣지 않는다 — 다른 사람이 빈 장을 더하거나 지워도 옮기던 것이 사라지지 않게(16차)
 */
export function joOrderSignature(chapters: Chapters): string {
  const list = listOf(chapters);
  const heads = list.filter((c) => (c.articles ?? []).length > 0).map((c) => `${c.id}/${c.number}`).sort();
  const rows = list.flatMap((c) => (c.articles ?? []).map((a) => `${a.id}@${placeOf(c.id, a.number, a.branchNumber)}`)).sort();
  return `${heads.join(',')}|${rows.join(',')}`;
}

/**
 * 보낸 차례가 반영됐다면 조문마다 갈 자리(순수 함수, 조문 id → 자리). 서버처럼(api policies/article-reorder.ts buildReorderPlan) 보낸
 * 차례의 n번째가 가리키는 옛 (조 번호·가지 번호)의 행이 모두 n번 조·가지 없음·그 장으로 간다
 */
export function expectedPlaces(chapters: Chapters, order: Order): Map<string, string> {
  const byOld = new Map<string, string[]>();
  for (const c of listOf(chapters))
    for (const a of c.articles ?? []) {
      const key = `${a.number}-${a.branchNumber || 0}`;
      if (a.id) byOld.set(key, [...(byOld.get(key) ?? []), a.id]);
    }
  const out = new Map<string, string>();
  order.forEach((target, i) => {
    for (const id of byOld.get(`${target.jo}-${target.branch || 0}`) ?? []) out.set(id, placeOf(target.chapterId, i + 1, null));
  });
  return out;
}

/** 받은 규정에서 보낸 차례가 보이는가 — 그 조문들이 모두 갈 자리에 있다(그 뒤에 다른 사람이 더한 조는 보지 않는다) */
export function orderApplied(chapters: Chapters, expected: ReadonlyMap<string, string>): boolean {
  const at = new Map<string, string>();
  for (const c of listOf(chapters)) for (const a of c.articles ?? []) if (a.id) at.set(a.id, placeOf(c.id, a.number, a.branchNumber));
  return expected.size > 0 && [...expected].every(([id, place]) => at.get(id) === place);
}

/** 서버가 받고 거절했다(4xx — 계획·검사에서 막혀 반영되지 않았다). 응답이 없거나 5xx 면 반영됐을 수 있다(앞단 시간 제한 등) */
function refused(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' && status < 500;
}

/** 저장 진행을 지켜보는 상자 — 지난 그리기의 저장 중, 이 화면이 시작한 저장인가, 저장 중을 처음 본 때의 순서 */
export type ReorderWatch = { saving: boolean; mine: boolean; sigAtStart: string };

/**
 * 다른 화면(옮기기 전의 같은 규정 화면)이 시작한 저장이 이 화면이 떠 있는 동안 끝났는가(순수 함수). 저장 중을 처음 본 때의 순서와 끝난
 * 뒤의 순서가 다를 때만 끝난 것으로 본다 — 실패로 끝나 순서가 그대로면 이 화면의 선택을 놓지 않는다(14차 #3). 이 화면이 시작한 저장은
 * save 가 직접 다룬다. 저장 중에 그려진 화면은 첫 단계에서 그때의 순서를 잡는다.
 */
export function reorderWatchStep(w: ReorderWatch, saving: boolean, signature: string): { next: ReorderWatch; settled: boolean } {
  if (!w.saving && saving) return { next: { saving, mine: w.mine, sigAtStart: signature }, settled: false };
  if (w.saving && !saving) return { next: { saving, mine: false, sigAtStart: '' }, settled: !w.mine && signature !== w.sigAtStart };
  return { next: { ...w, saving }, settled: false };
}

/**
 * 조 순서 저장(T-215 12~16차). 규정마다 화면을 새로 그리므로(PolicyDetailView key):
 * - 진행은 규정별 화면 밖 저장소(useRuns 'reorder') — 옮겼다 돌아와도 저장 중이 보이고 겹쳐 저장하지 않는다. 저장 중에는 창을 열지
 *   않는다(saving 을 보고 화면이 막는다). 그래서 다시 그린 화면에는 이 저장의 순서 창이 열려 있을 수 없다
 * - 끝나면 성공이든 실패든 시작한 규정을 직접 다시 받는다(lib/policyRefresh — 화면을 옮겨 지켜보는 쪽이 없어도, 15차 #2·16차)
 * - 성공 — onSaved(선택한 조 놓기·창 닫기). 새 순서를 받지 못했으면 그렇다고 알린다(옛 순서가 남은 창을 다시 열어 같은 이동을 또
 *   보내지 않게, 16차 #5)
 * - 서버가 거절(4xx) — 반영되지 않았다. 그 사이 순서가 바뀌었어도 서버 문구 그대로 그 창 안에(창이 없으면 결과 알림, 15차 #1). 창을 연
 *   뒤에 다른 저장이 배치를 바꿨으면(409 POLICY_JO_ORDER_STALE — 창이 그린 규정의 배치 지문 basedOn 을 함께 보내 서버가 견준다, T-225)
 *   화면 문구를 창 위 안내 칸에 하나만(setNote — 다시 받은 새 순서로 새로 그린 창의 다시 열기 안내 대신). 문구는 창에 무엇이 있는지에
 *   따라 셋: 지금 순서로 새로 그렸으면 확인하고 다시 옮기라고, 받았는데 순서가 창과 같으면(바꿨다 되돌림·응답에서 빠지는 행만 바뀜) 옮긴
 *   것이 그대로이니 다시 저장하라고, 받지 못해 옛 순서 그대로면 새로 고치라고(다시 저장해도 같은 거절이다). 안내는 그 순서를 떠나면 걷는다.
 *   지문이 없으면(옛 응답) 보내지 않고 새로 고치라고 한다 — 서버가 400 으로 거절한다
 * - 응답이 없거나 5xx — 받은 규정에 보낸 차례가 보이면 반영된 것이고, 아니면 서버가 잠금을 기다렸다 나중에 반영할 수도 있어 반영됐는지
 *   모른다. 어느 쪽이든 창을 닫고 알린다 — 옛 순서를 든 창에서 다시 저장하면 두 번 적용된다(16차 #1)
 * - 인증 주체가 바뀌었으면(로그아웃·다른 사용자 로그인) 아무것도 알리지 않는다(T-181, 16차 #2)
 * 다른 화면이 시작한 저장이 끝나 순서가 바뀌었으면 이 화면도 onSaved.
 */
export function useReorderSave(o: {
  id: string | undefined;
  label: string;
  panelOpen: boolean;
  /** 순서 창이 그린 규정의 장 — 보낸 차례가 가리키는 조문을 여기서 찾는다(창은 서명이 바뀌면 새로 그려 늘 이 값과 같다) */
  chapters: Chapters;
  /** 창이 그린 규정의 배치 지문(GET :id 의 current.joOrderBasis, T-225) — 저장할 때 보내 서버가 잠근 뒤 지금 배치와 견준다 */
  basedOn?: string;
  signature: string;
  shown: Readonly<ShownPolicy>;
  report: Report;
  setError: (message: string) => void;
  /** 창 위 안내 칸의 거절 안내(T-225, reorderNotice 가 읽는다) — 저장을 시작하거나 그 순서를 떠나면 걷는다 */
  note: ReorderNote | null;
  setNote: (note: ReorderNote | null) => void;
  onSaved: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const qc = useQueryClient();
  const { running, start, end } = useRuns();
  const panelOf = useLatest(o.panelOpen ? o.id : null);
  const latest = useLatest(o);
  const saving = isRunning(running, 'reorder', o.id);
  const [watch] = useState<ReorderWatch>(() => ({ saving: false, mine: false, sigAtStart: '' }));
  useEffect(() => {
    const { next, settled } = reorderWatchStep(watch, saving, o.signature);
    Object.assign(watch, next);
    if (settled) latest.current.onSaved();
  }, [saving, o.signature, watch, latest]);
  useEffect(() => {
    if (noteLeft(o.note, o.signature)) latest.current.setNote(null);
  }, [o.note, o.signature, latest]);
  // 창 기준(baseStep) — 열고 닫을 때, 그린 순서가 바뀔 때. 저장을 시작할 때와 거절 안내를 달 때는 save 가 잡는다. 저장이 끝나 거절 문구를
  // 고를 때는 그 사이 그린 것까지 반영된 지금 값을 읽는다(save 는 시작한 그리기의 값을 닫아 둔다). layout effect 라 그린 직후 같은 태스크
  // 안에서 고친다 — passive effect 면 한 태스크 늦어, 그 사이 끝난 받기가 새로 그리기 전의 기준을 읽고 문구를 잘못 고른다
  const [base, setBase] = useState<ReorderBase>({ sig: null, redrawn: false });
  const baseNow = useLatest(base);
  // latest.current 는 위 useLatest(o) 의 layout effect 가 먼저 고친 값이다 — 선언 차례를 바꾸지 말 것(아래로 옮기면, 앞 그리기 뒤에 순서가
  // 바뀐 채 열 때 연 그리기의 서명 대신 앞 그리기의 서명을 기준으로 잡아 막 연 창에 '다시 열었습니다'가 뜬다)
  useLayoutEffect(() => {
    setBase((b) => baseStep(b, o.panelOpen ? { type: 'open', sig: latest.current.signature } : { type: 'close' }));
  }, [o.panelOpen, latest]);
  useLayoutEffect(() => {
    setBase((b) => baseStep(b, { type: 'sig', sig: o.signature }));
  }, [o.signature]);
  return {
    saving,
    /** 기준(연 때·저장을 시작한 때·거절 안내를 단 때) 뒤에 창이 새로 그려졌는가 — 다시 열기 안내(reorderNotice) */
    redrawn: base.redrawn,
    save: async (order: Order) => {
      const { id, label, shown, report, setError, setNote, onSaved, t, chapters, basedOn } = latest.current;
      if (!id) return;
      if (!basedOn) {
        const missing = t('policyDetail.reorder.basisMissing');
        if (dialogErrorTarget(id, shown, panelOf.current) === 'dialog') setError(missing);
        else report(id, label, missing, 'error');
        return;
      }
      if (!start('reorder', id)) return;
      watch.mine = true;
      setBase((b) => baseStep(b, { type: 'save', sig: joOrderSignature(chapters) }));
      setError('');
      setNote(null);
      const inScope = authScopeGuard();
      const expected = expectedPlaces(chapters, order);
      try {
        const failure = await policiesApi.reorderArticles(id, order, basedOn).then(
          () => null,
          (err: unknown) => ({ err }),
        );
        const fresh = await fetchPolicyNow(qc, id, inScope);
        if (!inScope()) return;
        // 창 닫기는 진행을 풀기 전에 그린다 — onSaved 의 setState 는 이벤트 밖(약속 이어짐)이라 다음 태스크로 밀리고, end 는 진행 저장소
        // 구독(useSyncExternalStore)이라 마이크로태스크에서 먼저 그려진다. 그 그리기에서 창이 아직 열린 채 새 순서로 붙으면 '다시
        // 열었습니다'가 한 번 끼어든다(거절 갈래의 안내와 같은 까닭)
        if (!failure) {
          flushSync(() => onSaved());
          if (!fresh) report(id, label, t('policyDetail.reorder.savedStale'), 'error');
          return;
        }
        if (!refused(failure.err)) {
          flushSync(() => onSaved());
          // 5xx 가 까닭을 실었으면 함께 적는다 — 반영됐는지는 모르지만 무엇이 실패했는지는 알게(문구 틀 안에, 17차 #6)
          const why = serverMessage(failure.err);
          const unverified = why ? t('policyDetail.reorder.unverifiedWhy', { reason: why }) : t('policyDetail.reorder.unverified');
          report(id, label, fresh !== null && orderApplied(fresh.chapters, expected) ? t('policyDetail.reorder.appliedAnyway') : unverified, 'error');
          return;
        }
        const toDialog = dialogErrorTarget(id, shown, panelOf.current) === 'dialog';
        // 창을 연 뒤에 다른 저장이 배치를 바꿨다 — 서버 문구 대신 화면 문구로(영어 화면도, T-225). 창은 지금 캐시의 순서로 그려지므로 그
        // 순서(서명)에 안내를 단다 — 다시 받았거나 그 사이 다른 받기로 순서가 바뀌었으면 지금 순서가 창에 있고, 아니면 옛 순서 그대로다
        if (errorCode(failure.err) === 'POLICY_JO_ORDER_STALE') {
          // 페이지의 순서 서명(reorderSig)과 같은 캐시 항목·같은 함수 — 페이지의 규정 조회는 select 없이 이 항목을 그대로 그린다(시험이 지킨다)
          const sig = joOrderSignature(qc.getQueryData<{ chapters?: Chapters }>(['policy', id])?.chapters);
          const redrawn = baseNow.current.redrawn || sig !== joOrderSignature(chapters);
          const message = t(staleKey({ toDialog, fresh: fresh !== null, redrawn }));
          // 진행을 풀기(end — 진행 저장소 구독은 동기 갱신) 전에 안내를 먼저 그린다 — 풀린 뒤 안내 없이 '다시 열었습니다'가 한 번 그려지지 않게.
          // 안내를 단 순서를 창 기준으로 — 사용자는 그 순서를 안내와 함께 봤다
          if (toDialog) {
            flushSync(() => {
              setNote({ sig, message });
              setBase((b) => baseStep(b, { type: 'note', sig }));
            });
          } else report(id, label, message, 'error');
          return;
        }
        // 지문 없는 저장의 거절(400 — 옛 응답을 들고 있던 화면)은 화면 문구로(영어 화면도)
        const message =
          errorCode(failure.err) === 'POLICY_JO_ORDER_BASIS_REQUIRED'
            ? t('policyDetail.reorder.basisMissing')
            : apiErrorMessage(failure.err, t('policyDetail.reorder.failed'));
        if (toDialog) setError(message);
        else report(id, label, message, 'error');
      } finally {
        end('reorder', id);
      }
    },
  };
}
