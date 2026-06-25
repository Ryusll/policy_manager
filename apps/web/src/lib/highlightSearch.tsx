import type { ReactNode } from 'react';
import { escapeRegExp } from './searchRegex';

/** 화면 내 검색용: 일치 구간을 `<mark>`로 감싼 React 노드 */
export function highlightText(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  let regex: RegExp;
  try {
    regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  } catch {
    return String(text ?? '');
  }
  const parts = String(text ?? '').split(regex);
  return parts.map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={idx} className="bg-yellow-200 px-0.5 rounded tmpl-fullview-hit">
        {part}
      </mark>
    ) : (
      <span key={idx}>{part}</span>
    ),
  );
}
