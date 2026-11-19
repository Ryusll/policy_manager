import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { decideIncomingQuestion, incomingQuestion } from '../lib/askQuestion';

/**
 * 다른 화면에서 넘겨받은 질문(T-217, SRS SEARCH-9 ③) — 대시보드 입구가 넘긴 질문(라우터 state)은 한 번만 보내고,
 * 주소의 `?q=` 로 온 질문은 채우기만 한다(누구나 링크로 만들 수 있다). 처리하면 바로 지운다 — 새로고침·뒤로 가기로 다시
 * 처리하지 않게. 개발 모드(StrictMode)는 효과를 돌렸다 되돌린 뒤 다시 돌린다 — 그 사이에 보내면 보내는 중 표시를 잃으므로
 * 한 박자 미뤄 처리한다. `fill`·`send` 는 바뀌지 않는 함수여야 한다(useCallback).
 */
export function useIncomingQuestion({
  statusReady,
  canAsk,
  pending,
  fill,
  send,
}: {
  statusReady: boolean;
  canAsk: boolean;
  pending: boolean;
  fill: (question: string) => void;
  send: (question: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // 넘겨받은 질문을 이미 처리한 이동(location.key) — 같은 이동을 두 번 처리하지 않는다
  const handledKey = useRef<string | null>(null);
  const { text, autoSend } = incomingQuestion(location.state, location.search);

  useEffect(() => {
    const action = decideIncomingQuestion({
      text,
      autoSend,
      handled: handledKey.current === location.key,
      statusReady,
      canAsk,
      pending,
    });
    if (action.kind === 'none' || action.kind === 'wait') return;
    const timer = window.setTimeout(() => {
      handledKey.current = location.key;
      const params = new URLSearchParams(location.search);
      params.delete('q');
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: null });
      if (action.kind === 'fill') fill(action.question);
      if (action.kind === 'send') send(action.question);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [text, autoSend, location.key, location.pathname, location.search, location.hash, statusReady, canAsk, pending, fill, send, navigate]);
}
