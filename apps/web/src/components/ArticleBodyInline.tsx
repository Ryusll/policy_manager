import { Fragment, type ReactNode } from 'react';

/**
 * 조문 본문: 평문 + `**굵게**`만 인라인 강조 (저장은 문자열 그대로).
 */
export function ArticleBodyInline({ text, className }: { text: string; className?: string }) {
  const src = String(text ?? '');
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  for (;;) {
    m = re.exec(src);
    if (m === null) break;
    if (m.index > last) {
      parts.push(<Fragment key={key++}>{src.slice(last, m.index)}</Fragment>);
    }
    parts.push(
      <strong key={key++} className="font-semibold text-gray-900">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    parts.push(<Fragment key={key++}>{src.slice(last)}</Fragment>);
  }
  return <span className={className}>{parts}</span>;
}
