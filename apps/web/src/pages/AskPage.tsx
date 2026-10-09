import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircleQuestion, Send, BookOpen, AlertTriangle, ExternalLink } from 'lucide-react';
import { askApi, AskBlock, AskCitation, AskResult } from '../api/ask';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { articleHash } from '../lib/articleAnchor';
import { formatArticleJo, formatClauseHang, formatItemMok } from '../lib/legalArticleLabel';

/**
 * T-130 규정 질문 — 직원이 말로 물으면 지금 시행 중인 사내 규정만 근거로 AI 가 답한다(D-09 결정).
 *
 * 답 아래에는 AI 가 옮긴 글이 아니라 **DB 의 시행 중 본문**을 근거로 보여 준다 — 직원이 답을 그대로
 * 믿지 않고 근거를 바로 확인할 수 있어야 한다. 근거가 없으면 답 대신 살펴본 조문을 보여 준다.
 */

const EXAMPLES = ['결혼하면 경조금은 얼마인가요?', '연차휴가는 며칠까지 쓸 수 있나요?', '출장비는 어떻게 정산하나요?'];

const REASON_TEXT: Record<NonNullable<AskResult['reason']>, string> = {
  no_regulations: '아직 시행 중인 규정이 없어 답할 수 없습니다.',
  no_candidates: '질문과 관련된 조문을 찾지 못했습니다. 다른 표현으로 묻거나 통합검색을 써 보세요.',
  no_basis: '살펴본 조문에서 답의 근거를 찾지 못했습니다. 아래 조문을 직접 확인해 보세요.',
  refused: '이 질문에는 답할 수 없습니다.',
};

interface Turn {
  question: string;
  result: AskResult;
}

