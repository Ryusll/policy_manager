import type { FormEvent, KeyboardEvent, ReactNode, Ref } from 'react';
import { Send } from 'lucide-react';
import type { AiQaNotice } from '../api/ask';
import { AskNoticeFooter } from './AskNotice';
import { useI18n } from '../i18n/useI18n';
import { ASK_MAX_CHARS, canSubmitQuestion } from '../lib/askQuestion';

export type AskComposerVariant = 'hero' | 'compact';

interface AskComposerProps {
  variant: AskComposerVariant;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  notice: AiQaNotice;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** 입력 카드 아래 줄 왼쪽에 두는 것(질문 범위 고르기, T-219) */
  toolbar?: ReactNode;
  /** 처음 화면에서 입력 카드와 고지 아래에 붙는 것(예시 질문) */
  children?: ReactNode;
}

/**
 * 질문 입력 카드(T-217, SRS SEARCH-9). 아직 물은 것이 없으면 화면 가운데 큰 카드(hero), 답이 생기면 위쪽의 작은 카드(compact).
 * 외부 전송 고지는 두 모양 모두 입력 카드 바로 아래에 둔다(SEARCH-6·9 ④). 보내는 중에는 다시 보낼 수 없다.
 * 두 모양이 같은 자리에 같은 입력칸을 두어, 보내는 순간 모양이 바뀌어도 쓰던 글과 초점이 그대로 남는다.
 */
export function AskComposer({ variant, value, onChange, onSubmit, pending, notice, inputRef, toolbar, children }: AskComposerProps) {
  const { t } = useI18n();
  const hero = variant === 'hero';
  const ready = !pending && canSubmitQuestion(value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSubmit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중의 Enter 는 글자를 마치는 것이다 — 보내지 않는다
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (ready) onSubmit();
    }
  };

  return (
    <section
      className={hero ? 'mx-auto w-full max-w-3xl space-y-4 py-4 sm:py-8' : undefined}
      data-testid="ask-composer"
      data-variant={variant}
    >
      {hero ? (
        <div className="space-y-1 text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t('ask.hero.title')}</h2>
          <p className="text-sm text-gray-500">{t('ask.hero.subtitle')}</p>
        </div>
      ) : null}
      <form
        onSubmit={submit}
        className={
          hero
            ? 'card transition-shadow focus-within:border-navy-400 focus-within:ring-2 focus-within:ring-navy-100'
            : 'card p-4 space-y-3'
        }
      >
        <textarea
          ref={inputRef}
          className={
            hero
              ? 'block w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 text-base leading-relaxed min-h-[120px] focus:outline-none focus:ring-0'
              : 'input w-full text-sm min-h-[84px]'
          }
          aria-label={t('ask.inputLabel')}
          placeholder={t('ask.placeholder')}
          value={value}
          maxLength={ASK_MAX_CHARS}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={hero ? 'flex items-center gap-2 px-3 pb-3' : 'flex items-center gap-2'}>
          {toolbar}
          <span className="hidden sm:inline text-[11px] text-gray-400" data-testid="ask-key-hint">
            {t('ask.keyHint')}
          </span>
          <button type="submit" className="btn-primary ml-auto inline-flex items-center gap-1.5 text-sm" disabled={!ready}>
            <Send size={14} /> {pending ? t('ask.submitting') : t('ask.submit')}
          </button>
        </div>
        {hero ? null : <AskNoticeFooter notice={notice} />}
      </form>
      {hero ? <AskNoticeFooter notice={notice} /> : null}
      {hero ? children : null}
    </section>
  );
}
