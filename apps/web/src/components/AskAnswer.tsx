import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Scale } from 'lucide-react';
import type { AskAnswerResult, AskBlock, AskCitation, AskLawCitation, AskResult, AskReviewRow, AskVerdict } from '../api/ask';
import { useI18n } from '../i18n/useI18n';
import { articleHash } from '../lib/articleAnchor';
import { renderInline } from '../lib/inlineBold';
import { formatArticleJo, formatClauseHang, formatItemMok } from '../lib/legalArticleLabel';

/**
 * T-207 규정 질문 답 — 검토 보고서 모양(SRS SEARCH-7). 서버가 고정된 순서로 보낸 블록을 그대로 그린다:
 * 직답(굵게) → 검토 표(검토 영역·관련 법령·기준·현재 규정 상태·판단·개정·보완 권고) → 우선 개정 권고 N건(또는 핵심 정리) →
 * 종합 의견 → 근거 요약. 맨 위에는 AI 가 읽은 조문을 펼쳐 볼 수 있고, 아래에는 DB 의 시행 중 본문(근거 조문)과
 * 확정 연결의 법령 근거(T-209)를 붙인다. 문장은 `**` 만 굵게로 바꾸고 HTML 로 바꾸지 않는다.
 */

/** 판단마다 색 — 부합 계열은 초록, 부분은 노랑, 보완은 빨강, 확인은 남색, 해당 없음은 회색 */
const VERDICT_STYLE: Record<AskVerdict, string> = {
  부합: 'badge-published',
  '대체로 부합': 'badge-published',
  '부분 부합': 'badge-review',
  '보완 필요': 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200',
  '추가 확인 필요': 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-navy-50 text-navy-700 border border-navy-200',
  '해당 없음': 'badge-archived',
};
const VERDICT_KEY: Record<AskVerdict, string> = {
  부합: 'match',
  '대체로 부합': 'mostly',
  '부분 부합': 'partial',
  '보완 필요': 'gap',
  '추가 확인 필요': 'check',
  '해당 없음': 'na',
};

