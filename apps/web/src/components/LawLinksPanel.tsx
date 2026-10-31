/**
 * 이 조문에 걸린 법령 — 법령 관계 정보(T-101) 조회·확정·반려·삭제 + 자동 추천.
 *
 * `LawLinksController`는 admin·editor 전용이라(개정 후보 생성의 입력이 되는 데이터라
 * 편집 권한자만 다룬다), viewer에게는 아예 렌더링하지 않는다 — 호출하면 403만 볼 뿐이다.
 * `canEdit` 판단은 호출 쪽(PolicyDetailPage)과 같은 기준(admin·editor)을 그대로 받는다.
 *
 * `Article.relatedLawNote`(자유 텍스트 메모)를 대체하지 않는다 — 그 메모는 그대로 남고,
 * 이 패널은 기계가 따라갈 수 있는 구조화된 연결을 별도로 쌓는다(설계안 참고).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { lawLinksApi, RELATION_TYPE_LABEL, type LawRelationType } from '../api/lawLinks';
import { lawsApi } from '../api/laws';
import EvidenceSource from './EvidenceSource';

/** `LawDetailPage`(법령 상세, "영향받는 우리 조문")에서도 같은 배지를 쓴다 */
export function ConfirmBadge({ state }: { state: 'suggested' | 'confirmed' | 'rejected' }) {
  const style =
    state === 'confirmed'
      ? 'bg-green-50 text-green-700 border-green-300'
      : state === 'rejected'
        ? 'bg-gray-100 text-gray-500 border-gray-300'
        : 'bg-amber-50 text-amber-700 border-amber-300';
  const label = state === 'confirmed' ? '확정' : state === 'rejected' ? '반려' : '자동 추천';
  return (
    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0', style)}>{label}</span>
  );
}

