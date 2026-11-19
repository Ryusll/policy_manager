import { useState } from 'react';
import { CornerDownRight, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { useI18n } from '../i18n/useI18n';
import {
  ASK_EXAMPLE_KEYS,
  type AskExampleGroup,
  exampleGroupsFor,
  examplePage,
  examplePageCount,
  nextExamplePage,
} from '../lib/askExamples';

/**
 * 처음 화면의 예시 질문(T-217, SRS SEARCH-9 ②). 누르면 입력칸만 채우고 보내지는 않는다 — 직원이 고쳐서 보낼 수 있게.
 * 관리자·편집자는 담당자용·직원용을 고르고, 열람자에게는 직원용만 보인다.
 */
export function AskExamples({ role, onPick }: { role: string | null | undefined; onPick: (text: string) => void }) {
  const { t } = useI18n();
  const groups = exampleGroupsFor(role);
  const [picked, setPicked] = useState<AskExampleGroup>(groups[0]);
  const [page, setPage] = useState(0);
  const group = groups.includes(picked) ? picked : groups[0];
  const keys = ASK_EXAMPLE_KEYS[group];

  return (
    <div className="space-y-2" data-testid="ask-examples">
      {groups.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('ask.examples.heading')}>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={g === group}
              data-testid="ask-examples-tab"
              className={clsx(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                g === group
                  ? 'border-navy-300 bg-navy-50 font-medium text-navy-800'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              )}
              onClick={() => {
                setPicked(g);
                setPage(0);
              }}
            >
              {t(`ask.examples.tab.${g}`)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs font-medium text-gray-500">{t('ask.examples.heading')}</p>
      )}
      <ul className="divide-y divide-gray-100">
        {examplePage(keys, page).map((key) => (
          <li key={key}>
            <button
              type="button"
              data-testid="ask-example"
              className="flex w-full items-start gap-2 px-1 py-2 text-left text-sm text-gray-700 hover:text-navy-800"
              onClick={() => onPick(t(key))}
            >
              <CornerDownRight size={14} className="mt-0.5 shrink-0 text-gray-400" />
              <span>{t(key)}</span>
            </button>
          </li>
        ))}
      </ul>
      {examplePageCount(keys.length) > 1 && (
        <button
          type="button"
          data-testid="ask-examples-more"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
          onClick={() => setPage((p) => nextExamplePage(p, keys.length))}
        >
          <RefreshCw size={12} />
          {t('ask.examples.more')}
        </button>
      )}
    </div>
  );
}
