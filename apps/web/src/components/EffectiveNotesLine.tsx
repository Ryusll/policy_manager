import { useI18n } from '../i18n/useI18n';
import { describeEffectiveNote, type EffectiveNote, type EventEffectiveNotes } from '../lib/effectiveNotes';

/**
 * 이 개정의 조에 붙은 별도 시행일 표기(T-144). 영향 분석·개정 후보의 시행일은 법령(판) 시행일 그대로라 — 조의 일부가 다른 날
 * 시행되는 경우를 놓치지 않게 알려 주는 안내다. 이번 개정으로 표기가 바뀌거나 없어졌으면 변경 전 표기도 보인다. 없으면 아무것도 그리지 않는다.
 */
export default function EffectiveNotesLine({ info }: { info: EventEffectiveNotes | null | undefined }) {
  const { t } = useI18n();
  if (!info || (!info.notes.length && !info.previous?.length)) return null;
  return <NotesBox info={info} head={headKey(info)} t={t} />;
}

/** 머리 문구 — 조항이 사라졌는지, 표기가 없어졌는지, 항·호(상위 조의 표기)인지에 따라 */
function headKey(info: EventEffectiveNotes): string {
  const who = info.inherited ? 'Inherited' : '';
  if (info.articleGone) return `effectiveNotes.headGone${who}`;
  if (!info.notes.length) return `effectiveNotes.headRemoved${who}`;
  return info.inherited ? 'effectiveNotes.headInherited' : 'effectiveNotes.headArticle';
}

function NotesBox({ info, head, t }: { info: EventEffectiveNotes; head: string; t: (key: string) => string }) {
  return (
    <div
      className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
      data-testid="effective-notes"
    >
      <div className="font-medium">{t(head)}</div>
      <NoteList notes={info.notes} />
      {!!info.previous?.length && (
        <div className="mt-1 text-amber-800" data-testid="effective-notes-previous">
          {t('effectiveNotes.previous')}
          <NoteList notes={info.previous} />
        </div>
      )}
      <p className="mt-1 text-[11px] text-amber-800">{t('effectiveNotes.planNote')}</p>
    </div>
  );
}

function NoteList({ notes }: { notes: EffectiveNote[] }) {
  const { t } = useI18n();
  if (!notes.length) return null;
  return (
    <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
      {notes.map((n, i) => (
        <li key={`${n.date}-${i}`}>{describeEffectiveNote(n, t)}</li>
      ))}
    </ul>
  );
}

/** 법령 조항 목록의 짧은 표시 — 조 행에 표기가 있을 때만 */
export function EffectiveNotesMark({ notes }: { notes: EffectiveNote[] | null | undefined }) {
  const { t } = useI18n();
  if (!notes?.length) return null;
  const dates = [...new Set(notes.map((n) => n.date))].join(', ');
  return (
    <span
      className="px-1 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200 shrink-0"
      title={t('effectiveNotes.badgeTitleArticle', { dates })}
      data-testid="effective-notes-mark"
    >
      {t('effectiveNotes.badge')}
    </span>
  );
}
