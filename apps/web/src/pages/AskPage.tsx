import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { askApi, type AskResult, type AskScopePolicy, type AskStatus } from '../api/ask';
import { useAuthStore } from '../stores/authStore';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { AskNotConfigured, AskOffNotice } from '../components/AskNotice';
import { AskHeaderActions } from '../components/AskHeaderActions';
import { AskComposer } from '../components/AskComposer';
import { AskExamples } from '../components/AskExamples';
import { AskTurnView } from '../components/AskTurn';
import { AskHistoryAside, ASK_HISTORY_KEY } from '../components/AskHistoryPanel';
import { AskHistoryView } from '../components/AskHistoryView';
import { AskScopePicker } from '../components/AskScopePicker';
import { useI18n } from '../i18n/useI18n';
import { ASK_STATUS_KEY, useAskStatus } from '../hooks/useAskStatus';
import { useIncomingQuestion } from '../hooks/useIncomingQuestion';
import { canAskNow, normalizeQuestion } from '../lib/askQuestion';
import { roleCanOpen } from '../lib/viewerAccess';
import { errorCode, serverMessage } from '../lib/apiError';

/**
 * T-130 규정 질문 — 직원이 말로 물으면 지금 시행 중인 사내 규정만 근거로 AI 가 답한다(D-09 결정).
 *
 * 화면은 질문부터 하게 짠다(T-217, SRS SEARCH-9): 아직 물은 것이 없으면 가운데 큰 입력 카드와 예시 질문,
 * 답이 생기면 입력 카드가 위로 올라가고 답이 아래에 쌓인다. 대시보드 입구가 넘긴 질문은 한 번만 보내고,
 * 주소(`?q=`)로 온 질문은 입력칸에 채우기만 한다(`lib/askQuestion` 의 `incomingQuestion`).
 * 왼쪽에는 내 지난 질문(T-218, SEARCH-10) — 고르면 그때의 답을 그대로 다시 보이고, 새로 물으면 고른 것이 풀린다.
 * 입력 카드 아래 줄에서 살펴볼 규정을 골라 범위를 좁힌다(T-219, SEARCH-11) — 고르지 않으면 회사 전체.
 */

interface Turn {
  question: string;
  result: AskResult;
  /** 물을 때 고른 범위 — 비었으면 회사 전체 */
  scope: AskScopePolicy[];
}

