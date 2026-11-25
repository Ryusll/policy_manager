import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircleQuestion, Send } from 'lucide-react';
import { AskNoticeFooter } from './AskNotice';
import { useI18n } from '../i18n/useI18n';
import { useAskStatus } from '../hooks/useAskStatus';
import { ASK_MAX_CHARS, ASK_ONCE_STATE, canAskNow, canSubmitQuestion, normalizeQuestion } from '../lib/askQuestion';

/**
 * 대시보드 맨 위의 질문 입구(T-217, SRS SEARCH-9 ③). 대시보드에는 관리자·편집자만 온다 — 열람자는 메뉴의 '규정 질문'으로 들어온다.
 * 규정 질문이 켜져 있을 때만 보이고, 물으면 질문을 라우터 state 로 넘겨 질문 화면이 한 번만 보낸다(주소에 질문을 싣지 않는다 —
 * 주소로 온 질문은 채우기만 한다). 이 입구로도 질문이 외부 AI 로 나가므로 고지 한 줄을 함께 둔다(SEARCH-9 ④).
 */
export default function DashboardAskEntry() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: status } = useAskStatus();
  const [question, setQuestion] = useState('');

  if (!status || !canAskNow(status)) return null;
  const ready = canSubmitQuestion(question);

  return (
    <form
      className="card p-4 space-y-2"
      data-testid="dashboard-ask"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        navigate('/ask', { state: { [ASK_ONCE_STATE]: normalizeQuestion(question) } });
      }}
    >
      <label htmlFor="dashboard-ask-input" className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <MessageCircleQuestion size={16} className="text-navy-600" />
        {t('layout.nav.ask')}
      </label>
      <div className="flex gap-2">
        <input
          id="dashboard-ask-input"
          className="input min-w-0 flex-1 text-sm"
          placeholder={t('ask.hero.title')}
          value={question}
          maxLength={ASK_MAX_CHARS}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중의 Enter 는 글자를 마치는 것이다 — 그때는 보내지 않는다(브라우저마다 다르다)
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
        />
        <button type="submit" className="btn-primary inline-flex shrink-0 items-center gap-1.5 text-sm" disabled={!ready}>
          <Send size={14} /> {t('ask.submit')}
        </button>
      </div>
      <AskNoticeFooter notice={status.notice} />
    </form>
  );
}
