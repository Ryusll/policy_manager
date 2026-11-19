import { useState } from 'react';
import type { AskScopePolicy } from '../api/ask';
import { useI18n } from '../i18n/useI18n';

/** 범위 줄에 처음부터 이름을 적는 규정 수 — 나머지는 '외 N개' 단추로 펼친다(100개까지 고를 수 있어 줄이 길어지지 않게) */
export const SCOPE_LINE_SHOWN = 3;

const label = (p: AskScopePolicy) => [p.code, p.title].filter(Boolean).join(' ');

/**
 * 답과 지난 질문 위의 '범위: …' 한 줄(T-219, SRS SEARCH-11 ④) — 물을 때 고른 규정을 그때의 코드·이름으로 셋까지 적고,
 * 나머지는 '외 N개' 단추로 펼친다(터치·키보드로도 볼 수 있게). 비었으면 회사 전체라 그리지 않는다.
 */
export function AskScopeLine({ scope = [] }: { scope?: AskScopePolicy[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!scope.length) return null;
  const rest = scope.length - SCOPE_LINE_SHOWN;
  const shown = expanded || rest <= 0 ? scope : scope.slice(0, SCOPE_LINE_SHOWN);
  return (
    <p className="text-xs text-gray-500" data-testid="ask-turn-scope">
      {t('ask.scope.line', { names: shown.map(label).join(' · ') })}
      {rest > 0 && (
        <button
          type="button"
          className="ml-1.5 text-navy-700 hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          data-testid="ask-turn-scope-more"
        >
          {expanded ? t('ask.scope.lineLess') : t('ask.scope.lineMore', { n: rest })}
        </button>
      )}
    </p>
  );
}
