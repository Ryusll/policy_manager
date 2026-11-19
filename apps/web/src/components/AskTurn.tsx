import { Link } from 'react-router-dom';
import { MessageCircleQuestion } from 'lucide-react';
import type { AskAnswerResult } from '../api/ask';
import { AskAnswer } from './AskAnswer';
import { useI18n } from '../i18n/useI18n';
import { articleHash } from '../lib/articleAnchor';

/**
 * 질문 하나와 그 답(T-130). 답 아래에는 AI 가 옮긴 글이 아니라 **DB 의 시행 중 본문**을 근거로 보여 준다 —
 * 직원이 답을 그대로 믿지 않고 근거를 바로 확인할 수 있어야 한다. 근거가 없으면 답 대신 사유와 살펴본 조문을 보인다.
 */
export function AskTurnView({
  question,
  result,
  canOpenLaws,
}: {
  question: string;
  result: AskAnswerResult;
  canOpenLaws: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="card p-5 space-y-4" data-testid="ask-turn">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-gray-400" />
        <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{question}</p>
      </div>

      {result.answerable ? (
        <AskAnswer result={result} canOpenLaws={canOpenLaws} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {t(`ask.reason.${result.reason ?? 'no_basis'}`)}
          </p>
          {result.reason === 'no_candidates' && (
            <Link to={`/search?q=${encodeURIComponent(question)}`} className="text-xs text-navy-700 hover:underline">
              {t('ask.searchLink')}
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
