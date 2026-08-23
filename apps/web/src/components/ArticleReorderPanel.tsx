import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import {
  buildJoRows,
  hasReorderChanges,
  moveJo,
  renumberPreview,
  toReorderPayload,
  type JoRow,
} from '../lib/joReorder';

/**
 * 조 순서 일괄 재정렬 (T-60).
 *
 * 목차 안에서 바로 끌지 않고 별도 패널로 뺀 이유는, 목차가 검색으로 걸러지고 장이
 * 접히기 때문이다. 거기서 끌면 **보이는 것만 가지고 순서를 정하게 되고**, 화면에 없는
 * 조가 어디로 갔는지 모르는 채로 번호가 다시 매겨진다.
 *
 * 끌기만 되면 키보드·화면낭독기 사용자는 아예 쓸 수 없으므로 위/아래 버튼을 함께 둔다
 * (T-81에서 정한 방침과 같다).
 */
export default function ArticleReorderPanel({
  chapters,
  saving,
  error,
  onCancel,
  onSave,
}: {
  chapters: any[] | undefined | null;
  saving?: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (order: { chapterId: string; jo: number }[]) => void;
}) {
  const original = useMemo(() => buildJoRows(chapters), [chapters]);
  const [rows, setRows] = useState<JoRow[]>(original);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const preview = renumberPreview(rows);
  const changed = hasReorderChanges(original, rows);
  const movedCount = preview.filter((p) => p.moved).length;

  const move = (from: number, to: number) => setRows((prev) => moveJo(prev, from, to));

  /** 장 머리글은 그 장의 첫 조 앞에서만 그린다 */
  const showChapterHeadAt = (idx: number) =>
    idx === 0 || rows[idx - 1].chapterId !== rows[idx].chapterId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-300 shadow-2xl">
        <div className="bg-navy-900 text-white px-5 py-3 flex items-center gap-2">
          <span className="font-medium text-sm">조 순서 재정렬</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto text-white/70 hover:text-white"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 space-y-1.5">
          <p className="text-xs text-gray-600">
            끌어서 놓거나 위/아래 버튼으로 순서를 바꿉니다. <strong>장 경계를 넘기면 그 장으로 옮겨집니다.</strong>
          </p>
          <p className="text-xs text-gray-500">
            조 번호는 장을 가로질러 이어지므로(제1장 제1·2조 → 제2장 제3조), 하나만 옮겨도 뒤 번호가 함께 밀립니다.
            저장을 눌러야 실제로 반영됩니다.
          </p>
          {/* 안정 링크(T-73)는 조 번호 기준이다. 번호를 바꾸면 이미 나간 링크가 다른 조를 가리킨다. */}
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            조문 링크는 조 번호로 만들어집니다. 번호가 바뀌면 <strong>사내 위키·메일에 붙여둔 기존 링크가 다른 조를 가리키게 됩니다.</strong>
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows.length === 0 && (
            <p className="px-5 py-8 text-sm text-gray-500 text-center">재정렬할 조가 없습니다.</p>
          )}
          <ul className="divide-y divide-gray-100">
            {rows.map((row, idx) => {
              const p = preview[idx];
              return (
                <li key={`${row.chapterId}-${row.jo}`}>
                  {showChapterHeadAt(idx) && (
                    <div className="px-4 py-1.5 bg-gray-100/80 border-y border-gray-200 text-xs font-medium text-gray-700">
                      {row.chapterHidden ? '(장 제목 없음)' : `제${row.chapterNumber}장 ${row.chapterTitle}`}
                    </div>
                  )}
                  <div
                    draggable={!saving}
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverIndex(idx);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) move(dragIndex, idx);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    className={clsx(
                      'flex items-center gap-2 px-4 py-2 text-sm bg-white',
                      dragIndex === idx && 'opacity-40',
                      overIndex === idx && dragIndex !== idx && 'bg-navy-50 border-t-2 border-navy-500',
                    )}
                  >
                    <GripVertical size={14} className="text-gray-300 flex-shrink-0 cursor-grab" aria-hidden />
                    <span className="flex-1 truncate text-gray-800">
                      <span className="whitespace-nowrap font-medium">제{p.newNumber}조</span>
                      {row.title ? <span className="text-gray-600"> {row.title}</span> : null}
                    </span>
                    {p.moved && (
                      <span className="shrink-0 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                        제{p.jo}조 → 제{p.newNumber}조
                      </span>
                    )}
                    <span className="shrink-0 inline-flex">
                      <button
                        type="button"
                        onClick={() => move(idx, idx - 1)}
                        disabled={idx === 0 || saving}
                        className="p-1 text-gray-400 hover:text-navy-700 disabled:opacity-30"
                        aria-label={`제${p.newNumber}조 위로`}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(idx, idx + 1)}
                        disabled={idx === rows.length - 1 || saving}
                        className="p-1 text-gray-400 hover:text-navy-700 disabled:opacity-30"
                        aria-label={`제${p.newNumber}조 아래로`}
                      >
                        <ArrowDown size={13} />
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {error && (
          <p className="px-5 py-2 text-xs text-red-700 bg-red-50 border-t border-red-200">{error}</p>
        )}

        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-2">
          <span className="text-xs text-gray-500" aria-live="polite">
            {changed ? `${movedCount}개 조의 번호가 바뀝니다` : '바뀐 것이 없습니다'}
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => setRows(original)} disabled={!changed || saving}>
              되돌리기
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={onCancel} disabled={saving}>
              취소
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => onSave(toReorderPayload(rows))}
              disabled={!changed || saving}
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
