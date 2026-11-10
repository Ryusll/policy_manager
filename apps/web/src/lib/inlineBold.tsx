import { Fragment, type ReactNode } from 'react';

/**
 * 규정 질문 답 문장의 굵게(T-207) — 서버가 짝을 맞춰 보낸 `**…**` 만 <strong> 으로 바꾸고 나머지는 글자 그대로 둔다.
 * HTML 로 바꾸지 않는다(dangerouslySetInnerHTML 없음) — 답 문장은 AI 가 쓴 글이라 태그가 섞여 와도 글자로만 보여야 한다.
 */
export function renderInline(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-gray-900">
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
