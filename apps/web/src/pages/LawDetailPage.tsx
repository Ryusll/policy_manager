/**
 * 법령 상세 (T-102). 조·항·호 트리 + 선택한 법령조항에 "영향받는 우리 조문".
 *
 * `byLawArticle` 조회가 이 화면의 핵심이다 — 법령조항 id로 시작해 **우리 테넌트가
 * 만든 연결만** 본다(`LawLink.tenantId`). 다른 회사가 이 법에 어떻게 대응해 뒀는지는
 * 여기 절대 나타나지 않는다(설계안 ⚠️ 테넌트 경계).
 */

import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { lawsApi, type LawInForceArticle } from '../api/laws';
import { InForceText, LawInForceHeader, ScheduledBadge } from '../components/LawInForce';
import { lawLinksApi, RELATION_TYPE_LABEL } from '../api/lawLinks';
import { ConfirmBadge } from '../components/LawLinksPanel';
import EvidenceSource from '../components/EvidenceSource';
import LawChangeList from '../components/LawChangeList';
import EffectiveNotesLine, { EffectiveNotesMark } from '../components/EffectiveNotesLine';
import { lawArticleEffectiveNotes } from '../lib/effectiveNotes';
import { useAuthStore } from '../stores/authStore';

export default function LawDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  // 법령 목록의 "최근 법령 변경"에서 들어오면 그 변경을 펼친 채로 연다
  const changeId = searchParams.get('change');

  const lawQuery = useQuery({ queryKey: ['laws', id], queryFn: () => lawsApi.get(id!), enabled: !!id });
  // 조항 본문은 마지막 반영 판(시행 전일 수 있다)의 것이라, 지금 시행 중인 문구와 시행 예정 변경을 가른 것을 쓴다(T-150)
  const articlesQuery = useQuery({
    queryKey: ['laws', id, 'in-force'],
    queryFn: () => lawsApi.inForce(id!),
    enabled: !!id,
  });

  const articles = articlesQuery.data?.articles || [];
  const selected = articles.find((a) => a.id === selectedId) || null;

  if (!id) return null;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-300 px-5 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => navigate('/laws')}
          className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={12} /> 법령 관리
        </button>
        <h1 className="text-base font-bold text-gray-800">{lawQuery.data?.lawName || '불러오는 중…'}</h1>
        {lawQuery.data && (
          <div className="flex items-start gap-2 flex-wrap">
            <LawInForceHeader
              law={lawQuery.data}
              inForce={articlesQuery.data}
              articleCount={articlesQuery.data ? articles.filter((a) => a.content !== null).length : lawQuery.data.articleCount}
            />
            {lawQuery.data.sourceUrl && (
              <a
                href={lawQuery.data.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 text-xs text-navy-700 hover:underline inline-flex items-center gap-0.5"
              >
                원문 <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
        {lawQuery.data?.lastCheckedAt && (
          <p className="text-[11px] text-gray-400 mt-1">
            마지막 개정 확인 {new Date(lawQuery.data.lastCheckedAt).toLocaleString('ko-KR')}
          </p>
        )}
        {lawQuery.data?.lastCheckError && (
          <p
            role="alert"
            className="mt-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2.5 py-1.5"
          >
            최근 개정 확인에 실패했습니다 — 지금 이 법령의 개정 여부를 알 수 없습니다.
            <span className="block text-red-700/80 mt-0.5">{lawQuery.data.lastCheckError}</span>
          </p>
        )}
      </div>

      {canEdit && (
        <div className="bg-white border border-gray-300 shadow-sm px-5 py-3 space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">개정 내역</h2>
            <p className="text-[11px] text-gray-500">
              이 법령에서 감지된 조문 변경입니다. 펼치면 변경 전후 문구와, 확정된 연결로 걸린 우리 회사 조문과
              그 기준 본문을 보여 줍니다.
            </p>
          </div>
          <LawChangeList lawId={id} affectedOnlyDefault={false} expandable initialOpenId={changeId} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 bg-white border border-gray-300 shadow-sm max-h-[70vh] overflow-y-auto">
          {articlesQuery.isLoading && <p className="text-sm text-gray-500 p-4">불러오는 중…</p>}
          <ul className="divide-y divide-gray-100">
            {articles.map((a) => (
              <ArticleRow key={a.id} article={a} selected={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
            ))}
          </ul>
        </div>

        <div className="lg:col-span-7">
          {!selected ? (
            <div className="bg-white border border-dashed border-gray-300 rounded p-10 text-center text-sm text-gray-500">
              왼쪽에서 조문을 선택하세요.
            </div>
          ) : (
            <SelectedArticlePanel article={selected} canEdit={canEdit} />
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleRow({ article, selected, onClick }: { article: LawInForceArticle; selected: boolean; onClick: () => void }) {
  // 항·호는 들여쓴다 — 조 본문(clauseNo·itemNo 모두 null) 기준
  const depth = article.itemNo != null ? 2 : article.clauseNo != null ? 1 : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-baseline gap-2',
          selected && 'bg-navy-50 hover:bg-navy-50',
        )}
        style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
      >
        <span className={clsx('font-medium shrink-0', selected ? 'text-navy-800' : article.content === null ? 'text-gray-400' : 'text-gray-700')}>
          {article.label}
        </span>
        {article.title && <span className="text-gray-500 truncate">{article.title}</span>}
        {depth === 0 && <EffectiveNotesMark notes={article.effectiveNotes} />}
        <ScheduledBadge scheduled={article.scheduled} />
      </button>
    </li>
  );
}

function SelectedArticlePanel({ article, canEdit }: { article: LawInForceArticle; canEdit: boolean }) {
  const queryClient = useQueryClient();

  const linksQuery = useQuery({
    queryKey: ['law-links', 'by-law-article', article.id],
    queryFn: () => lawLinksApi.byLawArticle(article.id),
    enabled: canEdit,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['law-links', 'by-law-article', article.id] });

  const updateMutation = useMutation({
    mutationFn: ({ linkId, confirmState }: { linkId: string; confirmState: 'confirmed' | 'rejected' }) =>
      lawLinksApi.update(linkId, { confirmState }),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (linkId: string) => lawLinksApi.remove(linkId),
    onSuccess: invalidate,
  });

  const links = linksQuery.data || [];

  return (
    <div className="bg-white border border-gray-300 shadow-sm">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-800">{article.label}</h2>
        {article.title && <p className="text-xs text-gray-500">{article.title}</p>}
      </div>
      <div className="p-4 border-b border-gray-200 bg-gray-50/60">
        <InForceText article={article} />
        <div className="mt-2 empty:hidden">
          <EffectiveNotesLine info={lawArticleEffectiveNotes(article)} />
        </div>
      </div>

      <div className="p-4">
        <h3 className="text-xs font-semibold text-gray-700 mb-2">
          영향받는 우리 조문{links.length > 0 && <span className="text-gray-400 font-normal"> ({links.length})</span>}
        </h3>

        {!canEdit && <p className="text-xs text-gray-500">admin·editor만 볼 수 있습니다.</p>}
        {canEdit && linksQuery.isLoading && <p className="text-xs text-gray-500">불러오는 중…</p>}
        {canEdit && !linksQuery.isLoading && links.length === 0 && (
          <p className="text-xs text-gray-500">
            연결된 사내 조문이 없습니다. 규정 상세의 &quot;걸린 법&quot; 패널에서 이 조문에 연결할 수 있습니다.
          </p>
        )}

        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="border border-gray-200 rounded px-3 py-2 bg-gray-50/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-gray-900">
                      {link.article?.title || '(제목 없음)'}
                    </span>
                    <ConfirmBadge state={link.confirmState} />
                    <span className="text-[10px] text-gray-500">{RELATION_TYPE_LABEL[link.relationType]}</span>
                  </div>
                  {link.evidenceText && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{link.evidenceText}</p>
                  )}
                  {link.evidenceText && <EvidenceSource source={link.evidenceVersion} target={link.articleCurrentVersion} />}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-gray-400 hover:text-red-600 shrink-0"
                  onClick={() => removeMutation.mutate(link.id)}
                >
                  삭제
                </button>
              </div>
              {link.confirmState === 'suggested' && (
                <div className="flex gap-2 mt-1.5">
                  <button
                    type="button"
                    className="text-[11px] text-green-700 hover:underline"
                    onClick={() => updateMutation.mutate({ linkId: link.id, confirmState: 'confirmed' })}
                  >
                    확정
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-gray-500 hover:underline"
                    onClick={() => updateMutation.mutate({ linkId: link.id, confirmState: 'rejected' })}
                  >
                    반려
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