export function LawLinksPanel({
  articleId,
  currentVersionId,
  canEdit,
}: {
  articleId: string;
  /** 조문의 오늘 시행 버전 — 버전을 처리해 바뀌면 목록을 다시 받는다(T-177 — "지금 버전"·근거 문구 알림이 그 버전 기준이다) */
  currentVersionId: string | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState('');

  const linksKey = ['law-links', 'by-article', articleId, currentVersionId];
  const linksQuery = useQuery({
    queryKey: linksKey,
    queryFn: () => lawLinksApi.byArticle(articleId),
    enabled: canEdit,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: linksKey });

  const updateMutation = useMutation({
    mutationFn: ({ id, confirmState }: { id: string; confirmState: 'confirmed' | 'rejected' }) =>
      lawLinksApi.update(id, { confirmState }),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => lawLinksApi.remove(id),
    onSuccess: invalidate,
  });
  const suggestMutation = useMutation({
    mutationFn: () => lawLinksApi.suggest(articleId),
    onSuccess: (result) => {
      void invalidate();
      setError('');
      if (result.created.length === 0) {
        setError(
          result.scanned > 0
            ? '본문에서 법령 인용을 찾았지만, 등록된 법령 중 일치하는 조문이 없습니다. 먼저 법령을 등록하세요.'
            : '본문에서 법령 인용 패턴(「OO법」 제N조 등)을 찾지 못했습니다.',
        );
      }
    },
  });

  if (!canEdit) return null;

  const links = linksQuery.data || [];

  return (
    <div className="space-y-2 border border-gray-200 rounded-md bg-white p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-700">
          걸린 법{links.length > 0 && <span className="text-gray-400 font-normal"> ({links.length})</span>}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-[11px] text-navy-700 hover:underline inline-flex items-center gap-0.5 disabled:opacity-50"
            disabled={suggestMutation.isPending}
            onClick={() => suggestMutation.mutate()}
            title="본문에서 「OO법」 제N조 같은 인용을 찾아 추천합니다"
          >
            {suggestMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            자동 찾기
          </button>
          <button
            type="button"
            className="text-[11px] text-navy-700 hover:underline inline-flex items-center gap-0.5"
            onClick={() => setShowAddForm((v) => !v)}
          >
            {showAddForm ? <X size={11} /> : <Plus size={11} />}
            {showAddForm ? '닫기' : '추가'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">{error}</p>
      )}

      {linksQuery.isLoading && <p className="text-[11px] text-gray-400">불러오는 중…</p>}
      {!linksQuery.isLoading && links.length === 0 && !showAddForm && (
        <p className="text-[11px] text-gray-500">연결된 법령이 없습니다.</p>
      )}

      <ul className="space-y-1.5">
        {links.map((link) => (
          <li key={link.id} className="border border-gray-200 rounded px-2 py-1.5 bg-gray-50/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-medium text-gray-900 truncate">
                    {link.lawArticle?.law.lawName} {link.lawArticle?.label}
                  </span>
                  <ConfirmBadge state={link.confirmState} />
                  {link.lawArticle?.deletedAt && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 bg-gray-100 text-gray-600 border-gray-300"
                      title="법령 개정으로 이 조항이 법령에서 사라졌습니다. 연결은 남겨 두었으니 사내 조문을 정리할지 확인하세요."
                    >
                      법령에서 삭제됨
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500">{RELATION_TYPE_LABEL[link.relationType]}</span>
                </div>
                {link.evidenceText && (
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate" title={link.evidenceText}>
                    {link.evidenceText}
                  </p>
                )}
                {link.evidenceText && <EvidenceSource source={link.evidenceVersion} target={link.articleCurrentVersion} />}
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-red-600 shrink-0"
                title="연결 삭제"
                onClick={() => removeMutation.mutate(link.id)}
                disabled={removeMutation.isPending}
              >
                <Trash2 size={12} />
              </button>
            </div>
            {link.confirmState === 'suggested' && (
              <div className="flex gap-2 mt-1.5">
                <button
                  type="button"
                  className="text-[10px] text-green-700 hover:underline"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: link.id, confirmState: 'confirmed' })}
                >
                  확정
                </button>
                <button
                  type="button"
                  className="text-[10px] text-gray-500 hover:underline"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: link.id, confirmState: 'rejected' })}
                >
                  반려
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {showAddForm && (
        <AddLinkForm
          articleId={articleId}
          existingLawArticleIds={links.map((l) => l.lawArticleId)}
          onDone={() => {
            void invalidate();
            setShowAddForm(false);
          }}
        />
      )}
    </div>
  );
}

function AddLinkForm({
  articleId,
  existingLawArticleIds,
  onDone,
}: {
  articleId: string;
  existingLawArticleIds: string[];
  onDone: () => void;
}) {
  const [lawId, setLawId] = useState('');
  const [filter, setFilter] = useState('');
  const [lawArticleId, setLawArticleId] = useState('');
  const [relationType, setRelationType] = useState<LawRelationType>('citation');
  const [evidenceText, setEvidenceText] = useState('');
  const [formError, setFormError] = useState('');

  const lawsQuery = useQuery({ queryKey: ['laws', 'list'], queryFn: lawsApi.list });
  const articlesQuery = useQuery({
    queryKey: ['laws', lawId, 'articles'],
    queryFn: () => lawsApi.articles(lawId),
    enabled: !!lawId,
  });

  const filteredArticles = useMemo(() => {
    const rows = articlesQuery.data || [];
    const q = filter.trim();
    if (!q) return rows.slice(0, 200);
    return rows.filter((a) => a.label.includes(q) || (a.title || '').includes(q) || a.content.includes(q)).slice(0, 200);
  }, [articlesQuery.data, filter]);

  const createMutation = useMutation({
    mutationFn: () =>
      lawLinksApi.create({
        lawArticleId,
        articleId,
        relationType,
        evidenceText: evidenceText.trim() || undefined,
      }),
    onSuccess: onDone,
    onError: (err: any) => {
      setFormError(err?.response?.data?.message?.toString() || '연결을 만들지 못했습니다.');
    },
  });

  const laws = lawsQuery.data || [];

  return (
    <div className="border border-navy-200 rounded p-2 space-y-2 bg-slate-50/60">
      {laws.length === 0 && !lawsQuery.isLoading && (
        <p className="text-[11px] text-gray-600">
          등록된 법령이 없습니다.{' '}
          <a href="/laws" className="text-navy-700 underline">
            법령 관리
          </a>
          에서 먼저 등록하세요.
        </p>
      )}
      <select
        className="input text-[11px] w-full"
        value={lawId}
        onChange={(e) => {
          setLawId(e.target.value);
          setLawArticleId('');
          setFilter('');
        }}
      >
        <option value="">법령 선택…</option>
        {laws.map((law) => (
          <option key={law.id} value={law.id}>
            {law.lawName}
          </option>
        ))}
      </select>

      {lawId && (
        <>
          <input
            className="input text-[11px] w-full"
            placeholder="조문 검색 (예: 60 또는 연차휴가)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="input text-[11px] w-full"
            size={Math.min(6, Math.max(3, filteredArticles.length))}
            value={lawArticleId}
            onChange={(e) => setLawArticleId(e.target.value)}
          >
            {filteredArticles.map((a) => (
              <option key={a.id} value={a.id} disabled={existingLawArticleIds.includes(a.id)}>
                {a.label}
                {a.title ? ` (${a.title})` : ''}
                {existingLawArticleIds.includes(a.id) ? ' — 이미 연결됨' : ''}
              </option>
            ))}
          </select>
        </>
      )}

      <select
        className="input text-[11px] w-full"
        value={relationType}
        onChange={(e) => setRelationType(e.target.value as LawRelationType)}
      >
        {Object.entries(RELATION_TYPE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <textarea
        className="input text-[11px] w-full resize-y min-h-[48px]"
        placeholder="근거 문구 (선택) — 본문에서 이 연결을 뒷받침하는 문장"
        value={evidenceText}
        onChange={(e) => setEvidenceText(e.target.value)}
      />

      {formError && <p className="text-[11px] text-red-700">{formError}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary text-[11px] py-1.5"
          disabled={!lawArticleId || createMutation.isPending}
          onClick={() => {
            setFormError('');
            createMutation.mutate();
          }}
        >
          {createMutation.isPending ? '추가 중…' : '연결 추가'}
        </button>
      </div>
    </div>
  );
}
