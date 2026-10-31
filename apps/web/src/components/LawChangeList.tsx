import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import {
  CHANGE_TYPE_LABEL,
  RECEIVED_VIA_LABEL,
  lawChangesApi,
  type LawChangeListItem,
} from '../api/lawChanges';
import LawImpactPanel from './LawImpactPanel';
import { effectiveNotesDates } from '../lib/effectiveNotes';
import { useI18n } from '../i18n/useI18n';
import { lawVersionLabel } from '../lib/lawVersionLabel';

const CHANGE_TYPE_STYLE: Record<string, string> = {
  created: 'bg-green-50 text-green-800 border-green-200',
  modified: 'bg-navy-50 text-navy-800 border-navy-100',
  deleted: 'bg-red-50 text-red-700 border-red-200',
};

type Props = {
  /** 주면 이 법령의 변경만. 안 주면 모든 법령(법령 목록 화면) */
  lawId?: string;
  /** 처음에 "우리 회사 영향 있는 것만"을 켤지 */
  affectedOnlyDefault: boolean;
  /** true 면 행을 펼쳐 영향을 바로 보여 주고, false 면 법령 상세로 보낸다 */
  expandable: boolean;
  /** 처음부터 펼쳐 둘 변경 id (`?change=`) */
  initialOpenId?: string | null;
  limit?: number;
};

/** 법령 변경 이벤트 목록 + 우리 회사 영향 수 (T-105) */
export default function LawChangeList({ lawId, affectedOnlyDefault, expandable, initialOpenId, limit = 30 }: Props) {
  const [affectedOnly, setAffectedOnly] = useState(affectedOnlyDefault);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const openRef = useRef<HTMLLIElement | null>(null);

  const { data: events = [], isLoading, isError } = useQuery({
    queryKey: ['law-changes', 'list', lawId ?? 'all', affectedOnly, limit],
    queryFn: () => lawChangesApi.list({ lawId, affected: affectedOnly, limit }),
  });

  // 다른 화면에서 특정 변경으로 들어왔으면 그 행으로 스크롤한다
  useEffect(() => {
    if (initialOpenId && openRef.current) openRef.current.scrollIntoView({ block: 'center' });
  }, [initialOpenId, events.length]);

  return (
    <div className="space-y-2">
      <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={affectedOnly} onChange={(e) => setAffectedOnly(e.target.checked)} />
        우리 회사 조문에 걸린 변경만
      </label>

      {isLoading && <p className="text-xs text-gray-500">불러오는 중…</p>}
      {isError && <p className="text-xs text-red-700">변경 내역을 불러오지 못했습니다.</p>}
      {!isLoading && !isError && events.length === 0 && (
        <p className="text-xs text-gray-500">
          {affectedOnly
            ? '우리 회사 조문에 걸린 법령 변경이 없습니다. (확정된 연결만 셉니다)'
            : '감지된 법령 변경이 없습니다.'}
        </p>
      )}

      {events.length > 0 && (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded">
          {events.map((ev) => {
            const open = expandable && openId === ev.id;
            return (
              <li key={ev.id} ref={ev.id === initialOpenId ? openRef : undefined} className="text-xs">
                <Row
                  ev={ev}
                  showLawName={!lawId}
                  expandable={expandable}
                  open={open}
                  onToggle={() => setOpenId(open ? null : ev.id)}
                />
                {open && (
                  <div className="px-3 pb-3 pt-1 bg-gray-50/50">
                    <LawImpactPanel eventId={ev.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Row({
  ev,
  showLawName,
  expandable,
  open,
  onToggle,
}: {
  ev: LawChangeListItem;
  showLawName: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const body = (
    <>
      <span className={clsx('px-1.5 py-0.5 rounded border text-[11px] shrink-0', CHANGE_TYPE_STYLE[ev.changeType])}>
        {CHANGE_TYPE_LABEL[ev.changeType]}
      </span>
      <span className="font-medium text-gray-800 shrink-0">
        {showLawName && <span className="text-gray-600">{ev.lawName} </span>}
        {ev.label}
      </span>
      <span className="text-gray-500 truncate">
        {lawVersionLabel(ev.version, t) && `${lawVersionLabel(ev.version, t)} · `}
        {ev.lawEffectiveDate ? `시행 ${ev.lawEffectiveDate}` : '시행일 미상'}
        {' · '}
        {RECEIVED_VIA_LABEL[ev.receivedVia] ?? ev.receivedVia} {new Date(ev.detectedAt).toLocaleDateString('ko-KR')}
      </span>
      {ev.effectiveNotes && (
        <span
          className="px-1.5 py-0.5 rounded text-[11px] bg-amber-50 text-amber-800 border border-amber-200 shrink-0"
          title={t(ev.effectiveNotes.notes.length ? 'effectiveNotes.badgeTitle' : 'effectiveNotes.badgeRemovedTitle', {
            dates: effectiveNotesDates(ev.effectiveNotes),
          })}
        >
          {t(ev.effectiveNotes.notes.length ? 'effectiveNotes.badge' : 'effectiveNotes.badgeRemoved')}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5 shrink-0">
        <span
          className={clsx(
            'px-1.5 py-0.5 rounded text-[11px]',
            ev.impact.confirmed > 0 ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-500',
          )}
          title="확정된 연결로 걸린 우리 회사 조문 수"
        >
          우리 조문 {ev.impact.confirmed}
        </span>
        {ev.impact.suggested > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[11px] bg-amber-50 text-amber-800 border border-amber-200" title="확정되지 않은 추천 연결 — 영향에 넣지 않았다">
            확인 필요 {ev.impact.suggested}
          </span>
        )}
        {expandable && <ChevronDown size={14} className={clsx('text-gray-400 transition-transform', open && 'rotate-180')} />}
      </span>
    </>
  );

  if (!expandable) {
    return (
      <Link to={`/laws/${ev.lawId}?change=${ev.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
        {body}
      </Link>
    );
  }
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
      {body}
    </button>
  );
}
