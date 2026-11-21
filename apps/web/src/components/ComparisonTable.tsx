/**
 * 신구조문대비표의 표 (T-56, 조 묶음과 주소는 T-229).
 *
 * 조마다 tbody 하나 — 첫 줄은 조 머리 `제N조(제목)`(scope=rowgroup)이고, 구분 칸은 어느 조인지까지(`제12조 ② 1.`) 적는다.
 * 왼쪽이 구조문, 오른쪽이 신조문이고 바뀐 낱말만 강조한다. 묶기·주소·제목 줄은 `lib/compareTableGroups`.
 */

import { clsx } from 'clsx';
import type { CompareKind, CompareRow } from '../api/policies';
import type { CompareTableGroup, CompareTableRow } from '../lib/compareTableGroups';
import { useI18n } from '../i18n/useI18n';

type Badge = CompareKind | 'moved';

const KIND_KEY: Record<Badge, string> = {
  added: 'compareTable.kind.added',
  removed: 'compareTable.kind.removed',
  changed: 'compareTable.kind.changed',
  same: 'compareTable.kind.same',
  moved: 'compareTable.kind.moved',
};

const KIND_BADGE: Record<Badge, string> = {
  added: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  removed: 'bg-rose-50 border-rose-300 text-rose-800',
  changed: 'bg-amber-50 border-amber-300 text-amber-800',
  same: 'bg-gray-50 border-gray-300 text-gray-500',
  moved: 'bg-sky-50 border-sky-300 text-sky-800',
};

type Side = 'before' | 'after';

/** 구조문 쪽: 삭제된 낱말만 표시 / 신조문 쪽: 추가된 낱말만 표시 */
function DiffText({ row, side }: { row: CompareRow; side: Side }) {
  const source = side === 'before' ? row.before : row.after;
  if (!source) return <span className="text-gray-400">—</span>;
  if (!row.diff) return <>{source.content}</>;

  return (
    <>
      {row.diff.map((part, i) => {
        if (side === 'before' && part.added) return null;
        if (side === 'after' && part.removed) return null;
        const highlight = side === 'before' ? part.removed : part.added;
        return (
          <span
            key={i}
            className={clsx(
              highlight &&
                (side === 'before'
                  ? 'bg-rose-100 text-rose-900 line-through decoration-rose-400'
                  : 'bg-emerald-100 text-emerald-900 font-medium'),
            )}
          >
            {part.value}
          </span>
        );
      })}
    </>
  );
}

function SideCell({ item, side }: { item: CompareTableRow; side: Side }) {
  const { t } = useI18n();
  const { row } = item;
  const source = side === 'before' ? row.before : row.after;
  const segments = side === 'before' ? item.beforeTitle : item.afterTitle;
  // 제목이 바뀌었으면 제목 조각만 긋고 칠한다 — 번호까지 그으면 조를 지운 것처럼 읽힌다
  const titleMark = item.titleDiffers ? (side === 'before' ? 'text-rose-800 line-through' : 'text-emerald-800') : undefined;

  if (!source) {
    return (
      <td className="border border-gray-300 px-3 py-2">
        <span className="text-xs text-gray-400">
          {t(side === 'before' ? 'compareTable.cell.added' : 'compareTable.cell.removed')}
        </span>
      </td>
    );
  }
  return (
    <td className="border border-gray-300 px-3 py-2">
      {/* 조 번호가 바뀐 항·목 — 구조문 날짜의 위치(구분 칸은 신조문 날짜의 위치) */}
      {side === 'before' && item.beforeAddress && (
        <div className="text-[11px] font-semibold text-gray-500 mb-0.5">{item.beforeAddress}</div>
      )}
      {segments && (
        <div className="text-xs font-medium mb-1 text-gray-800">
          {segments.map((s, i) => (
            <span key={i} className={s.part === 'title' ? titleMark : undefined}>
              {s.text}
            </span>
          ))}
        </div>
      )}
      <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
        <DiffText row={row} side={side} />
      </div>
    </td>
  );
}

export default function ComparisonTable({ groups, from, to }: { groups: CompareTableGroup[]; from: string; to: string }) {
  const { t } = useI18n();
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 bg-gray-100 print:static">
        <tr>
          <th className="border border-gray-300 px-2 py-1.5 w-28 text-xs font-semibold text-gray-700">
            {t('compareTable.col.address')}
          </th>
          <th className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 w-1/2">
            {t('compareTable.col.before', { date: from })}
          </th>
          <th className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 w-1/2">
            {t('compareTable.col.after', { date: to })}
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        // 인쇄: 한 쪽에 들어가는 묶음은 쪼개지 않는다(쪽 끝에 머리만 남지 않게). 한 쪽보다 긴 묶음은 쪼개진다
        <tbody key={group.key} className="print:break-inside-avoid">
          {/* 조 머리 — 인쇄는 배경을 빼므로 굵은 글과 위 선으로 가른다. 긴 묶음에서도 머리를 다음 줄과 붙인다 */}
          <tr className="print:break-after-avoid">
            <th
              colSpan={3}
              scope="rowgroup"
              className="border border-gray-300 border-t-2 border-t-navy-300 bg-navy-50 px-2 py-1.5 text-left text-xs font-bold text-navy-900"
            >
              {group.heading}
            </th>
          </tr>
          {group.rows.map((item) => {
            const badge: Badge = item.movedOnly ? 'moved' : item.row.kind;
            return (
              <tr key={item.row.articleId} className="align-top">
                {/* 주소는 한 줄 — 좌우 칸이 반씩 가져가면 글자마다 줄이 바뀐다(`제/12/조`). 칸은 주소만큼 넓어진다 */}
                <td className="border border-gray-300 px-2 py-2 whitespace-nowrap">
                  <div className="text-xs font-semibold text-navy-800">{item.address}</div>
                  <span
                    className={clsx(
                      'inline-flex mt-1 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                      KIND_BADGE[badge],
                    )}
                  >
                    {t(KIND_KEY[badge])}
                  </span>
                </td>
                <SideCell item={item} side="before" />
                <SideCell item={item} side="after" />
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}