export default function AskPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const { t } = useI18n();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  // 다시 보는 지난 질문(T-218)
  const [historyId, setHistoryId] = useState<string | null>(null);
  // 질문 범위(T-219) — 고른 규정 id. 비었으면 회사 전체
  const [scope, setScope] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: status, isLoading, isError: statusFailed, refetch: refetchStatus } = useAskStatus();
  const canAsk = canAskNow(status);

  const askMutation = useMutation({
    mutationFn: (v: { question: string; policyIds: string[] }) => askApi.ask(v.question, v.policyIds),
    onSuccess: (result, v) => {
      // 물을 때 고른 범위를 답 위에 보인다 — 서버가 확인한 그때의 이름(지난 질문과 같은 값)
      setTurns((prev) => [{ question: v.question, result, scope: result.scope }, ...prev].slice(0, 10));
      // 기다리는 동안 새로 쓴 질문은 남긴다 — 보낸 글 그대로일 때만 비운다
      setQuestion((current) => (normalizeQuestion(current) === v.question ? '' : current));
      qc.setQueryData<AskStatus>(ASK_STATUS_KEY, (s) =>
        s ? { ...s, used: result.usage.used, userUsed: result.usage.userUsed } : s,
      );
    },
    onError: (e) => {
      // 그사이 꺼졌거나 고지가 바뀌었으면(403) 상태를 다시 받아 폼 대신 안내를 보인다
      qc.invalidateQueries({ queryKey: ASK_STATUS_KEY });
      // 고른 규정이 그사이 비활성으로 바뀌었거나 지워졌으면 목록을 다시 받는다 — 고르기가 범위에서 뺀다(T-219)
      if (errorCode(e) === 'AI_QA_SCOPE_INVALID') qc.invalidateQueries({ queryKey: ['policies'] });
    },
    // 답했든 못 했든 질문은 기록에 남는다 — 목록을 다시 받고, 기다리는 동안 지난 질문을 열었으면 이번 결과로 돌아온다
    onSettled: () => {
      setHistoryId(null);
      void qc.invalidateQueries({ queryKey: ASK_HISTORY_KEY });
    },
  });
  const { mutate: askQuestion, isPending: asking } = askMutation;
  const ask = (q: string) => {
    setHistoryId(null);
    askQuestion({ question: q, policyIds: scope });
  };
  // 지난 질문을 고르면 바로 전 질문의 오류 안내는 거둔다 — 보내는 중이면 그대로 두고, 결과가 오면 그 결과로 돌아온다
  const selectHistory = (id: string) => {
    setHistoryId(id);
    if (!asking) askMutation.reset();
  };
  // 답의 법령 칩이 가는 곳은 법령 상세 — 그 화면을 열 수 있는 역할에게만 링크로 보인다(T-172 판정)
  const canOpenLaws = roleCanOpen(user?.role, '/laws/:id');

  // 넘겨받은 질문(T-217) — 대시보드 입구는 한 번만 보내고(범위 없이), 주소의 `?q=` 는 채우기만 한다(hooks/useIncomingQuestion)
  const fillIncoming = useCallback((q: string) => setQuestion(q), []);
  const sendIncoming = useCallback(
    // 보내지 못하면(그사이 꺼짐 등) 질문을 입력칸에 돌려준다
    (q: string) => askQuestion({ question: q, policyIds: [] }, { onError: () => setQuestion((current) => current || q) }),
    [askQuestion],
  );
  useIncomingQuestion({ statusReady: !!status, canAsk, pending: asking, fill: fillIncoming, send: sendIncoming });

  // 아직 받은 답이 없으면 가운데 큰 입력 카드(첫 질문이 실패해도 그대로) — 보내는 순간·지난 질문을 고르면 위쪽 모양으로
  const hero = turns.length === 0 && !asking && !historyId;
  // 새 질문 — 고른 지난 질문과 이번에 받은 답을 비우고 처음 화면으로(지난 답은 목록에 남는다)
  const startOver = () => {
    setHistoryId(null);
    setTurns([]);
    setQuestion('');
    askMutation.reset();
  };

  return (
    <div className="page-shell">
      <PageHeader
        title={t('layout.nav.ask')}
        description={t('ask.description')}
        actions={status?.configured ? <AskHeaderActions status={status} isAdmin={isAdmin} /> : null}
      />

      {isLoading && <LoadingBlock />}

      {statusFailed && !status && (
        <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200 flex flex-wrap items-center gap-3" data-testid="ask-status-error">
          <span>{t('ask.statusError')}</span>
          <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={() => refetchStatus()}>
            {t('asOfView.retry')}
          </button>
        </div>
      )}

      {status && !status.configured && <AskNotConfigured role={user?.role} platformRole={user?.platformRole} />}

      {status?.configured && !status.enabled && <AskOffNotice needsConsent={status.needsConsent} isAdmin={isAdmin} />}

      {canAsk && status && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <AskHistoryAside selectedId={historyId} onSelect={selectHistory} onNew={startOver} />

          <div className="min-w-0 flex-1 space-y-5">
            <AskComposer
              variant={hero ? 'hero' : 'compact'}
              value={question}
              onChange={setQuestion}
              onSubmit={() => ask(normalizeQuestion(question))}
              pending={asking}
              notice={status.notice}
              inputRef={inputRef}
              toolbar={<AskScopePicker selected={scope} onChange={setScope} disabled={asking} />}
            >
              <AskExamples
                role={user?.role}
                onPick={(text) => {
                  setQuestion(text);
                  inputRef.current?.focus();
                }}
              />
            </AskComposer>

            {asking && <div className="card p-4 text-sm text-gray-600">{t('ask.pending')}</div>}
            {askMutation.isError && (
              <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200" data-testid="ask-error">
                {errorCode(askMutation.error) === 'AI_QA_SCOPE_INVALID'
                  ? t('ask.scope.invalid')
                  : (serverMessage(askMutation.error) ?? t('ask.error.generic'))}
              </div>
            )}

            {historyId ? (
              <AskHistoryView id={historyId} canOpenLaws={canOpenLaws} />
            ) : (
              turns.map((turn, i) => (
                <AskTurnView key={turns.length - i} question={turn.question} result={turn.result} scope={turn.scope} canOpenLaws={canOpenLaws} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