function citationLabel(c: Pick<AskCitation, 'number' | 'branchNumber' | 'clauseNumber' | 'itemNumber'>): string {
  return [
    formatArticleJo(c.number, c.branchNumber),
    c.clauseNumber != null ? formatClauseHang(c.clauseNumber) : '',
    c.itemNumber != null ? formatItemMok(c.itemNumber) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function ReviewTable({ rows }: { rows: AskReviewRow[] }) {
  const { t } = useI18n();
  const cols = ['area', 'law', 'current', 'verdict', 'advice'] as const;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200" data-testid="ask-review">
      <table className="w-full min-w-[720px] text-[13px] leading-relaxed">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {t(`ask.answer.col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100 align-top">
              <td className="px-3 py-2.5 font-medium text-gray-900 w-[16%]">{r.area}</td>
              <td className="px-3 py-2.5 text-gray-700 w-[20%]">{r.law}</td>
              <td className="px-3 py-2.5 text-gray-700">{r.current}</td>
              <td className="px-3 py-2.5 whitespace-nowrap w-[1%]">
                <span className={VERDICT_STYLE[r.verdict] ?? 'badge-draft'}>{t(`ask.verdict.${VERDICT_KEY[r.verdict] ?? 'check'}`)}</span>
              </td>
              <td className="px-3 py-2.5 text-gray-700">{r.advice}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ block }: { block: AskBlock }) {
  const { t } = useI18n();
  if (block.type === 'paragraph') return <p className="whitespace-pre-wrap">{renderInline(block.text)}</p>;
  if (block.type === 'review') return <ReviewTable rows={block.rows} />;
  if (block.type === 'priorities') {
    return (
      <section className="space-y-2" data-testid="ask-priorities">
        <h3 className="text-[15px] font-semibold text-gray-900">
          {t(block.kind === 'amend' ? 'ask.answer.amend' : 'ask.answer.summary', { n: block.items.length })}
        </h3>
        <ol className="space-y-2.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 shrink-0 text-right font-semibold text-gray-900">{i + 1}.</span>
              <div>
                <p className="font-semibold text-gray-900">{item.title}</p>
                {item.detail && <p className="text-gray-700">{renderInline(item.detail)}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (block.type === 'list') {
    return (
      <ul className="list-disc pl-5 space-y-1">
        {block.items.map((item, j) => (
          <li key={j}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-[13px]">
        {block.headers.length > 0 && (
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {block.headers.map((h, j) => (
                <th key={j} className="px-3 py-2 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {block.rows.map((row, j) => (
            <tr key={j} className="border-t border-gray-100 align-top">
              {row.map((cell, k) => (
                <td key={k} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reviewed({ consulted }: { consulted: AskResult['consulted'] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!consulted.length) return null;
  return (
    <div className="text-xs text-gray-600">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 hover:text-gray-900"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <CheckCircle2 size={14} className="text-emerald-600" />
        {t('ask.answer.reviewed', { n: consulted.length })}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <ul className="mt-1.5 ml-5 space-y-0.5">
          {consulted.map((c) => (
            <li key={`${c.policyId}-${c.number}-${c.branchNumber ?? 0}`}>
              <Link to={`/policies/${c.policyId}${articleHash(c)}`} className="hover:underline">
                {c.policyTitle} · {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Citations({ citations }: { citations: AskCitation[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2" data-testid="ask-citations">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
          <BookOpen size={13} /> {t('ask.answer.citations', { n: citations.length })}
        </p>
        <button type="button" className="text-[11px] text-navy-700 hover:underline" onClick={() => setOpen((v) => !v)}>
          {t(open ? 'ask.answer.hideText' : 'ask.answer.showText')}
        </button>
      </div>
      <div className={open ? 'space-y-2' : 'flex flex-wrap gap-1.5'}>
        {citations.map((c) => (
          <div key={c.ref} className={open ? 'rounded border border-gray-200 bg-gray-50 px-3 py-2' : ''}>
            <Link
              to={`/policies/${c.policyId}${articleHash(c)}`}
              className={`text-xs font-medium text-navy-700 hover:underline inline-flex items-center gap-1 ${
                open ? '' : 'rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1'
              }`}
            >
              {c.policyTitle} · {citationLabel(c)}
              {c.joTitle ? `(${c.joTitle})` : ''}
              <ExternalLink size={11} />
            </Link>
            {open && c.content.trim() && <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">{c.content}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 법령 근거 칩 — 법령 화면은 열람자가 들어갈 수 없어(라우트 맵) 열람자에게는 바로가기 없이 글만 보인다 */
function LawCitations({ laws, canOpenLaws }: { laws: AskLawCitation[]; canOpenLaws: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!laws.length) return null;
  const chip = 'text-xs font-medium inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1';
  return (
    <div className="space-y-1.5" data-testid="ask-law-citations">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
          <Scale size={13} /> {t('ask.answer.laws', { n: laws.length })}
        </p>
        <button type="button" className="text-[11px] text-navy-700 hover:underline" onClick={() => setOpen((v) => !v)}>
          {t(open ? 'ask.answer.hideText' : 'ask.answer.showText')}
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          {laws.map((l) => (
            <div key={l.ref} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-medium text-gray-800">
                {l.lawName} {l.label}
                {l.title ? `(${l.title})` : ''}
              </p>
              <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">{l.content}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {laws.map((l) => {
          const body = (
            <>
              {l.lawName} {l.label}
              {l.title ? `(${l.title})` : ''}
              {l.scheduledOn && <span className="text-amber-700">· {t('ask.answer.lawScheduled', { date: l.scheduledOn })}</span>}
            </>
          );
          return canOpenLaws ? (
            <Link key={l.ref} to={`/laws/${l.lawId}`} title={l.content} className={`${chip} text-navy-700 hover:underline`}>
              {body}
              <ExternalLink size={11} />
            </Link>
          ) : (
            <span key={l.ref} title={l.content} className={`${chip} text-gray-700`}>
              {body}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 답할 수 있었던 결과의 본문 — 검토 보고서 모양. `canOpenLaws` — 법령 화면에 들어갈 수 있는 역할(관리자·편집자) */
export function AskAnswer({ result, canOpenLaws = false }: { result: AskAnswerResult; canOpenLaws?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4" data-testid="ask-answer">
      <Reviewed consulted={result.consulted} />
      <div className="space-y-4 text-sm leading-relaxed text-gray-800">
        {result.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
      <p className="text-[11px] text-gray-500">{t('ask.answer.opinion')}</p>
      {result.citations.length > 0 && <Citations citations={result.citations} />}
      <LawCitations laws={result.lawCitations ?? []} canOpenLaws={canOpenLaws} />
    </div>
  );
}