function citationLabel(c: Pick<AskCitation, 'number' | 'branchNumber' | 'clauseNumber' | 'itemNumber'>): string {
  return [
    formatArticleJo(c.number, c.branchNumber),
    c.clauseNumber != null ? formatClauseHang(c.clauseNumber) : '',
    c.itemNumber != null ? formatItemMok(c.itemNumber) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function errorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const msg = Array.isArray(data?.message) ? data?.message[0] : data?.message;
  return msg || '답을 받지 못했습니다. 잠시 후 다시 물어 주세요.';
}

function Blocks({ blocks }: { blocks: AskBlock[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-800">
      {blocks.map((b, i) => {
        if (b.type === 'paragraph') return <p key={i} className="whitespace-pre-wrap">{b.text}</p>;
        if (b.type === 'list') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 text-sm">
              {b.headers.length > 0 && (
                <thead className="bg-gray-50">
                  <tr>
                    {b.headers.map((h, j) => (
                      <th key={j} className="border border-gray-200 px-3 py-1.5 text-left font-medium text-gray-700">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k} className="border border-gray-200 px-3 py-1.5 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const { question, result } = turn;
  return (
    <div className="card p-5 space-y-4" data-testid="ask-turn">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-gray-400" />
        <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{question}</p>
      </div>

      {result.answerable ? (
        <>
          <Blocks blocks={result.blocks} />
          <p className="text-[11px] text-gray-500">
            AI가 아래 조문을 근거로 쓴 답입니다. 정확한 내용은 근거 조문을 확인하세요.
          </p>
          <div className="space-y-2" data-testid="ask-citations">
            <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
              <BookOpen size={13} /> 근거 조문 {result.citations.length}건
            </p>
            {result.citations.map((c) => (
              <div key={c.ref} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                <Link
                  to={`/policies/${c.policyId}${articleHash(c)}`}
                  className="text-xs font-medium text-navy-700 hover:underline inline-flex items-center gap-1"
                >
                  {c.policyTitle} · {citationLabel(c)}
                  {c.joTitle ? `(${c.joTitle})` : ''}
                  <ExternalLink size={11} />
                </Link>
                {c.content.trim() && <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">{c.content}</p>}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {REASON_TEXT[result.reason ?? 'no_basis']}
          </p>
          {result.reason === 'no_candidates' && (
            <Link to={`/search?q=${encodeURIComponent(question)}`} className="text-xs text-navy-700 hover:underline">
              통합검색에서 찾아보기 →
            </Link>
          )}
          {result.consulted.length > 0 && (
            <ul className="text-xs text-gray-700 space-y-1">
              {result.consulted.map((c) => (
                <li key={`${c.policyId}-${c.number}-${c.branchNumber ?? 0}`}>
                  <Link to={`/policies/${c.policyId}${articleHash(c)}`} className="hover:underline">
                    {c.policyTitle} · {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function AskPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const isPlatformAdmin = (user as { platformRole?: string } | null)?.platformRole === 'global_admin';
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);

  const { data: status, isLoading } = useQuery({ queryKey: ['ask-status'], queryFn: askApi.status });

  const askMutation = useMutation({
    mutationFn: (q: string) => askApi.ask(q),
    onSuccess: (result, q) => {
      setTurns((prev) => [{ question: q, result }, ...prev].slice(0, 10));
      setQuestion('');
      qc.setQueryData(['ask-status'], (s: typeof status) =>
        s ? { ...s, used: result.usage.used, userUsed: result.usage.userUsed } : s,
      );
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => askApi.setEnabled(enabled),
    onSuccess: (s) => {
      qc.setQueryData(['ask-status'], s);
      qc.invalidateQueries({ queryKey: ['ask-status'] });
      toast(s.enabled ? '규정 질문을 켰습니다.' : '규정 질문을 껐습니다.', 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 2 || askMutation.isPending) return;
    askMutation.mutate(q);
  };

  const canAsk = !!status?.configured && !!status?.enabled;

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="규정 질문"
        description="사내 규정에 대해 물으면, 지금 시행 중인 규정을 근거로 AI가 답합니다."
        actions={
          status?.configured ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span data-testid="ask-usage">
                이번 달 회사 {status.used}/{status.limit}회 · 나 {status.userUsed}/{status.userLimit}회
              </span>
              {isAdmin && (
                <button
                  type="button"
                  className="btn-secondary text-xs px-2.5 py-1"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(!status.enabled)}
                >
                  {status.enabled ? '회사 전체 끄기' : '회사 전체 켜기'}
                </button>
              )}
            </div>
          ) : null
        }
      />

      {isLoading && <LoadingBlock />}

      {status && !status.configured && (
        <div className="card p-4 border-amber-200 bg-amber-50 text-sm text-amber-900 flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">규정 질문(AI)은 아직 준비 중입니다.</p>
            <p className="text-xs mt-1">
              {/* 서버 키는 고객사가 넣을 수 없다 — 운영자(플랫폼 관리자)에게만 설정 방법을 보인다 */}
              {isPlatformAdmin ? (
                <>
                  서버 환경변수 <code className="font-mono">ANTHROPIC_API_KEY</code>에 AI 키를 넣고 API를 다시 띄우면
                  쓸 수 있습니다.
                </>
              ) : (
                '쓰려면 아스트룸에 문의하세요.'
              )}
            </p>
          </div>
        </div>
      )}

      {status?.configured && !status.enabled && (
        <div className="card p-4 border-amber-200 bg-amber-50 text-sm text-amber-900">
          회사 관리자가 규정 질문을 꺼 두었습니다.
          {isAdmin && ' 위의 "회사 전체 켜기"로 다시 켤 수 있습니다.'}
        </div>
      )}

      {canAsk && (
        <form onSubmit={submit} className="card p-4 space-y-3">
          <textarea
            className="input w-full text-sm min-h-[84px]"
            placeholder="예) 결혼하면 경조금은 얼마인가요?"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="text-xs rounded-full border border-gray-200 px-2.5 py-1 text-gray-600 hover:bg-gray-50"
                onClick={() => setQuestion(ex)}
              >
                {ex}
              </button>
            ))}
            <button
              type="submit"
              className="btn-primary ml-auto inline-flex items-center gap-1.5 text-sm"
              disabled={question.trim().length < 2 || askMutation.isPending}
            >
              <Send size={14} /> {askMutation.isPending ? '찾는 중…' : '묻기'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            답을 쓰기 위해 질문과 관련 조문이 외부 AI(Anthropic)로 전송됩니다.
          </p>
        </form>
      )}

      {askMutation.isPending && (
        <div className="card p-4 text-sm text-gray-600">규정에서 근거를 찾아 답을 쓰고 있습니다… (보통 10~30초)</div>
      )}
      {askMutation.isError && (
        <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">{errorMessage(askMutation.error)}</div>
      )}

      {turns.map((turn, i) => (
        <TurnView key={turns.length - i} turn={turn} />
      ))}
    </div>
  );
}
