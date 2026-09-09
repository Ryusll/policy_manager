import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { policiesApi, versionsApi, filesApi, commentsApi, searchApi } from '../api/policies';
import { templatesApi } from '../api/templates';
import {
  ChevronLeft,
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Clock,
  CheckCircle,
  Upload,
  Paperclip,
  Search,
  X,
  PanelLeftClose,
  PanelLeft,
  Download,
  History,
  Share2,
  BookOpen,
  Layers,
  Link2 as LinkIcon,
  ArrowUpDown,
  Undo2,
  Archive,
  Trash2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '../stores/authStore';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { EmptyState } from '../components/ui/EmptyState';
import TemplateRenderer from '../components/policy-template/TemplateRenderer';
import { buildTemplateTokenData } from '../components/policy-template/templateTokens';
import { buildEnterprisePolicyBodyHtml } from '../components/policy-template/templateUtils';
import RevisionReasonsModal from '../components/RevisionReasonsModal';
import ComparisonTableModal from '../components/ComparisonTableModal';
import { canManagePolicyTemplates } from '../lib/planFeatures';
import ArticleReorderPanel from '../components/ArticleReorderPanel';
import { escapeRegExp } from '../lib/searchRegex';
import { highlightText } from '../lib/highlightSearch';
import PlanModal from '../components/PlanModal';
import { ArticleBodyInline } from '../components/ArticleBodyInline';
import {
  articleShortLabel,
  countDistinctJo,
  formatArticleJo,
  formatClauseHang,
  flattenJoGroup,
  groupArticlesByJo,
  isArticleJoRoot,
  isChapterHeaderHidden,
  formatKoDate,
  sortArticlesForToc,
} from '../lib/legalArticleLabel';
import { buildPolicyPlainText, policyPlainTextFilename } from '../lib/policyPlainText';
import {
  buildFullViewGroups,
  collectJoNumbers,
  filterFullViewGroupsByJo,
} from '../lib/fullViewGroups';
import {
  buildArticleCreateRequests,
  canSubmitNewArticleForm,
  chapterHasJoRoot,
  inferJoTitle,
  nextClauseNumberForJo,
  nextJoNumberForPolicy,
  segmentArticleHeading,
  titleFieldHint,
  titleFieldLabel,
} from '../lib/articleStructure';
import { parseRevisionNotify } from '../lib/policyRevisionNotify';
import { notificationGroupsApi } from '../api/notificationGroups';
import { usersApi } from '../api/users';
import { toast } from '../stores/toastStore';
import { ThreeWayComparePanel } from '../components/ThreeWayComparePanel';
import { FavoriteButton } from '../components/FavoriteButton';
import { SpeechControls } from '../components/SpeechControls';
import { buildPolicySpeech } from '../lib/speech';
import {
  articleHash,
  findByAnchor,
  formatArticleAnchor,
  parseArticleAnchor,
  parseLegacyArticleId,
} from '../lib/articleAnchor';

const statusLabel: Record<string, string> = {
  draft: '초안',
  review: '검토중',
  published: '시행중',
  archived: '폐지',
};

const statusClass: Record<string, string> = {
  draft: 'badge-draft',
  review: 'badge-review',
  published: 'badge-published',
  archived: 'badge-archived',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${statusClass[status] || 'badge-draft'} inline-flex whitespace-nowrap`}>
      {statusLabel[status] || status}
    </span>
  );
}

function toKoreanOrdinal(n: number) {
  return `제${n}`;
}

function policyDateInputValue(d: string | Date | null | undefined): string {
  if (!d) return '';
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10);
}

const sortArticlesToc = sortArticlesForToc;

function filterArticleJoGroups(articles: any[], query: string) {
  const groups = groupArticlesByJo(articles);
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const matches = (article: any) => {
    const target = `${articleShortLabel(article)} ${article.title} ${article.versions?.[0]?.content || ''}`.toLowerCase();
    return target.includes(q);
  };
  return groups
    .map((g) => ({
      ...g,
      hangs: g.hangs
        .map((h) => ({
          ...h,
          items: h.items.filter(matches),
        }))
        .filter((h) => (h.hang && matches(h.hang)) || h.items.length > 0),
      orphanItems: g.orphanItems.filter(matches),
    }))
    .filter(
      (g) =>
        (g.main && matches(g.main)) ||
        g.hangs.length > 0 ||
        g.orphanItems.length > 0,
    );
}

type RecommendedAction = { label: string; href: string; external: boolean };

function RelatedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded bg-green-100 border border-green-300 text-green-700 text-[11px] px-1.5 py-0.5 font-semibold">
      {label}
    </span>
  );
}

function articlePublishedSnapshot(article: any) {
  return article?.versions?.[0] ?? null;
}

/** 최초 게시(v1) 이후 시행·개정 승인으로 게시본이 바뀐 적이 있음 */
function articleHasPublicationRevision(article: any) {
  const v = articlePublishedSnapshot(article);
  return v && Number(v.versionNum ?? 0) >= 2;
}

function revisionBadgeTitle(article: any): string {
  const v = articlePublishedSnapshot(article);
  if (!v) return '';
  const vn = Number(v.versionNum ?? 0);
  const parts: string[] = [];
  if (v.approvedAt) {
    parts.push(`마지막 시행·개정 승인: ${new Date(v.approvedAt).toLocaleString('ko-KR')}`);
  } else if (v.updatedAt) {
    parts.push(`게시본 갱신: ${new Date(v.updatedAt).toLocaleString('ko-KR')}`);
  }
  parts.push(`현재 게시 버전: v${vn}`);
  return parts.join(' · ');
}

function RevisionBadge({ article }: { article: any }) {
  if (!articleHasPublicationRevision(article)) return null;
  return (
    <span
      title={revisionBadgeTitle(article)}
      className="inline-flex items-center justify-center cursor-default rounded bg-sky-100 border border-sky-400 text-sky-900 text-[11px] px-1.5 py-0.5 font-semibold"
    >
      개
    </span>
  );
}

/** 목차: 장 > 조 > 항·목 들여쓰기 */
function TocArticleButton({
  article,
  plClass,
  selectedArticle,
  onSelect,
  joTitle,
}: {
  article: any;
  plClass: string;
  selectedArticle: any;
  onSelect: (article: any) => void;
  joTitle?: string;
}) {
  const hangTitleIsJoTitle =
    joTitle &&
    article.clauseNumber != null &&
    article.itemNumber == null &&
    Number(article.clauseNumber) === 1 &&
    String(article.title ?? '').trim() === joTitle;
  const label = isArticleJoRoot(article)
    ? `${formatArticleJo(article.number)} ${article.title || ''}`.trim()
    : hangTitleIsJoTitle
      ? articleShortLabel(article)
      : `${articleShortLabel(article)} ${article.title || ''}`.trim();
  return (
    <button
      type="button"
      onClick={() => onSelect(article)}
      className={clsx(
        'w-full flex items-center gap-2 pr-4 py-2 text-left transition-colors text-sm',
        plClass,
        selectedArticle?.id === article.id
          ? 'bg-navy-50 border-l-2 border-navy-600 text-navy-800 font-medium'
          : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      <FileText size={12} className="text-gray-400 flex-shrink-0" />
      <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" title="의견 있음" />
      <span className="flex-1 truncate">
        <span className={clsx('whitespace-nowrap', isArticleJoRoot(article) && 'font-medium')}>{label}</span>
      </span>
      <span className="inline-flex items-center gap-1 shrink-0">
        {article.hasPrecedent && <RelatedBadge label="판" />}
        {article.hasRelatedLaw && <RelatedBadge label="법" />}
        {article.hasRelatedRule && <RelatedBadge label="규" />}
        <RevisionBadge article={article} />
      </span>
      {article.versions?.[0] && <StatusBadge status={article.versions[0].status} />}
    </button>
  );
}

function TocArticleGroups({
  articles,
  query,
  plJo,
  plHang,
  plItem,
  selectedArticle,
  onSelect,
  canEdit,
  onAddHang,
  selectMode,
  printSelection,
  onToggleJo,
}: {
  selectMode?: boolean;
  printSelection?: Set<number>;
  onToggleJo?: (jo: number) => void;
  articles: any[];
  query: string;
  plJo: string;
  plHang: string;
  plItem: string;
  selectedArticle: any;
  onSelect: (article: any) => void;
  canEdit?: boolean;
  onAddHang?: (jo: number) => void;
}) {
  const groups = filterArticleJoGroups(articles, query);
  return (
    <>
      {groups.map((group) => {
        const joTitle = inferJoTitle(articles, group.jo);
        return (
        <div key={`jo-${group.jo}`} className="border-b border-gray-100/80 last:border-b-0">
          {selectMode && onToggleJo && (
            <label className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={printSelection?.has(group.jo) ?? false}
                onChange={() => onToggleJo(group.jo)}
              />
              인쇄에 포함
            </label>
          )}
          {group.main ? (
            <TocArticleButton
              article={group.main}
              plClass={plJo}
              selectedArticle={selectedArticle}
              onSelect={onSelect}
              joTitle={joTitle}
            />
          ) : (
            <div className={clsx(plJo, 'pr-4 py-2 text-sm font-semibold text-gray-800')}>
              {formatArticleJo(group.jo)}
              {joTitle ? ` ${joTitle}` : ''}
            </div>
          )}
          {group.hangs.map((hang) => (
            <div key={`jo-${group.jo}-h-${hang.clauseNumber}`}>
              {hang.hang ? (
                <TocArticleButton
                  article={hang.hang}
                  plClass={plHang}
                  selectedArticle={selectedArticle}
                  onSelect={onSelect}
                  joTitle={joTitle}
                />
              ) : (
                <div className={clsx(plHang, 'pr-4 py-1.5 text-sm text-gray-600')}>
                  {formatClauseHang(hang.clauseNumber)}
                </div>
              )}
              {hang.items.map((article: any) => (
                <TocArticleButton
                  key={article.id}
                  article={article}
                  plClass={plItem}
                  selectedArticle={selectedArticle}
                  onSelect={onSelect}
                  joTitle={joTitle}
                />
              ))}
            </div>
          ))}
          {group.orphanItems.map((article: any) => (
            <TocArticleButton
              key={article.id}
              article={article}
              plClass={plHang}
              selectedArticle={selectedArticle}
              onSelect={onSelect}
              joTitle={joTitle}
            />
          ))}
          {canEdit && onAddHang && (
            <button
              type="button"
              onClick={() => onAddHang(group.jo)}
              className={clsx(
                plHang,
                'w-full flex items-center gap-1 pr-4 py-1.5 text-[11px] text-gray-400 hover:text-navy-700 hover:bg-gray-50',
              )}
            >
              <Plus size={11} /> {formatArticleJo(group.jo)} 항 추가
            </button>
          )}
        </div>
        );
      })}
    </>
  );
}

type AppendixKind = 'supplementary' | 'annex' | 'form';

const appendixKindLabel: Record<AppendixKind, string> = {
  supplementary: '부칙',
  annex: '별표',
  form: '서식',
};

const INTERNAL_REVISION_REASONS = ['감사 지적사항 반영', '조직개편/직무변경', '내부 운영절차 개선', '리스크 통제 강화'] as const;
const EXTERNAL_REVISION_REASONS = ['법령/고시 개정 반영', '감독기관 가이드 반영', '대외 계약/요구사항 변경'] as const;

const AUTO_REF_START = '<<<POLICY_MGR_REF_BLOCK>>>';
const AUTO_REF_END = '<<<END_POLICY_MGR_REF_BLOCK>>>';

function revisionRefLabel(type: 'precedent' | 'law' | 'rule') {
  return type === 'precedent' ? '판' : type === 'law' ? '법' : '규';
}

function stripAutoRefBlock(text: string) {
  const s = String(text ?? '');
  const a = s.indexOf(AUTO_REF_START);
  const b = s.indexOf(AUTO_REF_END);
  if (a === -1 || b === -1 || b < a) return s.trimEnd();
  const before = s.slice(0, a).trimEnd();
  const after = s.slice(b + AUTO_REF_END.length).trimStart();
  if (!before) return after;
  if (!after) return before;
  return `${before}\n\n${after}`.trimEnd();
}

function FullViewSearchToolbar({
  inputId,
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onScrollFirst,
  onPrev,
  onNext,
}: {
  inputId: string;
  query: string;
  onQueryChange: (v: string) => void;
  matchCount: number;
  activeIndex: number;
  onScrollFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const hasQ = query.trim().length > 0;
  return (
    <div className="px-4 py-2 border-b border-gray-200 bg-amber-50/50 flex flex-wrap items-center gap-2 print:hidden">
      <label className="sr-only" htmlFor={inputId}>
        전문 보기 화면 내 검색
      </label>
      <div className="relative flex-1 min-w-[180px] max-w-md">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          id={inputId}
          className="input pl-8 text-sm"
          placeholder="제목·조문 본문 검색 (전문 보기)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      {hasQ ? (
        <span className="text-xs text-gray-600 whitespace-nowrap">
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : '0건 일치'}
        </span>
      ) : null}
      <button
        type="button"
        className="btn-secondary text-xs py-1 px-2"
        onClick={onPrev}
        disabled={!hasQ || matchCount === 0}
      >
        이전
      </button>
      <button
        type="button"
        className="btn-secondary text-xs py-1 px-2"
        onClick={onNext}
        disabled={!hasQ || matchCount === 0}
      >
        다음
      </button>
      <button
        type="button"
        className="btn-secondary text-xs py-1 px-2"
        onClick={onScrollFirst}
        disabled={!hasQ}
      >
        첫 일치로 이동
      </button>
      {hasQ ? (
        <button
          type="button"
          className="text-xs text-gray-500 hover:text-gray-800 underline"
          onClick={() => onQueryChange('')}
        >
          지우기
        </button>
      ) : null}
    </div>
  );
}

export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [selectedArticle, setSelectedArticle] = useState<any>(null);
  const [newChapter, setNewChapter] = useState({ number: 1, title: '' });
  const [newArticle, setNewArticle] = useState<{
    chapterId: string;
    /** 소속 절(선택 계층). 절 없이 장 직속이면 undefined */
    sectionId?: string;
    number: number;
    clauseNumber?: number;
    itemNumber?: number;
    title: string;
    content: string;
    hasPrecedent: boolean;
    hasRelatedLaw: boolean;
    hasRelatedRule: boolean;
    relatedPrecedentNote: string;
    relatedLawNote: string;
    relatedRuleNote: string;
  } | null>(null);
  const [showAddChapter, setShowAddChapter] = useState(false);
  const [newSection, setNewSection] = useState<
    { chapterId: string; number: number; title: string } | null
  >(null);
  const [versionContent, setVersionContent] = useState('');
  const [versionChangeNote, setVersionChangeNote] = useState('');
  const [revisionInternalReasons, setRevisionInternalReasons] = useState<string[]>([]);
  const [revisionExternalReasons, setRevisionExternalReasons] = useState<string[]>([]);
  const [showVersionEditor, setShowVersionEditor] = useState(false);
  const [editingDraftVersionId, setEditingDraftVersionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullViewMainRef = useRef<HTMLDivElement>(null);
  const fullViewModalRef = useRef<HTMLDivElement>(null);
  // 업로드·삭제가 같은 모달에서 같은 자리에 오류를 띄운다
  const [fileError, setFileError] = useState('');
  const [showAttachmentsModal, setShowAttachmentsModal] = useState(false);
  const [showFullTextModal, setShowFullTextModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [approveTargetId, setApproveTargetId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<any>(null);
  const [versionActionMsg, setVersionActionMsg] = useState('');
  const [activeToggleTarget, setActiveToggleTarget] = useState<boolean | null>(null);
  const [approveNote, setApproveNote] = useState('');
  /** 시행 승인 시 확정할 시행일(YYYY-MM-DD). 비우면 서버가 승인일로 기록 */
  const [approveEffectiveDate, setApproveEffectiveDate] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [tocQuery, setTocQuery] = useState('');
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState('');
  const [fullViewSearchQuery, setFullViewSearchQuery] = useState('');
  const [fullViewActiveMatchIndex, setFullViewActiveMatchIndex] = useState(0);
  const [tocOpen, setTocOpen] = useState(true);
  const [tocPinnedMode, setTocPinnedMode] = useState(false);
  const [leftSidebarTab, setLeftSidebarTab] = useState<'toc' | 'history' | 'appendices'>('toc');
  const [selectedAppendixId, setSelectedAppendixId] = useState<string | null>(null);
  const [appendixModal, setAppendixModal] = useState<null | { mode: 'create' } | { mode: 'edit'; id: string }>(null);
  const [appendixDraft, setAppendixDraft] = useState<{
    kind: AppendixKind;
    title: string;
    body: string;
    sortOrder: string;
  }>({ kind: 'supplementary', title: '', body: '', sortOrder: '' });
  const [lawToolMsg, setLawToolMsg] = useState('');
  const [articleViewMode, setArticleViewMode] = useState<'full' | 'segment'>('full');
  /** 시점 조회 기준일(YYYY-MM-DD). 빈 문자열이면 현행 본문 */
  const [asOfDate, setAsOfDate] = useState('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingHwpx, setIsExportingHwpx] = useState(false);
  const [showRevisionReasons, setShowRevisionReasons] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showThreeWay, setShowThreeWay] = useState(false);
  const [showA11y, setShowA11y] = useState(false);
  /** 선택 조문 인쇄 (T-74). 비어 있으면 전체를 뜻한다. */
  const [printSelection, setPrintSelection] = useState<Set<number>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [relationNotesDraft, setRelationNotesDraft] = useState({
    relatedPrecedentNote: '',
    relatedLawNote: '',
    relatedRuleNote: '',
  });
  const [articleMetaDraft, setArticleMetaDraft] = useState({
    number: 1,
    clauseNumber: '' as string | number,
    itemNumber: '' as string | number,
    title: '',
  });
  const [compareV1, setCompareV1] = useState('');
  const [compareV2, setCompareV2] = useState('');
  const [relatedType, setRelatedType] = useState<'precedent' | 'law' | 'rule'>('precedent');
  const [relatedSort, setRelatedSort] = useState<'relevance' | 'latest'>('relevance');
  const [relatedScope, setRelatedScope] = useState<'title' | 'fulltext'>('fulltext');
  const [relatedCustomQuery, setRelatedCustomQuery] = useState('');
  const [diffViewMode, setDiffViewMode] = useState<'line' | 'word'>('line');
  const [relatedDetailIndex, setRelatedDetailIndex] = useState<number | null>(null);
  const [expandedPreviewMap, setExpandedPreviewMap] = useState<Record<string, boolean>>({});
  const [pinnedItems, setPinnedItems] = useState<
    Array<{ type: 'precedent' | 'law' | 'rule'; title: string; snippet: string; url?: string }>
  >([]);
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  const canUseSegmentMode = canEdit;
  const canUseTemplateFeature = canManagePolicyTemplates(user?.plan);

  useEffect(() => {
    if (!canUseSegmentMode) setArticleViewMode('full');
  }, [canUseSegmentMode]);

  useEffect(() => {
    if (!id) return;
    try {
      const v = sessionStorage.getItem(`policy-detail-toc:${id}`);
      if (v === '0') setTocOpen(false);
      else if (v === '1') setTocOpen(true);
      setTocPinnedMode(sessionStorage.getItem(`policy-detail-toc-pinned:${id}`) === '1');
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    try {
      sessionStorage.setItem(`policy-detail-toc:${id}`, tocOpen ? '1' : '0');
      sessionStorage.setItem(`policy-detail-toc-pinned:${id}`, tocPinnedMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [id, tocOpen, tocPinnedMode]);

  useEffect(() => {
    if (!selectedArticle) {
      setRelationNotesDraft({
        relatedPrecedentNote: '',
        relatedLawNote: '',
        relatedRuleNote: '',
      });
      return;
    }
    setRelationNotesDraft({
      relatedPrecedentNote: selectedArticle.relatedPrecedentNote || '',
      relatedLawNote: selectedArticle.relatedLawNote || '',
      relatedRuleNote: selectedArticle.relatedRuleNote || '',
    });
  }, [
    selectedArticle?.id,
    selectedArticle?.relatedPrecedentNote,
    selectedArticle?.relatedLawNote,
    selectedArticle?.relatedRuleNote,
  ]);

  useEffect(() => {
    if (!selectedArticle) return;
    setArticleMetaDraft({
      number: Number(selectedArticle.number) || 1,
      clauseNumber: selectedArticle.clauseNumber ?? '',
      itemNumber: selectedArticle.itemNumber ?? '',
      title: selectedArticle.title ?? '',
    });
  }, [
    selectedArticle?.id,
    selectedArticle?.number,
    selectedArticle?.clauseNumber,
    selectedArticle?.itemNumber,
    selectedArticle?.title,
  ]);

  const { data: policy, isLoading } = useQuery({
    queryKey: ['policy', id],
    queryFn: () => policiesApi.get(id!),
    enabled: !!id,
  });

  // 시점(as-of) 조회: 기준일이 있으면 그날 시행 중이던 본문으로 전문을 갈아끼운다.
  const { data: asOfPolicy, isFetching: isAsOfLoading } = useQuery({
    queryKey: ['policy', id, 'as-of', asOfDate],
    queryFn: () => policiesApi.getAsOf(id!, asOfDate),
    enabled: !!id && !!asOfDate,
  });
  const { data: effectiveDates = [] } = useQuery<string[]>({
    queryKey: ['policy', id, 'effective-dates'],
    queryFn: () => policiesApi.effectiveDates(id!),
    enabled: !!id,
  });
  /** 전문 보기가 실제로 그리는 규정 — 시점 조회 중이면 그 시점 스냅샷 */
  const viewPolicy = asOfDate && asOfPolicy ? asOfPolicy : policy;
  const asOfInfo = asOfDate && asOfPolicy ? asOfPolicy.asOf : null;
  // 조문 딥링크 해석 (T-73). 번호 기준(`#제3조제1항`·`?jo=3&hang=1`)을 먼저 보고,
  // 옛 `#article-<uuid>` 도 계속 받는다 — 이미 나간 링크를 깨뜨리지 않는다.
  useEffect(() => {
    if (!policy?.chapters?.length) return;
    const findChapterOf = (predicate: (a: any) => boolean) => {
      for (const ch of policy.chapters) {
        const hit = (ch.articles || []).find(predicate);
        if (hit) return { ch, hit };
      }
      return null;
    };

    const anchor = parseArticleAnchor({
      hash: window.location.hash,
      search: window.location.search,
    });
    let found: { ch: any; hit: any } | null = null;

    if (anchor) {
      for (const ch of policy.chapters) {
        const hit = findByAnchor(ch.articles || [], anchor);
        if (hit) {
          found = { ch, hit };
          break;
        }
      }
    } else {
      const legacyId = parseLegacyArticleId(window.location.hash);
      if (legacyId) found = findChapterOf((a: any) => a.id === legacyId);
    }

    if (!found) return;
    setSelectedArticle(found.hit);
    setArticleViewMode('segment');
    setExpandedChapters((prev) => new Set(prev).add(found.ch.id));
  }, [policy?.id]);

  /** 현재 조문을 가리키는 안정 링크를 클립보드에 복사한다 */
  const copyArticleLink = useCallback(async () => {
    if (!selectedArticle) return;
    const url = `${window.location.origin}${window.location.pathname}${articleHash(selectedArticle)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`링크를 복사했습니다 — ${formatArticleAnchor(selectedArticle)}`, 'success');
    } catch {
      // 클립보드 권한이 없으면(비 HTTPS 등) 주소만 바꿔 사용자가 직접 복사하게 한다
      window.location.hash = articleHash(selectedArticle).slice(1);
      toast('클립보드를 쓸 수 없어 주소창을 갱신했습니다. 주소를 복사하세요.', 'info');
    }
  }, [selectedArticle]);
  const { data: templates = [] } = useQuery({
    queryKey: ['policy-templates'],
    queryFn: () => templatesApi.list(),
    enabled: !!id,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['versions', selectedArticle?.id],
    queryFn: () => versionsApi.list(selectedArticle.id),
    enabled: !!selectedArticle,
  });

  useEffect(() => {
    if (!versions.length) {
      setCompareV1('');
      setCompareV2('');
      return;
    }
    if (!compareV1) setCompareV1(versions[0].id);
    if (!compareV2 && versions[1]) setCompareV2(versions[1].id);
  }, [versions, compareV1, compareV2]);

  const segmentVersionWorkflow = useMemo(() => {
    const list = versions as any[];
    return {
      drafts: list.filter((v) => v.status === 'draft'),
      inReview: list.filter((v) => v.status === 'review'),
    };
  }, [versions]);

  const openVersionEditor = useCallback(() => {
    if (!selectedArticle) return;
    const draft = (versions as any[]).find((v) => v.status === 'draft');
    setShowVersionEditor(true);
    setRevisionInternalReasons([]);
    setRevisionExternalReasons([]);
    if (draft) {
      setEditingDraftVersionId(draft.id);
      setVersionChangeNote(String(draft.changeNote || '').trim());
      setVersionContent(String(draft.content || '').trim());
      return;
    }
    setEditingDraftVersionId(null);
    setVersionChangeNote('');
    setVersionContent(String(selectedArticle?.versions?.[0]?.content || '').trim());
  }, [selectedArticle, versions]);

  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ['comments', selectedArticle?.id],
    queryFn: () => commentsApi.list(selectedArticle.id),
    enabled: !!selectedArticle,
  });

  const { data: files = [], refetch: refetchFiles } = useQuery({
    queryKey: ['files', id],
    queryFn: () => filesApi.list(id!),
    enabled: !!id,
  });

  const { data: diffResult, isFetching: isDiffLoading } = useQuery({
    queryKey: ['versionDiff', compareV1, compareV2],
    queryFn: () => versionsApi.diff(compareV1, compareV2),
    enabled: !!compareV1 && !!compareV2 && compareV1 !== compareV2,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => filesApi.upload(id!, file),
    onSuccess: () => { void refetchFiles(); setFileError(''); },
    onError: (e: any) => setFileError(e.response?.data?.message || '업로드 실패'),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (storedName: string) => filesApi.delete(id!, storedName),
    onSuccess: () => { void refetchFiles(); setFileError(''); },
    onError: (e: any) => setFileError(e.response?.data?.message || '삭제하지 못했습니다.'),
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const addChapterMutation = useMutation({
    mutationFn: (data: any) => policiesApi.createChapter(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setShowAddChapter(false);
      setNewChapter({ number: 1, title: '' });
    },
  });

  /* ── 절(節): 선택 계층 ── */
  const addSectionMutation = useMutation({
    mutationFn: ({ chapterId, ...data }: { chapterId: string; number: number; title: string }) =>
      policiesApi.createSection(id!, chapterId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setNewSection(null);
    },
  });

  const removeSectionMutation = useMutation({
    mutationFn: ({ chapterId, sectionId }: { chapterId: string; sectionId: string }) =>
      policiesApi.deleteSection(id!, chapterId, sectionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policy', id] }),
  });

  /** 절에 속하지 않는 조문 (절은 선택 계층이라 같은 장에 공존한다) */
  const articlesWithoutSection = useCallback(
    (chapter: any) => (chapter?.articles || []).filter((a: any) => !a.sectionId),
    [],
  );
  const articlesInSection = useCallback(
    (chapter: any, sectionId: string) =>
      (chapter?.articles || []).filter((a: any) => a.sectionId === sectionId),
    [],
  );
  const openAddSectionForm = useCallback((chapter: any) => {
    const nextNo = ((chapter?.sections || []).reduce(
      (max: number, s: any) => Math.max(max, Number(s.number) || 0),
      0,
    ) || 0) + 1;
    setNewSection({ chapterId: chapter.id, number: nextNo, title: '' });
  }, []);

  const [policyRevisionDate, setPolicyRevisionDate] = useState('');
  const [policyEffectiveDate, setPolicyEffectiveDate] = useState('');
  const [revisionNotify, setRevisionNotify] = useState({
    enabled: false,
    userIds: [] as string[],
    groupIds: [] as string[],
  });
  const [policyDatesMsg, setPolicyDatesMsg] = useState('');

  const { data: notifyGroups = [] } = useQuery({
    queryKey: ['notification-groups'],
    queryFn: () => notificationGroupsApi.list(),
    enabled: !!canEdit,
  });

  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['tenant-users'],
    queryFn: () => usersApi.list(),
    enabled: !!canEdit,
  });

  useEffect(() => {
    if (!policy) return;
    setPolicyRevisionDate(policyDateInputValue(policy.revisionDate));
    setPolicyEffectiveDate(policyDateInputValue(policy.effectiveDate));
    setRevisionNotify(parseRevisionNotify(policy.metadata));
  }, [policy?.id, policy?.revisionDate, policy?.effectiveDate, policy?.metadata]);

  const savePolicyDatesMutation = useMutation({
    mutationFn: () =>
      policiesApi.update(policy!.id, {
        revisionDate: policyRevisionDate || null,
        effectiveDate: policyEffectiveDate || null,
        revisionNotify,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setPolicyDatesMsg('저장했습니다.');
      setTimeout(() => setPolicyDatesMsg(''), 2500);
    },
  });

  /**
   * 시행중 ↔ 비활성 (T-15).
   *
   * `isActive` 는 지금 **표시 전용**이다 — 검색에서 빠지지도, 목록에서 사라지지도 않는다.
   * 폐지된 규정도 찾을 수 있어야 하므로 그게 맞다. 다만 사용자는 "비활성"을 "안 보이게
   * 됨"으로 읽기 쉬워서, 확인 창에 무엇이 바뀌고 무엇이 안 바뀌는지 적어 둔다.
   */
  const toggleActiveMutation = useMutation({
    mutationFn: (next: boolean) => policiesApi.update(policy!.id, { isActive: next }),
    onSuccess: (_res, next) => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      qc.invalidateQueries({ queryKey: ['policies'] });
      setActiveToggleTarget(null);
      setPolicyDatesMsg(next ? '시행중으로 되돌렸습니다.' : '비활성으로 표시했습니다.');
      setTimeout(() => setPolicyDatesMsg(''), 3000);
    },
  });

  const openAddArticleForm = useCallback(
    async (
      chapterId?: string,
      preset?: { number?: number; clauseNumber?: number; itemNumber?: number },
      sectionId?: string,
    ) => {
      if (!id || !canEdit) return;
      let ch: any = chapterId
        ? policy?.chapters?.find((c: any) => c.id === chapterId)
        : policy?.chapters?.find((c: any) => c.suppressHeader);
      if (!ch) {
        ch = await policiesApi.createChapter(id, {
          number: 1,
          title: '',
          suppressHeader: true,
        });
        await qc.invalidateQueries({ queryKey: ['policy', id] });
      }
      // 조 번호는 법령·규정 관례대로 문서 전체에서 이어진다(장이 바뀌어도 1로 돌아가지 않음).
      const jo = preset?.number ?? nextJoNumberForPolicy(policy?.chapters);
      setNewArticle({
        chapterId: ch.id,
        sectionId,
        number: jo,
        clauseNumber: preset?.clauseNumber,
        itemNumber: preset?.itemNumber,
        title: '',
        content: '',
        hasPrecedent: false,
        hasRelatedLaw: false,
        hasRelatedRule: false,
        relatedPrecedentNote: '',
        relatedLawNote: '',
        relatedRuleNote: '',
      });
    },
    [id, canEdit, policy?.chapters, qc],
  );

  const addArticleMutation = useMutation({
    mutationFn: async (form: NonNullable<typeof newArticle>) => {
      const ch = policy?.chapters?.find((c: any) => c.id === form.chapterId);
      const payloads = buildArticleCreateRequests(form, ch?.articles || []);
      let last: any;
      for (const body of payloads) {
        last = await policiesApi.createArticle(id!, form.chapterId, body);
      }
      return last;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setNewArticle(null);
    },
  });

  const saveArticleMetaMutation = useMutation({
    mutationFn: () =>
      policiesApi.updateArticle(id!, selectedChapterId, selectedArticle!.id, {
        number: Number(articleMetaDraft.number) || 1,
        title: String(articleMetaDraft.title ?? '').trim(),
        clauseNumber:
          articleMetaDraft.clauseNumber === '' || articleMetaDraft.clauseNumber == null
            ? null
            : Number(articleMetaDraft.clauseNumber),
        itemNumber:
          articleMetaDraft.itemNumber === '' || articleMetaDraft.itemNumber == null
            ? null
            : Number(articleMetaDraft.itemNumber),
      }),
    onSuccess: (updated: any) => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setSelectedArticle((prev: any) => (prev && updated?.id === prev.id ? { ...prev, ...updated } : prev));
    },
  });

  const updateArticleTagsMutation = useMutation({
    mutationFn: (payload: {
      hasPrecedent: boolean;
      hasRelatedLaw: boolean;
      hasRelatedRule: boolean;
    }) =>
      policiesApi.updateArticle(id!, selectedChapterId, selectedArticle!.id, payload),
    onSuccess: (updated: any) => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setSelectedArticle((prev: any) =>
        prev && updated?.id === prev.id
          ? {
              ...prev,
              ...updated,
            }
          : prev,
      );
    },
  });

  const saveRelationNotesMutation = useMutation({
    mutationFn: () =>
      policiesApi.updateArticle(id!, selectedChapterId, selectedArticle!.id, {
        hasPrecedent: !!selectedArticle!.hasPrecedent,
        hasRelatedLaw: !!selectedArticle!.hasRelatedLaw,
        hasRelatedRule: !!selectedArticle!.hasRelatedRule,
        relatedPrecedentNote: relationNotesDraft.relatedPrecedentNote,
        relatedLawNote: relationNotesDraft.relatedLawNote,
        relatedRuleNote: relationNotesDraft.relatedRuleNote,
      }),
    onSuccess: (updated: any) => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setSelectedArticle((prev: any) => (prev && updated?.id === prev.id ? { ...prev, ...updated } : prev));
      setRelationNotesDraft({
        relatedPrecedentNote: updated.relatedPrecedentNote || '',
        relatedLawNote: updated.relatedLawNote || '',
        relatedRuleNote: updated.relatedRuleNote || '',
      });
    },
  });

  const requestReviewMutation = useMutation({
    mutationFn: async (payload: { content: string; changeNote?: string }) => {
      if (!selectedArticle?.id) {
        throw new Error('선택된 조문이 없습니다.');
      }
      if (editingDraftVersionId) {
        await versionsApi.update(editingDraftVersionId, payload);
        return versionsApi.submit(editingDraftVersionId);
      }
      const created = await versionsApi.create(selectedArticle.id, payload);
      return versionsApi.submit(created.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', selectedArticle?.id] });
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setShowVersionEditor(false);
      setEditingDraftVersionId(null);
      setVersionContent('');
      setVersionChangeNote('');
      setRevisionInternalReasons([]);
      setRevisionExternalReasons([]);
    },
  });

  const submitMutation = useMutation({
    mutationFn: versionsApi.submit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', selectedArticle?.id] });
      qc.invalidateQueries({ queryKey: ['policy', id] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({
      id: versionId,
      changeNote,
      effectiveDate,
    }: {
      id: string;
      changeNote: string;
      effectiveDate?: string;
    }) => versionsApi.approve(versionId, { changeNote, effectiveDate }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', selectedArticle?.id] });
      qc.invalidateQueries({ queryKey: ['policy', id] });
      // 시행일이 바뀌었으니 시점 조회 후보 날짜도 다시 받는다
      qc.invalidateQueries({ queryKey: ['policy', id, 'effective-dates'] });
      setApproveTargetId(null);
      setApproveNote('');
      setApproveEffectiveDate('');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id: versionId, reason }: { id: string; reason: string }) =>
      versionsApi.reject(versionId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', selectedArticle?.id] });
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setRejectTargetId(null);
      setRejectReason('');
      setVersionActionMsg('초안으로 되돌렸습니다. 반려 사유가 버전에 기록됩니다.');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (versionId: string) => versionsApi.archive(versionId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['versions', selectedArticle?.id] });
      qc.invalidateQueries({ queryKey: ['policy', id] });
      qc.invalidateQueries({ queryKey: ['policy', id, 'effective-dates'] });
      setArchiveTarget(null);
      setVersionActionMsg(
        res?.remainingPublished === 0
          ? '폐지했습니다. 이 조문에는 게시된 본문이 남아 있지 않습니다 — 전문 보기·인쇄에서 본문 없이 나옵니다.'
          : '폐지했습니다.',
      );
    },
  });

  const createCommentMutation = useMutation({
    mutationFn: (content: string) => commentsApi.create(selectedArticle.id, { content }),
    onSuccess: () => {
      setCommentDraft('');
      void refetchComments();
    },
  });

  const resolveCommentMutation = useMutation({
    mutationFn: ({ id, isResolved }: { id: string; isResolved: boolean }) =>
      commentsApi.update(id, { isResolved }),
    onSuccess: () => refetchComments(),
  });

  const createAppendixMutation = useMutation({
    mutationFn: (payload: any) => policiesApi.createAppendix(id!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setAppendixModal(null);
    },
  });

  const updateAppendixMutation = useMutation({
    mutationFn: ({ appendixId, payload }: { appendixId: string; payload: any }) =>
      policiesApi.updateAppendix(id!, appendixId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setAppendixModal(null);
    },
  });

  const deleteAppendixMutation = useMutation({
    mutationFn: (appendixId: string) => policiesApi.deleteAppendix(id!, appendixId),
    onSuccess: (_, appendixId) => {
      qc.invalidateQueries({ queryKey: ['policy', id] });
      setSelectedAppendixId((prev) => (prev === appendixId ? null : prev));
    },
  });

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const q = tocQuery.trim().toLowerCase();
  const selectTocArticle = useCallback((article: any) => {
    setSelectedArticle(article);
    // 다른 조문으로 옮기면 앞 조문의 처리 알림은 지운다 — 남아 있으면 이 조문 얘기로 읽힌다
    setVersionActionMsg('');
    window.history.replaceState(null, '', `${window.location.pathname}#article-${article.id}`);
  }, []);
  const filteredChapters = policy?.chapters?.map((chapter: any) => {
    const sorted = [...(chapter.articles || [])].sort(sortArticlesToc);
    if (!q) return { ...chapter, articles: sorted };
    const groups = filterArticleJoGroups(sorted, q);
    if (chapter.title.toLowerCase().includes(q)) return { ...chapter, articles: sorted };
    if (groups.length > 0) {
      const flat = groups.flatMap((g) => flattenJoGroup(g));
      return { ...chapter, articles: flat };
    }
    return null;
  }).filter(Boolean) ?? [];
  const pdfFiles = files.filter((file: any) => /\.pdf$/i.test(file.originalName || ''));
  const compareRows = useMemo(() => {
    if (!diffResult?.v1?.content || !diffResult?.v2?.content) return [];
    const beforeLines = String(diffResult.v1.content).split('\n');
    const afterLines = String(diffResult.v2.content).split('\n');
    const max = Math.max(beforeLines.length, afterLines.length);
    return Array.from({ length: max }, (_, idx) => {
      const before = beforeLines[idx] ?? '';
      const after = afterLines[idx] ?? '';
      let kind: 'same' | 'added' | 'deleted' | 'changed' = 'same';
      if (!before && after) kind = 'added';
      else if (before && !after) kind = 'deleted';
      else if (before !== after) kind = 'changed';
      return { idx, before, after, kind };
    });
  }, [diffResult]);
  const fullViewGroups = useMemo(() => buildFullViewGroups(viewPolicy?.chapters), [viewPolicy]);
  /** 전문 보기·인쇄가 실제로 그리는 목록. 선택이 있으면 그 조만 (T-74) */
  const printableGroups = useMemo(
    () => filterFullViewGroupsByJo(fullViewGroups, printSelection),
    [fullViewGroups, printSelection],
  );
  const allJoNumbers = useMemo(() => collectJoNumbers(fullViewGroups), [fullViewGroups]);
  /** 음성 읽기용 문장 (T-81). 선택 인쇄 중이면 그 조만 읽는다 — 화면과 어긋나면 혼란스럽다. */
  const speechChunks = useMemo(
    () => buildPolicySpeech(printableGroups, policy?.title),
    [printableGroups, policy?.title],
  );
  const toggleJo = useCallback((jo: number) => {
    setPrintSelection((prev) => {
      const next = new Set(prev);
      if (next.has(jo)) next.delete(jo);
      else next.add(jo);
      return next;
    });
  }, []);

  const fullViewMatchCount = useMemo(() => {
    const q = fullViewSearchQuery.trim();
    if (!q) return 0;
    let re: RegExp;
    try {
      re = new RegExp(escapeRegExp(q), 'gi');
    } catch {
      return 0;
    }
    const countIn = (s: string) => {
      const m = String(s ?? '').match(re);
      return m ? m.length : 0;
    };
    let count = 0;
    for (const ch of fullViewGroups) {
      count += countIn(String(ch.title ?? ''));
      // allGroups는 절 소속 조문까지 포함한다(절 미소속만 보는 blocks로 세면 매치 수가 모자란다)
      for (const g of ch.allGroups || []) {
        for (const a of g.items || []) {
          count += countIn(String(a.title ?? ''));
          count += countIn(String(a.versions?.[0]?.content ?? ''));
        }
      }
    }
    return count;
  }, [fullViewSearchQuery, fullViewGroups]);

  const getFullViewRoot = useCallback(
    () => (showFullTextModal ? fullViewModalRef.current : fullViewMainRef.current),
    [showFullTextModal],
  );

  const clearActiveFullViewHit = useCallback(() => {
    const roots = [fullViewMainRef.current, fullViewModalRef.current].filter(Boolean) as HTMLElement[];
    for (const root of roots) {
      root.querySelectorAll('.tmpl-fullview-hit-active').forEach((el) => {
        el.classList.remove('tmpl-fullview-hit-active');
      });
    }
  }, []);

  const focusFullViewHit = useCallback(
    (requestedIndex: number) => {
      const root = getFullViewRoot();
      if (!root) return;
      const matches = Array.from(root.querySelectorAll('.tmpl-fullview-hit'));
      if (!matches.length) {
        clearActiveFullViewHit();
        setFullViewActiveMatchIndex(0);
        return;
      }
      const normalized = ((requestedIndex % matches.length) + matches.length) % matches.length;
      clearActiveFullViewHit();
      const target = matches[normalized];
      target.classList.add('tmpl-fullview-hit-active');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFullViewActiveMatchIndex(normalized);
    },
    [clearActiveFullViewHit, getFullViewRoot],
  );

  const scrollToFirstFullViewHit = useCallback(() => {
    focusFullViewHit(0);
  }, [focusFullViewHit]);

  const goToPrevFullViewHit = useCallback(() => {
    focusFullViewHit(fullViewActiveMatchIndex - 1);
  }, [focusFullViewHit, fullViewActiveMatchIndex]);

  const goToNextFullViewHit = useCallback(() => {
    focusFullViewHit(fullViewActiveMatchIndex + 1);
  }, [focusFullViewHit, fullViewActiveMatchIndex]);

  useEffect(() => {
    if (!fullViewSearchQuery.trim()) {
      clearActiveFullViewHit();
      setFullViewActiveMatchIndex(0);
      return;
    }
    focusFullViewHit(0);
  }, [fullViewSearchQuery, showFullTextModal, fullViewGroups, clearActiveFullViewHit, focusFullViewHit]);

  const selectedChapterId = useMemo(() => {
    if (!policy?.chapters || !selectedArticle) return '';
    for (const ch of policy.chapters) {
      if ((ch.articles || []).some((a: any) => a.id === selectedArticle.id)) return ch.id as string;
    }
    return '';
  }, [policy?.chapters, selectedArticle]);

  const selectedChapterArticles = useMemo(() => {
    if (!policy?.chapters || !selectedChapterId) return [];
    const ch = policy.chapters.find((c: any) => c.id === selectedChapterId);
    return ch?.articles || [];
  }, [policy?.chapters, selectedChapterId]);

  const segmentHeading = useMemo(() => {
    if (!selectedArticle) return null;
    return segmentArticleHeading(selectedArticle, selectedChapterArticles);
  }, [selectedArticle, selectedChapterArticles]);

  const flatArticlesForJump = useMemo(() => {
    if (!policy?.chapters) return [];
    const out: { id: string; label: string }[] = [];
    for (const ch of policy.chapters) {
      for (const a of [...(ch.articles || [])].sort(sortArticlesToc)) {
        out.push({
          id: a.id,
          label: `${toKoreanOrdinal(ch.number)}장 · ${articleShortLabel(a)} ${a.title || ''}`,
        });
      }
    }
    return out;
  }, [policy]);

  const historySnapshotRows = useMemo(() => {
    if (!policy?.chapters) return [];
    const rows: { key: string; articleId: string; line: string; sub: string }[] = [];
    for (const ch of policy.chapters) {
      for (const a of [...(ch.articles || [])].sort(sortArticlesToc)) {
        const v = a.versions?.[0];
        if (!v) continue;
        rows.push({
          key: a.id,
          articleId: a.id,
          line: `${toKoreanOrdinal(ch.number)}장 · ${articleShortLabel(a)} (${a.title || '제목 없음'})`,
          sub: `게시 v${v.versionNum} · ${statusLabel[v.status] || v.status} · ${new Date(v.createdAt).toLocaleDateString('ko-KR')}`,
        });
      }
    }
    return rows;
  }, [policy]);

  const appendicesGrouped = useMemo(() => {
    const raw = (policy?.appendices || []) as any[];
    const kindOrder: AppendixKind[] = ['supplementary', 'annex', 'form'];
    const rank = (k: string) => {
      const i = kindOrder.indexOf(k as AppendixKind);
      return i === -1 ? 99 : i;
    };
    const list = [...raw].sort((a: any, b: any) => {
      const rk = rank(a.kind) - rank(b.kind);
      if (rk !== 0) return rk;
      const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (so !== 0) return so;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return {
      all: list,
      supplementary: list.filter((a: any) => a.kind === 'supplementary'),
      annex: list.filter((a: any) => a.kind === 'annex'),
      form: list.filter((a: any) => a.kind === 'form'),
    };
  }, [policy?.appendices]);

  const selectedAppendix = useMemo(
    () => appendicesGrouped.all.find((a: any) => a.id === selectedAppendixId) || null,
    [appendicesGrouped.all, selectedAppendixId],
  );

  const draftRevisionReasonText = useMemo(() => {
    const tags: string[] = [];
    if (revisionInternalReasons.length) tags.push(`내부요인(${revisionInternalReasons.join(', ')})`);
    if (revisionExternalReasons.length) tags.push(`외부요인(${revisionExternalReasons.join(', ')})`);
    if (!tags.length) return '';
    const articleName = selectedArticle ? `${articleShortLabel(selectedArticle)} ${selectedArticle.title || ''}`.trim() : '해당 조문';
    return `${articleName} 개정 초안입니다. ${tags.join(' / ')} 사유로 규정 문구를 정비하고 적용 기준을 명확화했습니다.`;
  }, [revisionInternalReasons, revisionExternalReasons, selectedArticle]);

  useEffect(() => {
    const list = appendicesGrouped.all;
    if (!list.length) {
      setSelectedAppendixId(null);
      return;
    }
    if (selectedAppendixId && !list.some((a: any) => a.id === selectedAppendixId)) {
      setSelectedAppendixId(null);
    }
  }, [appendicesGrouped.all, selectedAppendixId]);

  const jumpToArticle = useCallback(
    (articleId: string) => {
      if (!articleId || !policy?.chapters) return;
      for (const ch of policy.chapters) {
        const art = (ch.articles || []).find((x: any) => x.id === articleId);
        if (art) {
          setArticleViewMode('segment');
          setTocOpen(true);
          setLeftSidebarTab('toc');
          setExpandedChapters((prev) => new Set(prev).add(ch.id));
          setSelectedArticle(art);
          return;
        }
      }
    },
    [policy],
  );

  const downloadFullTextTxt = useCallback(() => {
    if (!policy) return;
    const text = buildPolicyPlainText({
      policy,
      chapters: fullViewGroups,
      appendices: appendicesGrouped.all,
      appendixKindLabel,
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = policyPlainTextFilename(policy.code);
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
    setLawToolMsg('전문 텍스트(.txt)를 내려받았습니다.');
    setTimeout(() => setLawToolMsg(''), 2500);
  }, [policy, fullViewGroups, appendicesGrouped.all]);

  const downloadPdf = useCallback(async () => {
    if (!policy || !id) return;
    setIsExportingPdf(true);
    setLawToolMsg('PDF를 만드는 중입니다…');
    try {
      // 전문 보기와 같은 빌더로 만든 HTML을 그대로 보낸다(화면 = 인쇄물 = PDF).
      const html = buildEnterprisePolicyBodyHtml(fullViewGroups, '');
      const metaParts = [
        policy.code ? `코드: ${policy.code}` : '',
        policy.revisionDate ? `개정일: ${formatKoDate(policy.revisionDate)}` : '',
        policy.effectiveDate ? `시행일: ${formatKoDate(policy.effectiveDate)}` : '',
        asOfDate ? `기준일: ${asOfDate} 시점 본문` : '',
      ].filter(Boolean);
      const blob = await policiesApi.exportPdf(id, {
        html,
        title: policy.title,
        metaLine: metaParts.join(' · '),
        footerText: `출력일: ${new Date().toLocaleDateString('ko-KR')}`,
        pageNumbers: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(policy.code || 'policy').replace(/[^\w.-]+/g, '_')}${asOfDate ? `-${asOfDate}` : ''}.pdf`;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
      setLawToolMsg('PDF를 내려받았습니다.');
    } catch (err: any) {
      setLawToolMsg(err?.response?.status === 500 ? 'PDF 생성에 실패했습니다.' : 'PDF 요청에 실패했습니다.');
    } finally {
      setIsExportingPdf(false);
      setTimeout(() => setLawToolMsg(''), 3000);
    }
  }, [policy, id, fullViewGroups, asOfDate]);

  /**
   * 한/글 내보내기 (T-85).
   *
   * 만들어지는 파일은 `.hwpx` 다. `.hwp` 는 한컴 독점 바이너리라 서버에서 생성할 수단이
   * 없고, `.hwpx` 는 같은 한/글이 여는 KS X 6101 표준이다(ADR-0016). 한/글 2014 이전
   * 버전은 열지 못하므로 안내 문구에 적어 둔다.
   */
  const downloadHwpx = useCallback(async () => {
    if (!policy || !id) return;
    setIsExportingHwpx(true);
    setLawToolMsg('한/글 문서를 만드는 중입니다…');
    try {
      // PDF 와 같은 빌더로 만든 HTML 을 보낸다(화면 = 인쇄물 = PDF = HWPX).
      const html = buildEnterprisePolicyBodyHtml(fullViewGroups, '');
      const blob = await policiesApi.exportHwpx(id, { html, title: policy.title });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(policy.code || 'policy').replace(/[^\w.-]+/g, '_')}${asOfDate ? `-${asOfDate}` : ''}.hwpx`;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
      setLawToolMsg('한/글 문서(.hwpx)를 내려받았습니다. 한/글 2014 이상에서 열립니다.');
    } catch (err: any) {
      setLawToolMsg(
        err?.response?.status === 500 ? '한/글 문서 생성에 실패했습니다.' : '한/글 문서 요청에 실패했습니다.',
      );
    } finally {
      setIsExportingHwpx(false);
      setTimeout(() => setLawToolMsg(''), 4000);
    }
  }, [policy, id, fullViewGroups, asOfDate]);

  const copyPageUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLawToolMsg('현재 페이지 주소를 복사했습니다.');
    } catch {
      setLawToolMsg('복사에 실패했습니다.');
    }
    setTimeout(() => setLawToolMsg(''), 2500);
  }, []);

  const openStdKoreanDict = useCallback(() => {
    window.open('https://stdict.korean.go.kr/main/main.do', '_blank', 'noopener,noreferrer');
  }, []);

  const activeTemplate = useMemo(() => {
    if (!templates.length) return null;
    if (selectedTemplateId) {
      return templates.find((row: any) => row.id === selectedTemplateId) || null;
    }
    if (policy?.templateId) {
      const matched = templates.find((row: any) => row.id === policy.templateId);
      if (matched) return matched;
    }
    return templates.find((row: any) => row.isDefault) || null;
  }, [templates, selectedTemplateId, policy?.templateId]);
  // 토큰 데이터는 templateTokens.buildTemplateTokenData 단일 소스를 사용한다.
  // ({{content}}·{{logo}}는 렌더 시점 관심사라 TemplateRenderer가 덧붙인다)
  const templateRenderData = useMemo(
    () =>
      buildTemplateTokenData({
        tenantName: user?.tenantName,
        policyTitle: policy?.title,
        policyCode: policy?.code,
        revisionDate: policy?.revisionDate,
        effectiveDate: policy?.effectiveDate,
      }),
    [user?.tenantName, policy?.title, policy?.code, policy?.revisionDate, policy?.effectiveDate],
  );

  const relatedQuery = (
    relatedCustomQuery.trim() ||
    `${selectedArticle?.title || ''} ${selectedArticle ? articleShortLabel(selectedArticle) : ''} ${relationNotesDraft.relatedPrecedentNote || ''} ${relationNotesDraft.relatedLawNote || ''}`.trim()
  )
    .replace(/\b[A-Z]{2,}-\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const { data: relatedPreview, isFetching: isRelatedLoading } = useQuery({
    queryKey: ['relatedPreview', relatedType, relatedQuery, relatedSort, relatedScope],
    queryFn: () => searchApi.relatedPreview(relatedType, relatedQuery, 5, relatedSort, relatedScope),
    enabled: !!relatedQuery,
  });
  const relatedItems = useMemo(() => (relatedPreview?.items || []).slice(0, 5), [relatedPreview]);
  const relatedDetail = relatedDetailIndex !== null ? relatedItems[relatedDetailIndex] : null;
  const relatedSearchKeyword = selectedArticle
    ? `${policy?.title || ''} ${articleShortLabel(selectedArticle)}`.trim()
    : (policy?.title || '');
  const recommendedQueries = useMemo((): RecommendedAction[] => {
    const topic = (selectedArticle?.title || '').trim();
    const heading = selectedArticle ? articleShortLabel(selectedArticle) : '';
    const noteHint = (
      relatedType === 'precedent'
        ? relationNotesDraft.relatedPrecedentNote
        : relatedType === 'law'
          ? relationNotesDraft.relatedLawNote
          : relationNotesDraft.relatedRuleNote
    ) || '';
    const anchor = [topic, heading, noteHint]
      .join(' ')
      .replace(/\b[A-Z]{2,}-\d+\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!anchor) return [];
    if (relatedType === 'precedent') {
      return [
        { label: `${anchor} 판례`, href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 판례`)}`, external: true },
        { label: `${anchor} 유사 판결`, href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 유사 판결`)}`, external: true },
        {
          label: `${anchor} 쟁점`,
          href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 쟁점`)}`,
          external: true,
        },
      ];
    }
    if (relatedType === 'law') {
      return [
        { label: `${anchor} 관련 법령`, href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 관련 법령`)}`, external: true },
        { label: `${anchor} 조문 해설`, href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 조문 해설`)}`, external: true },
        { label: `${anchor} 시행규칙`, href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 시행규칙`)}`, external: true },
      ];
    }
    return [
      { label: '내부 통합검색', href: `/search?q=${encodeURIComponent(anchor)}`, external: false },
      { label: `${anchor} 내부 지침`, href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 내부 지침`)}`, external: true },
      {
        label: `${anchor} 실무 적용`,
        href: `https://www.google.com/search?q=${encodeURIComponent(`${anchor} 실무 적용`)}`,
        external: true,
      },
    ];
  }, [selectedArticle, relatedType, relationNotesDraft.relatedLawNote, relationNotesDraft.relatedPrecedentNote, relationNotesDraft.relatedRuleNote]);
  const isPinned = (item: { title: string; url?: string }, type: 'precedent' | 'law' | 'rule') =>
    pinnedItems.some((p) => p.type === type && p.title === item.title && (p.url || '') === (item.url || ''));

  const togglePin = (item: { title: string; snippet: string; url?: string }, type: 'precedent' | 'law' | 'rule') => {
    setPinnedItems((prev) => {
      const exists = prev.some((p) => p.type === type && p.title === item.title && (p.url || '') === (item.url || ''));
      if (exists) {
        return prev.filter((p) => !(p.type === type && p.title === item.title && (p.url || '') === (item.url || '')));
      }
      return [{ ...item, type }, ...prev].slice(0, 12);
    });
  };

  const buildAutoReferenceBlock = useCallback(() => {
    const lines: string[] = [];
    const seen = new Set<string>();
    const pushLine = (label: string, title: string, url?: string, snippet?: string) => {
      const key = `${label}|${title}|${url || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      lines.push(`- [${label}] ${title}${url ? ` (${url})` : ''}`);
      const sn = String(snippet || '').trim();
      if (sn) lines.push(`  참고: ${sn.length > 220 ? `${sn.slice(0, 220)}…` : sn}`);
    };
    pinnedItems.forEach((p) => pushLine(revisionRefLabel(p.type), p.title, p.url, p.snippet));
    relatedItems.forEach((item: any) => pushLine(revisionRefLabel(relatedType), item.title, item.url, item.snippet));
    const q = relatedQuery.trim();
    // 미리보기/고정 결과가 없으면 본문에 템플릿 블록을 억지로 주입하지 않는다.
    if (!lines.length) return '';
    let inner = '【검색·참고 근거(자동 삽입)】\n';
    inner += lines.join('\n');
    if (q) inner += `\n\n(검색·미리보기 키워드: ${q})`;
    return `${AUTO_REF_START}\n${inner}\n${AUTO_REF_END}`;
  }, [pinnedItems, relatedItems, relatedType, relatedQuery]);

  const buildFullAutoDraftBody = useCallback(() => {
    const pub = String(selectedArticle?.versions?.[0]?.content || '').trim();
    const existingDraft = String(versionContent || '').trim();
    const bodyLines: string[] = [];
    // 사용자가 이미 입력한 초안이 있으면 그것을 우선 보존한다.
    if (existingDraft) bodyLines.push(stripAutoRefBlock(existingDraft).trim());
    else if (pub) bodyLines.push(pub);
    else bodyLines.push('(현재 게시된 본문이 없습니다. 아래부터 초안을 작성하세요.)');

    const gist = draftRevisionReasonText.trim() || versionChangeNote.trim();
    if (gist) {
      bodyLines.push('');
      bodyLines.push('【개정 요지】');
      bodyLines.push(gist);
    }

    const refBlock = buildAutoReferenceBlock();
    if (refBlock) {
      bodyLines.push('');
      bodyLines.push(refBlock);
    }

    bodyLines.push('');
    bodyLines.push('【개정 초안 작성 가이드】');
    bodyLines.push('- 위 본문을 기준으로 삭제·추가·문구 정리 내용을 반영하세요.');
    bodyLines.push('- 법령·판례·내부 규정을 인용할 경우 출처(사건번호·법령명·문서 URL 등)를 명시하세요.');

    return bodyLines.join('\n');
  }, [selectedArticle, versionContent, draftRevisionReasonText, versionChangeNote, buildAutoReferenceBlock]);

  const applySearchRefsToDraft = useCallback(() => {
    const refBlock = buildAutoReferenceBlock();
    if (!refBlock.trim()) {
      setLawToolMsg('미리보기 결과가 없어 반영할 참고 근거가 없습니다.');
      setTimeout(() => setLawToolMsg(''), 2500);
      return;
    }
    setVersionContent((prev) => {
      const stripped = stripAutoRefBlock(prev);
      const glue = stripped.trim().length ? '\n\n' : '';
      return `${stripped.trimEnd()}${glue}${refBlock}`.trim();
    });
  }, [buildAutoReferenceBlock]);

  useEffect(() => {
    setRelatedDetailIndex(null);
  }, [relatedType, relatedQuery, relatedSort, relatedScope]);

  useEffect(() => {
    setExpandedPreviewMap({});
  }, [relatedType, relatedQuery, relatedSort, relatedScope]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('policy-manager-related-pins');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setPinnedItems(parsed);
    } catch {
      // ignore invalid local storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('policy-manager-related-pins', JSON.stringify(pinnedItems));
    } catch {
      // ignore storage write errors
    }
  }, [pinnedItems]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('policy-manager-related-preferences');
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        type?: 'precedent' | 'law' | 'rule';
        sort?: 'relevance' | 'latest';
        scope?: 'title' | 'fulltext';
      };
      if (parsed.type) setRelatedType(parsed.type);
      if (parsed.sort) setRelatedSort(parsed.sort);
      if (parsed.scope) setRelatedScope(parsed.scope);
    } catch {
      // ignore invalid local storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        'policy-manager-related-preferences',
        JSON.stringify({ type: relatedType, sort: relatedSort, scope: relatedScope }),
      );
    } catch {
      // ignore storage write errors
    }
  }, [relatedType, relatedSort, relatedScope]);

  useEffect(() => {
    if (relatedDetailIndex === null) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setRelatedDetailIndex(null);
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setRelatedDetailIndex((prev) => {
          if (prev === null) return null;
          return Math.max(0, prev - 1);
        });
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setRelatedDetailIndex((prev) => {
          if (prev === null) return null;
          return Math.min(relatedItems.length - 1, prev + 1);
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [relatedDetailIndex, relatedItems.length]);

  useEffect(() => {
    if (!showFullTextModal) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFullTextModal(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullTextModal]);

  useEffect(() => {
    if (!policy || selectedTemplateId) return;
    if (policy.templateId) {
      setSelectedTemplateId(policy.templateId);
      return;
    }
    const fallback = templates.find((row: any) => row.isDefault);
    if (fallback) setSelectedTemplateId(fallback.id);
  }, [policy, templates, selectedTemplateId]);

  if (isLoading) return <LoadingBlock />;
  if (!policy) {
    return (
      <div className="card">
        <EmptyState
          icon={FileText}
          title="규정을 찾을 수 없습니다"
          description="목록에서 다시 선택해 주세요."
          action={
            <Link to="/policies" className="btn-primary text-sm">
              규정 목록으로
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={clsx('page-shell max-w-none', showFullTextModal && 'print:hidden')}>
      <style>{`
        .tmpl-fullview-hit-active {
          outline: 2px solid rgb(245 158 11 / 0.95);
          outline-offset: 1px;
          box-shadow: 0 0 0 2px rgb(255 251 235);
        }
      `}</style>
      {/* 상단: 뒤로 + 경로 + 목차 패널 토글(넓은 화면) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2 min-w-0">
          <Link to="/policies" className="inline-flex items-center gap-1 text-sm text-navy-700 hover:underline font-medium">
            <ChevronLeft size={15} /> 규정 목록
          </Link>
          <nav
            className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-gray-600"
            aria-label="현재 위치"
          >
            <Link to="/policies" className="text-gray-500 hover:text-navy-700 hover:underline">
              규정 목록
            </Link>
            <ChevronRight size={14} className="text-gray-300 flex-shrink-0" aria-hidden />
            <span className="text-gray-900 font-semibold truncate max-w-[14rem] sm:max-w-2xl" title={policy.title}>
              {policy.title}
            </span>
            <span className="text-gray-400 hidden sm:inline">·</span>
            <span className="text-gray-600 text-xs sm:text-sm">
              {articleViewMode === 'full' ? '전문 보기' : '분절 보기'}
            </span>
          </nav>
        </div>
        <button
          type="button"
          onClick={() => {
            const visible = tocOpen || tocPinnedMode;
            if (visible) {
              setTocOpen(false);
              setTocPinnedMode(false);
            } else {
              setTocOpen(true);
            }
          }}
          className="btn-secondary text-xs shrink-0 self-start"
          aria-expanded={tocOpen || tocPinnedMode}
          aria-controls="policy-toc-panel"
        >
          {tocOpen || tocPinnedMode ? (
            <>
              <PanelLeftClose size={15} aria-hidden />
              목차 숨기기
            </>
          ) : (
            <>
              <PanelLeft size={15} aria-hidden />
              목차 보이기
            </>
          )}
        </button>
      </div>

      {/* 규정 헤더: 좌측 목차 패널 + 우측 규정 카드 (lg: 본문 열과 그리드로 묶어 sticky 유지) */}
      <div
        className={clsx(
          (tocOpen || tocPinnedMode) && 'lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-x-4',
        )}
      >
        {(tocOpen || tocPinnedMode) && (
          <div
            className={clsx(
              'flex shrink-0 w-full flex-col overflow-hidden border-b border-gray-300 bg-white min-h-0',
              'lg:w-[22rem] lg:shrink-0 lg:border lg:rounded-sm lg:shadow-sm',
              'lg:sticky lg:top-4 lg:z-20 lg:self-start lg:max-h-[calc(100vh-2rem)]',
            )}
          >
          <nav
            className="flex shrink-0 w-full flex-row bg-navy-900 text-white text-xs font-semibold border-b border-navy-950"
            aria-label="본문·목차·연혁·부칙·별표"
          >
            <button
              type="button"
              className={clsx(
                'flex-1 inline-flex flex-row items-center justify-center gap-1 py-2.5 px-1.5 sm:px-2 border-r border-navy-800 border-b-2 transition-colors last:border-r-0',
                leftSidebarTab === 'toc'
                  ? 'bg-navy-800 text-white border-b-gold-400'
                  : 'border-b-transparent text-navy-200 hover:bg-navy-800 hover:text-white',
              )}
              onClick={() => setLeftSidebarTab('toc')}
            >
              <FileText size={13} aria-hidden className="flex-shrink-0" />
              <span className="leading-tight text-center">본문·목차</span>
            </button>
            <button
              type="button"
              className={clsx(
                'flex-1 inline-flex flex-row items-center justify-center gap-1 py-2.5 px-1.5 sm:px-2 border-r border-navy-800 border-b-2 transition-colors last:border-r-0',
                leftSidebarTab === 'history'
                  ? 'bg-navy-800 text-white border-b-gold-400'
                  : 'border-b-transparent text-navy-200 hover:bg-navy-800 hover:text-white',
              )}
              onClick={() => setLeftSidebarTab('history')}
            >
              <History size={13} aria-hidden className="flex-shrink-0" />
              <span className="leading-tight text-center">연혁</span>
            </button>
            <button
              type="button"
              className={clsx(
                'flex-1 inline-flex flex-row items-center justify-center gap-1 py-2.5 px-1.5 sm:px-2 border-r border-navy-800 border-b-2 transition-colors last:border-r-0',
                leftSidebarTab === 'appendices'
                  ? 'bg-navy-800 text-white border-b-gold-400'
                  : 'border-b-transparent text-navy-200 hover:bg-navy-800 hover:text-white',
              )}
              onClick={() => setLeftSidebarTab('appendices')}
            >
              <Layers size={13} aria-hidden className="flex-shrink-0" />
              <span className="leading-tight text-center">부칙·별표</span>
            </button>
          </nav>
          <div
            id="policy-toc-panel"
            className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-white border-t border-gray-200 max-h-[min(48vh,400px)] lg:max-h-none"
          >
          {leftSidebarTab === 'toc' ? (
            <>
              <div className="p-3 border-b border-gray-200 bg-gray-50 shrink-0">
                <label className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                  <input
                    type="checkbox"
                    checked={tocPinnedMode}
                    onChange={(e) => {
                      setTocPinnedMode(e.target.checked);
                      if (e.target.checked) setTocOpen(true);
                    }}
                  />
                  목차 고정 모드
                </label>
                <label className="sr-only" htmlFor="toc-search">
                  화면 내 검색
                </label>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="toc-search"
                    className="input pl-8 text-sm"
                    placeholder="조문번호·제목 검색 (목차 필터)"
                    value={tocQuery}
                    onChange={(e) => setTocQuery(e.target.value)}
                  />
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setReorderError('');
                      setReorderOpen(true);
                    }}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-gray-600 hover:text-navy-700 border border-gray-300 rounded py-1.5 hover:bg-white transition-colors"
                  >
                    <ArrowUpDown size={12} aria-hidden /> 조 순서 재정렬
                  </button>
                )}
              </div>
              <div className="divide-y divide-gray-100 flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {filteredChapters.length === 0 && (
              <EmptyState
                compact
                icon={FileText}
                title="등록된 조문이 없습니다"
                description="장(章) 없이 조(條)부터 추가할 수 있습니다."
                action={
                  canEdit ? (
                    <button type="button" onClick={() => openAddArticleForm()} className="btn-primary text-xs">
                      <Plus size={12} /> 조 추가
                    </button>
                  ) : undefined
                }
              />
            )}
            {filteredChapters.map((chapter: any) => {
              if (isChapterHeaderHidden(chapter)) {
                return (
                  <div key={chapter.id} className="border-b border-gray-100">
                    <TocArticleGroups
                      selectMode={selectMode}
                      printSelection={printSelection}
                      onToggleJo={toggleJo}
                      articles={chapter.articles || []}
                      query={tocQuery}
                      plJo="pl-3"
                      plHang="pl-8"
                      plItem="pl-14"
                      selectedArticle={selectedArticle}
                      onSelect={selectTocArticle}
                      canEdit={canEdit}
                      onAddHang={(jo) =>
                        openAddArticleForm(chapter.id, {
                          number: jo,
                          clauseNumber: nextClauseNumberForJo(chapter.articles || [], jo),
                        })
                      }
                    />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openAddArticleForm(chapter.id)}
                        className="w-full flex items-center gap-1.5 pl-4 pr-4 py-2 text-xs text-gray-400 hover:text-navy-700 hover:bg-gray-100 transition-colors"
                      >
                        <Plus size={11} /> 조 추가
                      </button>
                    )}
                  </div>
                );
              }
              return (
              <div key={chapter.id}>
                <button
                  onClick={() => toggleChapter(chapter.id)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                >
                  {expandedChapters.has(chapter.id)
                    ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                    : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
                  <span className="text-sm font-medium text-gray-800">
                    <span className="whitespace-nowrap">{toKoreanOrdinal(chapter.number)}장</span> {chapter.title}
                  </span>
                  <span className="ml-auto text-xs text-gray-400">
                    {countDistinctJo(chapter.articles || [])}조
                  </span>
                </button>

                {expandedChapters.has(chapter.id) && (
                  <div className="bg-gray-50 border-t border-gray-100">
                    {/* 절에 속하지 않는 조문 먼저 (절은 선택 계층이므로 공존 가능) */}
                    <TocArticleGroups
                      selectMode={selectMode}
                      printSelection={printSelection}
                      onToggleJo={toggleJo}
                      articles={articlesWithoutSection(chapter)}
                      query={tocQuery}
                      plJo="pl-3"
                      plHang="pl-8"
                      plItem="pl-14"
                      selectedArticle={selectedArticle}
                      onSelect={selectTocArticle}
                      canEdit={canEdit}
                      onAddHang={(jo) =>
                        openAddArticleForm(chapter.id, {
                          number: jo,
                          clauseNumber: nextClauseNumberForJo(chapter.articles || [], jo),
                        })
                      }
                    />
                    {(chapter.sections || []).map((section: any) => (
                      <div key={section.id}>
                        <div className="flex items-center gap-2 pl-5 pr-3 py-1.5 bg-gray-100/80 border-y border-gray-200">
                          <span className="text-xs font-medium text-gray-700">
                            제{section.number}절 {section.title}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => removeSectionMutation.mutate({ chapterId: chapter.id, sectionId: section.id })}
                              className="ml-auto text-[11px] text-gray-400 hover:text-red-600"
                              title="절 삭제 (조문은 유지됩니다)"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                        <TocArticleGroups
                          selectMode={selectMode}
                          printSelection={printSelection}
                          onToggleJo={toggleJo}
                          articles={articlesInSection(chapter, section.id)}
                          query={tocQuery}
                          plJo="pl-5"
                          plHang="pl-10"
                          plItem="pl-16"
                          selectedArticle={selectedArticle}
                          onSelect={selectTocArticle}
                          canEdit={canEdit}
                          onAddHang={(jo) =>
                            openAddArticleForm(chapter.id, {
                              number: jo,
                              clauseNumber: nextClauseNumberForJo(chapter.articles || [], jo),
                            })
                          }
                        />
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openAddArticleForm(chapter.id, undefined, section.id)}
                            className="w-full flex items-center gap-1.5 pl-11 pr-4 py-1.5 text-[11px] text-gray-400 hover:text-navy-700 hover:bg-gray-100 transition-colors"
                          >
                            <Plus size={11} /> 제{section.number}절에 조 추가
                          </button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => openAddArticleForm(chapter.id)}
                          className="flex items-center gap-1.5 pl-9 pr-4 py-2 text-xs text-gray-400 hover:text-navy-700 hover:bg-gray-100 transition-colors"
                        >
                          <Plus size={11} /> 조 추가
                        </button>
                        <button
                          type="button"
                          onClick={() => openAddSectionForm(chapter)}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-navy-700 hover:bg-gray-100 transition-colors"
                        >
                          <Plus size={11} /> 절 추가
                        </button>
                      </div>
                    )}
                    {canEdit && newSection != null && newSection.chapterId === chapter.id && (
                      <div className="m-2 rounded border border-gray-200 bg-white p-2.5 space-y-2">
                        <div className="flex items-end gap-2">
                          <div className="w-20">
                            <label className="block text-[11px] text-gray-600 mb-1">절 번호</label>
                            <input
                              type="number"
                              min={1}
                              className="input h-8 text-sm"
                              value={newSection.number}
                              onChange={(e) =>
                                setNewSection({ ...newSection, number: +e.target.value })
                              }
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[11px] text-gray-600 mb-1">절 제목</label>
                            <input
                              className="input h-8 text-sm"
                              placeholder="예) 채용, 복무"
                              value={newSection.title}
                              onChange={(e) => setNewSection({ ...newSection, title: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="btn-primary text-xs py-1 px-2.5"
                            disabled={!newSection.title.trim() || addSectionMutation.isPending}
                            onClick={() => addSectionMutation.mutate(newSection)}
                          >
                            {addSectionMutation.isPending ? '추가 중...' : '절 추가'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-xs py-1 px-2.5"
                            onClick={() => setNewSection(null)}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}
            {canEdit && (
              <div className="p-3 border-t border-gray-200 bg-white/95 space-y-2">
                <button
                  type="button"
                  onClick={() => openAddArticleForm()}
                  className="w-full flex items-center justify-center gap-1.5 rounded border border-navy-500 bg-navy-800 py-2 text-xs font-medium text-white hover:bg-navy-700"
                >
                  <Plus size={12} /> 조 추가
                </button>
                {showAddChapter ? (
                  <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2.5">
                    <div className="flex items-end gap-2">
                      <div className="w-24">
                        <label className="block text-[11px] text-gray-600 mb-1">장 번호</label>
                        <input
                          type="number"
                          className="input h-9 text-sm"
                          min={1}
                          value={newChapter.number}
                          onChange={(e) => setNewChapter({ ...newChapter, number: +e.target.value })}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[11px] text-gray-600 mb-1">장 제목</label>
                        <input
                          className="input h-9 text-sm"
                          placeholder="예) 총칙, 일반사항"
                          value={newChapter.title}
                          onChange={(e) => setNewChapter({ ...newChapter, title: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => addChapterMutation.mutate(newChapter)}
                        disabled={!newChapter.title || addChapterMutation.isPending}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-navy-500 bg-navy-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-navy-700 disabled:opacity-50"
                      >
                        <Plus size={12} />
                        {addChapterMutation.isPending ? '추가 중...' : '장 추가'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddChapter(false)}
                        className="inline-flex items-center justify-center rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddChapter(true)}
                    className="w-full flex items-center justify-center gap-1.5 rounded border border-dashed border-gray-300 bg-white py-2 text-xs text-gray-500 hover:border-navy-400 hover:bg-navy-50/30 hover:text-navy-800 transition-colors"
                  >
                    <Plus size={12} />
                    장(章) 구조 추가 (선택)
                  </button>
                )}
              </div>
            )}
              </div>
            </>
          ) : leftSidebarTab === 'history' ? (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 text-xs text-gray-700 space-y-2">
              <p className="text-[11px] text-gray-500 leading-relaxed">
                각 조의 <strong>현재 게시된 버전</strong> 스냅샷입니다. 상세 개정 비교·신구대비는 분절 보기에서 조를
                선택한 뒤 우측 패널을 이용해 주세요.
              </p>
              {historySnapshotRows.length === 0 ? (
                <p className="text-gray-400 py-6 text-center">게시된 조문 버전이 없습니다.</p>
              ) : (
                <ul className="space-y-1.5">
                  {historySnapshotRows.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        onClick={() => jumpToArticle(row.articleId)}
                        className="w-full text-left rounded border border-gray-200 bg-white px-2.5 py-2 hover:border-navy-400 hover:bg-navy-50/40 transition-colors"
                      >
                        <div className="font-medium text-gray-900">{row.line}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{row.sub}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden text-xs text-gray-700 border-t-2 border-navy-100 bg-slate-50/90">
              <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold tracking-wide text-navy-900 shrink-0">
                부칙·별표·서식
              </div>
              <div className="flex flex-col flex-1 min-h-0 border-t border-gray-200/80">
                <div className="p-3 border-b border-gray-200 bg-gray-50 space-y-2 shrink-0">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    규정 본문과 별도로 <strong>부칙·별표·서식</strong>을 평문으로 둡니다. 법령 정보 포털의 음성·점자 등은
                    제외하고, 제목·본문 위주로만 관리합니다.
                  </p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setAppendixDraft({ kind: 'supplementary', title: '', body: '', sortOrder: '' });
                        setAppendixModal({ mode: 'create' });
                      }}
                      className="w-full inline-flex items-center justify-center gap-1 rounded border border-dashed border-gray-300 bg-white py-2 text-xs text-gray-600 hover:border-navy-400 hover:bg-navy-50/50 transition-colors"
                    >
                      <Plus size={12} aria-hidden />
                      항목 추가
                    </button>
                  )}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {appendicesGrouped.all.length === 0 ? (
                    <p className="text-gray-400 py-6 text-center text-xs">등록된 부칙·별표·서식이 없습니다.</p>
                  ) : (
                    (['supplementary', 'annex', 'form'] as AppendixKind[]).map((kind) => {
                      const items = appendicesGrouped[kind];
                      if (!items.length) return null;
                      return (
                        <div key={kind}>
                          <div className="text-[10px] font-semibold text-gray-500 tracking-wide px-0.5 mb-1.5">
                            {appendixKindLabel[kind]}
                          </div>
                          <ul className="space-y-1">
                            {items.map((row: any) => (
                              <li key={row.id}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedAppendixId(row.id)}
                                  className={clsx(
                                    'w-full text-left rounded border px-2 py-1.5 text-xs transition-colors',
                                    selectedAppendixId === row.id
                                      ? 'border-navy-600 bg-navy-50 text-navy-900 font-medium'
                                      : 'border-gray-200 bg-white hover:border-navy-300',
                                  )}
                                >
                                  <span className="line-clamp-2">{row.title || '(제목 없음)'}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })
                  )}
                </div>
                {selectedAppendix && (
                  <div className="border-t border-gray-200 bg-white p-3 max-h-[min(40vh,280px)] overflow-y-auto shrink-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <span className="inline-block text-[10px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                          {appendixKindLabel[selectedAppendix.kind as AppendixKind] || selectedAppendix.kind}
                        </span>
                        <h4 className="text-sm font-semibold text-gray-900 mt-1.5 break-words">
                          {selectedAppendix.title || '(제목 없음)'}
                        </h4>
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            className="btn-secondary text-[11px] py-1 px-2"
                            onClick={() => {
                              setAppendixDraft({
                                kind: selectedAppendix.kind as AppendixKind,
                                title: selectedAppendix.title || '',
                                body: selectedAppendix.body || '',
                                sortOrder:
                                  selectedAppendix.sortOrder != null
                                    ? String(selectedAppendix.sortOrder)
                                    : '',
                              });
                              setAppendixModal({ mode: 'edit', id: selectedAppendix.id });
                            }}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="text-[11px] py-1 px-2 rounded border border-red-200 bg-white text-red-700 hover:bg-red-50"
                            disabled={deleteAppendixMutation.isPending}
                            onClick={() => {
                              if (!window.confirm('이 항목을 삭제할까요?')) return;
                              deleteAppendixMutation.mutate(selectedAppendix.id);
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-[11px] text-gray-800 leading-relaxed">
                      {selectedAppendix.body?.trim() ? selectedAppendix.body : '본문이 없습니다.'}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
        )}
        <div className="min-w-0 space-y-4">
        <div className="shadow-sm border border-gray-300 bg-white rounded-sm overflow-hidden">
          <div className="bg-navy-900 text-white px-5 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-xs bg-navy-700 px-2 py-0.5 rounded text-navy-200">{policy.code}</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${policy.isActive ? 'bg-blue-900 text-blue-200 border-blue-700' : 'bg-gray-700 text-gray-300 border-gray-600'}`}>
                  {policy.isActive ? '시행중' : '비활성'}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setActiveToggleTarget(!policy.isActive)}
                    className="text-[11px] text-navy-300 underline underline-offset-2 hover:text-white"
                  >
                    {policy.isActive ? '비활성으로 변경' : '시행중으로 변경'}
                  </button>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold leading-snug">{policy.title}</h1>
              {policy.description && <p className="text-navy-300 text-sm mt-1">{policy.description}</p>}
              {canEdit && (
                <div className="mt-3 space-y-3 text-xs">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-navy-300">
                      개정일
                      <input
                        type="date"
                        className="input h-8 text-xs mt-0.5 bg-white text-gray-800 block"
                        value={policyRevisionDate}
                        onChange={(e) => setPolicyRevisionDate(e.target.value)}
                      />
                    </label>
                    <label className="text-navy-300">
                      시행일
                      <input
                        type="date"
                        className="input h-8 text-xs mt-0.5 bg-white text-gray-800 block"
                        value={policyEffectiveDate}
                        onChange={(e) => setPolicyEffectiveDate(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded border border-navy-500 bg-navy-700 px-2.5 py-1.5 text-white hover:bg-navy-600 disabled:opacity-50"
                      disabled={savePolicyDatesMutation.isPending}
                      onClick={() => savePolicyDatesMutation.mutate()}
                    >
                      {savePolicyDatesMutation.isPending ? '저장 중…' : '날짜·알림 저장'}
                    </button>
                    {policyDatesMsg ? <span className="text-emerald-300 pb-1">{policyDatesMsg}</span> : null}
                  </div>
                  <div className="rounded-lg border border-navy-600 bg-navy-950/50 p-3 space-y-2">
                    <label className="inline-flex items-center gap-2 text-navy-100 font-medium">
                      <input
                        type="checkbox"
                        checked={revisionNotify.enabled}
                        onChange={(e) =>
                          setRevisionNotify((prev) => ({ ...prev, enabled: e.target.checked }))
                        }
                      />
                      시행 승인 시 알림 발송
                    </label>
                    <p className="text-[11px] text-navy-400 leading-relaxed">
                      예: 정보보안 규정이면 설정에서 만든 <strong className="text-navy-200">알림 팀</strong>과
                      개별 수신자를 지정해 두세요. 조문이 시행 승인되면 선택한 구성원에게 알림이 갑니다.
                    </p>
                    {revisionNotify.enabled && (
                      <div className="grid gap-3 sm:grid-cols-2 pt-1">
                        <div>
                          <div className="text-[11px] text-navy-300 mb-1.5 font-semibold">알림 팀</div>
                          {notifyGroups.length === 0 ? (
                            <p className="text-[11px] text-navy-500">
                              팀이 없습니다.{' '}
                              <Link to="/settings" className="text-gold-400 underline">
                                설정 → 팀원 계정
                              </Link>
                              에서 팀을 만드세요.
                            </p>
                          ) : (
                            <div className="space-y-1 max-h-28 overflow-y-auto">
                              {notifyGroups.map((g) => (
                                <label
                                  key={g.id}
                                  className="flex items-start gap-2 text-navy-200 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-0.5"
                                    checked={revisionNotify.groupIds.includes(g.id)}
                                    onChange={(e) => {
                                      setRevisionNotify((prev) => ({
                                        ...prev,
                                        groupIds: e.target.checked
                                          ? [...prev.groupIds, g.id]
                                          : prev.groupIds.filter((id) => id !== g.id),
                                      }));
                                    }}
                                  />
                                  <span>
                                    {g.name}
                                    <span className="text-navy-500 ml-1">
                                      ({g.members.length}명)
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-[11px] text-navy-300 mb-1.5 font-semibold">개별 수신자</div>
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {tenantUsers.map((u) => (
                              <label
                                key={u.id}
                                className="flex items-start gap-2 text-navy-200 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={revisionNotify.userIds.includes(u.id)}
                                  onChange={(e) => {
                                    setRevisionNotify((prev) => ({
                                      ...prev,
                                      userIds: e.target.checked
                                        ? [...prev.userIds, u.id]
                                        : prev.userIds.filter((id) => id !== u.id),
                                    }));
                                  }}
                                />
                                <span>
                                  {u.name}
                                  <span className="text-navy-500 ml-1">{u.email}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!canEdit && (policy.revisionDate || policy.effectiveDate) && (
                <p className="text-navy-300 text-xs mt-2">
                  {policy.revisionDate ? `개정일 ${formatKoDate(policy.revisionDate)}` : ''}
                  {policy.revisionDate && policy.effectiveDate ? ' · ' : ''}
                  {policy.effectiveDate ? `시행일 ${formatKoDate(policy.effectiveDate)}` : ''}
                </p>
              )}
            </div>
            <div className="flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowAttachmentsModal(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-100 hover:text-white border border-navy-600 rounded-lg px-4 py-2.5 bg-navy-800/80 w-full sm:w-auto justify-center"
              >
                <Paperclip size={14} />
                첨부파일
                {files.length > 0 && <span className="text-navy-200">({files.length})</span>}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-navy-700/80">
            <div
              className="flex flex-1 min-h-[48px] rounded-xl bg-navy-950/60 p-1 border border-navy-600 shadow-inner gap-1"
              role="group"
              aria-label="규정 보기 방식"
            >
              <button
                type="button"
                onClick={() => setArticleViewMode('full')}
                className={clsx(
                  'flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm sm:text-base font-semibold transition-colors',
                  articleViewMode === 'full'
                    ? 'bg-gold-500 text-navy-900 shadow'
                    : 'text-navy-200 hover:bg-navy-800 hover:text-white',
                )}
              >
                <FileText size={18} className="flex-shrink-0" />
                전문 보기
              </button>
              {canUseSegmentMode ? (
                <button
                  type="button"
                  onClick={() => setArticleViewMode('segment')}
                  className={clsx(
                    'flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm sm:text-base font-semibold transition-colors',
                    articleViewMode === 'segment'
                      ? 'bg-gold-500 text-navy-900 shadow'
                      : 'text-navy-200 hover:bg-navy-800 hover:text-white',
                  )}
                >
                  분절 보기
                </button>
              ) : (
                <p className="sr-only">읽기 전용 계정은 전문 보기만 사용할 수 있습니다.</p>
              )}
            </div>
            {canUseTemplateFeature ? (
              templates.length > 0 ? (
                <div className="min-w-[220px]">
                  <label className="sr-only" htmlFor="policy-template-select">적용 양식</label>
                  <select
                    id="policy-template-select"
                    className="input min-h-[48px] bg-white text-sm"
                    value={selectedTemplateId}
                    onChange={async (e) => {
                      const nextId = e.target.value;
                      setSelectedTemplateId(nextId);
                      if (!canEdit) return;
                      try {
                        await policiesApi.update(policy.id, { templateId: nextId || null });
                        qc.invalidateQueries({ queryKey: ['policy', id] });
                      } catch {
                        // keep local switch; next refetch will recover server state
                      }
                    }}
                  >
                    <option value="">기본 양식(자동)</option>
                    {templates.map((row: any) => (
                      <option key={row.id} value={row.id}>
                        {row.name}{row.isDefault ? ' (기본)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="min-h-[48px] inline-flex items-center rounded-xl border border-navy-500/60 bg-navy-900/40 px-3 text-xs text-navy-200">
                  사용 가능한 양식이 없습니다
                </div>
              )
            ) : (
              <button
                type="button"
                className="min-h-[48px] inline-flex items-center rounded-xl border border-navy-500 bg-navy-800/70 px-3 text-xs text-navy-100 hover:bg-navy-700"
                onClick={() => setShowPlanModal(true)}
              >
                템플릿 기능(Pro+)
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setArticleViewMode('full');
                setShowFullTextModal(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-navy-500 bg-navy-800/90 hover:bg-navy-700 text-white px-4 min-h-[48px] text-sm sm:text-base font-medium whitespace-nowrap"
            >
              전체화면 전문
            </button>
          </div>
          </div>
        </div>

      {/* law.go.kr 스타일 확장: 상단 문서 도구줄 */}
      <div className="bg-white border border-gray-300 shadow-sm">
        <div className="px-3 py-2 sm:px-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={16} className="text-slate-600 flex-shrink-0" aria-hidden />
            <span className="text-xs font-semibold text-slate-800">문서 도구</span>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              국가법령정보센터처럼 단계적으로 확장 중입니다.
            </span>
          </div>
          {lawToolMsg ? (
            <span className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
              {lawToolMsg}
            </span>
          ) : null}
        </div>
        <div className="px-3 py-2 sm:px-4 flex flex-wrap items-center gap-2 border-b border-gray-100">
          <label className="sr-only" htmlFor="policy-article-jump">
            조문 선택
          </label>
          <select
            id="policy-article-jump"
            className="input text-xs max-w-[min(100%,18rem)] py-1.5"
            value={selectedArticle?.id || ''}
            onChange={(e) => jumpToArticle(e.target.value)}
          >
            <option value="">조문 선택…</option>
            {flatArticlesForJump.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setArticleViewMode('full');
              setShowFullTextModal(true);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-navy-300 bg-navy-50 text-navy-900 px-2.5 py-1.5 rounded hover:bg-navy-100"
          >
            <FileText size={14} aria-hidden />
            전체화면·인쇄
          </button>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={isExportingPdf}
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} aria-hidden />
            {isExportingPdf ? 'PDF 생성 중…' : 'PDF 저장'}
          </button>
          <button
            type="button"
            onClick={() => void downloadHwpx()}
            disabled={isExportingHwpx}
            title="한/글 2014 이상에서 열리는 .hwpx 로 저장합니다"
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} aria-hidden />
            {isExportingHwpx ? '한/글 생성 중…' : '한/글 .hwpx'}
          </button>
          <button
            type="button"
            onClick={downloadFullTextTxt}
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50"
          >
            <Download size={14} aria-hidden />
            전문 .txt
          </button>
          {files.map((f: any) => (
            <a
              key={f.id || f.url}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50 text-navy-800"
              download={f.originalName}
            >
              <Download size={14} aria-hidden />
              {f.originalName}
            </a>
          ))}
          <button
            type="button"
            onClick={() => void copyPageUrl()}
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50"
          >
            <Share2 size={14} aria-hidden />
            주소 복사
          </button>
          <button
            type="button"
            onClick={openStdKoreanDict}
            className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50"
          >
            <BookOpen size={14} aria-hidden />
            표준국어대사전
          </button>
        </div>
        {/* 시점 조회 — 기준일에 시행 중이던 본문으로 전문을 갈아끼운다 */}
        <div className="px-3 py-2 sm:px-4 flex flex-wrap items-center gap-2 border-b border-gray-100 bg-white">
          <label htmlFor="policy-as-of" className="text-[11px] font-semibold text-slate-700">
            시점 조회
          </label>
          <input
            id="policy-as-of"
            type="date"
            className="input text-xs py-1.5 w-[10.5rem]"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
          {effectiveDates.length > 0 && (
            <select
              className="input text-xs py-1.5 max-w-[12rem]"
              value=""
              onChange={(e) => e.target.value && setAsOfDate(e.target.value)}
              aria-label="본문이 바뀐 시행일로 이동"
            >
              <option value="">개정 시점 선택…</option>
              {effectiveDates.map((d) => (
                <option key={d} value={d}>
                  {d} 시행
                </option>
              ))}
            </select>
          )}
          {asOfDate ? (
            <>
              <button
                type="button"
                onClick={() => setAsOfDate('')}
                className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                현행으로
              </button>
              <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                {isAsOfLoading
                  ? '불러오는 중…'
                  : `${asOfDate} 시점 본문입니다${
                      asOfInfo?.omittedArticles ? ` (그 시점에 없던 조문 ${asOfInfo.omittedArticles}개 제외)` : ''
                    }`}
              </span>
              {asOfInfo && !asOfInfo.hasEffectiveDates ? (
                <span className="text-[11px] text-gray-500">
                  시행일이 기록된 조문 버전이 없어 결과가 비어 있을 수 있습니다.
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[11px] text-gray-500">비워두면 현행 본문을 봅니다.</span>
          )}
        </div>
        <div className="px-3 py-2 sm:px-4 flex flex-wrap gap-1.5 bg-gray-50/80">
          {/* 이미 제공 중인 기능은 해당 패널로 이동시킨다(도구줄에서 '추후 제공'으로 잘못 안내되던 항목) */}
          <button
            type="button"
            onClick={() => {
              setLeftSidebarTab('appendices');
              setTocOpen(true);
            }}
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
          >
            부칙·별표·서식
          </button>
          <button
            type="button"
            onClick={() => {
              setLeftSidebarTab('history');
              setTocOpen(true);
            }}
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
          >
            연혁
          </button>
          <button
            type="button"
            onClick={() => setShowRevisionReasons(true)}
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
          >
            제정·개정이유
          </button>
          <button
            type="button"
            onClick={() => setShowComparison(true)}
            disabled={effectiveDates.length === 0}
            title={
              effectiveDates.length === 0
                ? '시행일이 기록된 개정이 없어 대비할 시점이 없습니다.'
                : undefined
            }
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            신구조문대비표
          </button>
          <button
            type="button"
            onClick={() => setShowThreeWay(true)}
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
          >
            3단비교
          </button>
          <Link
            to="/policies"
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
          >
            규정체계도
          </Link>
          <button
            type="button"
            onClick={() => setShowA11y((v) => !v)}
            aria-expanded={showA11y}
            className="text-[11px] px-2 py-1 rounded border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
          >
            음성지원·접근성
          </button>
          {(
            [
              '규정 간 비교',
            ] as const
          ).map((label) => (
            <button
              key={label}
              type="button"
              disabled
              title="추후 제공 예정 (법령정보센터 수준으로 확장)"
              className="text-[11px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-400 cursor-not-allowed"
            >
              {label}
            </button>
          ))}
        </div>
        {showA11y && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50/70 space-y-2 print:hidden">
            <SpeechControls chunks={speechChunks} label={policy.title} />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              점자 정보 단말은 화면낭독기(NVDA·VoiceOver 등)를 통해 이 화면을 읽습니다.
              별도 뷰어 없이 바로 읽히도록 전문 보기의 각 조문을 표제·본문 구조로 표시하고,
              조·항·목 위치를 낭독용 설명으로 함께 제공합니다.
            </p>
          </div>
        )}
      </div>

      {/* 본문: 전문은 전폭, 분절 보기는 우측 비교 패널만 그리드 */}
      <div className={clsx('grid grid-cols-1 gap-4', articleViewMode === 'segment' && 'lg:grid-cols-12')}>
        {/* 조문 내용 패널 */}
        <div
          className={clsx(
            'bg-white border border-gray-300 shadow-sm',
            articleViewMode === 'segment' && 'lg:col-span-9',
          )}
        >
          {articleViewMode === 'segment' && !selectedArticle ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <FileText size={36} className="mb-2 opacity-20" />
              <p className="text-sm">왼쪽에서 조문을 선택하거나, 상단 &quot;조문 선택&quot;을 이용하세요.</p>
            </div>
          ) : (
            <>
              {articleViewMode === 'segment' && (
                <div className="bg-navy-800 text-white px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {segmentHeading ? (
                      <>
                        <div className="text-sm font-medium">{segmentHeading.joLine}</div>
                        {segmentHeading.subLine ? (
                          <div className="text-xs text-navy-200 mt-0.5">{segmentHeading.subLine}</div>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-sm font-medium">{articleShortLabel(selectedArticle)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedArticle?.hasPrecedent && <RelatedBadge label="판" />}
                    {selectedArticle?.hasRelatedLaw && <RelatedBadge label="법" />}
                    {selectedArticle?.hasRelatedRule && <RelatedBadge label="규" />}
                    {selectedArticle && <RevisionBadge article={selectedArticle} />}
                    {selectedArticle && id && (
                      <FavoriteButton
                        policyId={id}
                        articleId={selectedArticle.id}
                        label={`${policy.title} ${formatArticleAnchor(selectedArticle)}`}
                        className="text-gray-300 hover:text-gold-400"
                      />
                    )}
                    {selectedArticle && (
                      <button
                        onClick={copyArticleLink}
                        title={`이 조문을 가리키는 링크 복사 (${formatArticleAnchor(selectedArticle)})`}
                        className="text-xs bg-navy-700/60 hover:bg-navy-600 px-2.5 py-1.5 rounded flex items-center gap-1"
                      >
                        <LinkIcon size={12} />
                        링크 복사
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={openVersionEditor}
                        className="text-xs bg-navy-600 hover:bg-navy-500 px-3 py-1.5 rounded flex items-center gap-1"
                      >
                        <FileText size={12} />
                        {segmentVersionWorkflow.drafts.length > 0 ? '편집(초안 이어쓰기)' : '편집'}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {articleViewMode === 'segment' && canEdit && selectedArticle && (
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/90">
                  <p className="text-xs font-semibold text-gray-700 mb-2">조·항·목 구조 편집</p>
                  <div className="flex flex-wrap items-end Gap-2">
                    <div className="w-20">
                      <label className="block text-[11px] text-gray-500 mb-1">조 번호</label>
                      <input
                        type="number"
                        min={1}
                        className="input text-sm py-1.5"
                        value={articleMetaDraft.number}
                        onChange={(e) =>
                          setArticleMetaDraft({ ...articleMetaDraft, number: +e.target.value || 1 })
                        }
                      />
                    </div>
                    <div className="w-20">
                      <label className="block text-[11px] text-gray-500 mb-1">항 (선택)</label>
                      <input
                        type="number"
                        min={1}
                        className="input text-sm py-1.5"
                        value={articleMetaDraft.clauseNumber}
                        onChange={(e) =>
                          setArticleMetaDraft({
                            ...articleMetaDraft,
                            clauseNumber: e.target.value ? Number(e.target.value) : '',
                          })
                        }
                      />
                    </div>
                    <div className="w-20">
                      <label className="block text-[11px] text-gray-500 mb-1">목 (선택)</label>
                      <input
                        type="number"
                        min={1}
                        className="input text-sm py-1.5"
                        value={articleMetaDraft.itemNumber}
                        onChange={(e) =>
                          setArticleMetaDraft({
                            ...articleMetaDraft,
                            itemNumber: e.target.value ? Number(e.target.value) : '',
                          })
                        }
                      />
                    </div>
                    <div className="flex-1 min-w-[12rem]">
                      <label className="block text-[11px] text-gray-500 mb-1">
                        {titleFieldLabel({
                          clauseNumber:
                            articleMetaDraft.clauseNumber === ''
                              ? undefined
                              : Number(articleMetaDraft.clauseNumber),
                          itemNumber:
                            articleMetaDraft.itemNumber === ''
                              ? undefined
                              : Number(articleMetaDraft.itemNumber),
                        })}
                      </label>
                      <input
                        className="input text-sm py-1.5"
                        placeholder="비워도 됩니다"
                        value={articleMetaDraft.title}
                        onChange={(e) =>
                          setArticleMetaDraft({ ...articleMetaDraft, title: e.target.value })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => saveArticleMetaMutation.mutate()}
                      disabled={saveArticleMetaMutation.isPending}
                      className="btn-primary text-xs py-1.5 shrink-0"
                    >
                      구조 저장
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2">
                    조 번호를 잘못 입력했을 때 수정할 수 있습니다. 항·목 번호를 비우면 조(條) 본문 행이 됩니다.
                    제목이 1항에 들어간 경우, 항 번호를 비우고 저장하면 조 제목으로 옮길 수 있습니다.
                  </p>
                </div>
              )}
              {articleViewMode === 'segment' && selectedArticle && (segmentVersionWorkflow.drafts.length > 0 || segmentVersionWorkflow.inReview.length > 0) && (
                <div className="px-4 py-3 border-b-2 border-amber-300/90 bg-amber-50 text-xs text-gray-900 space-y-2">
                  <div className="font-semibold text-amber-950 flex flex-wrap items-center gap-2">
                    <Clock size={14} className="text-amber-700 shrink-0" aria-hidden />
                    조문 버전 처리 현황
                  </div>
                  <ul className="space-y-1.5">
                    {segmentVersionWorkflow.drafts.map((v: any) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white px-2.5 py-1.5">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[11px] text-gray-600">v{v.versionNum}</span>
                          <StatusBadge status="draft" />
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => submitMutation.mutate(v.id)}
                            className="text-[11px] text-blue-700 font-medium hover:underline shrink-0 inline-flex items-center gap-1"
                          >
                            <Clock size={12} aria-hidden />
                            검토 요청
                          </button>
                        )}
                      </li>
                    ))}
                    {segmentVersionWorkflow.inReview.map((v: any) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white px-2.5 py-1.5">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[11px] text-gray-600">v{v.versionNum}</span>
                          <StatusBadge status="review" />
                        </span>
                        {user?.role === 'admin' && (
                          <span className="shrink-0 inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                setApproveTargetId(v.id);
                                setApproveNote('');
                              }}
                              className="text-[11px] text-green-800 font-medium hover:underline inline-flex items-center gap-1"
                            >
                              <CheckCircle size={12} aria-hidden />
                              시행 승인
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectTargetId(v.id);
                                setRejectReason('');
                              }}
                              className="text-[11px] text-red-700 font-medium hover:underline inline-flex items-center gap-1"
                            >
                              <Undo2 size={12} aria-hidden />
                              반려
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-amber-900/85">
                    전문·변경 사유는 아래 버전 카드에서 바로 확인할 수 있습니다. (넓은 화면에서는 오른쪽 패널에서 판·법·규와
                    미리보기를 함께 다룹니다.)
                  </p>
                </div>
              )}
              {articleViewMode === 'segment' && selectedArticle && versionActionMsg && (
                <div className="px-4 py-2 border-b border-gray-200 bg-navy-50 flex items-start gap-2" role="status">
                  <p className="text-xs text-navy-900 flex-1">{versionActionMsg}</p>
                  <button
                    type="button"
                    onClick={() => setVersionActionMsg('')}
                    className="text-navy-500 hover:text-navy-800 shrink-0"
                    aria-label="알림 닫기"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {articleViewMode === 'segment' && selectedArticle && (
                <div className="divide-y divide-gray-100 border-b border-gray-200">
                  {versions.length === 0 && (
                    <div className="py-10 text-center text-sm text-gray-400">등록된 버전이 없습니다.</div>
                  )}
                  {versions.map((version: any) => (
                    <div key={version.id} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                            v{version.versionNum}
                          </span>
                          <StatusBadge status={version.status} />
                        </div>
                        <div className="flex items-center gap-2">
                          {version.status === 'draft' && canEdit && (
                            <button
                              onClick={() => submitMutation.mutate(version.id)}
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <Clock size={12} /> 검토 요청
                            </button>
                          )}
                          {version.status === 'review' && user?.role === 'admin' && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setApproveTargetId(version.id);
                                  setApproveNote('');
                                }}
                                className="text-xs text-green-700 hover:underline flex items-center gap-1"
                              >
                                <CheckCircle size={12} /> 시행 승인
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectTargetId(version.id);
                                  setRejectReason('');
                                }}
                                className="text-xs text-red-700 hover:underline flex items-center gap-1"
                              >
                                <Undo2 size={12} /> 반려
                              </button>
                            </>
                          )}
                          {version.status === 'published' && user?.role === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setArchiveTarget(version)}
                              className="text-xs text-gray-500 hover:text-red-700 hover:underline flex items-center gap-1"
                            >
                              <Archive size={12} /> 폐지
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                        <ArticleBodyInline text={version.content} />
                      </div>
                      {version.changeNote && (
                        <p className="text-xs text-gray-400 mt-1.5 italic">변경사유: {version.changeNote}</p>
                      )}
                      {version.status === 'draft' && version.reviewNote && (
                        /* 반려된 초안. 사유가 보이지 않으면 편집자는 같은 내용을 다시 올린다. */
                        <p className="mt-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                          <strong>반려 사유:</strong> {version.reviewNote}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {articleViewMode === 'segment' && (
              <div className="p-4 border-b border-gray-200 bg-amber-50">
                <div className="text-xs font-semibold text-amber-800 mb-2">의견</div>
                <div className="space-y-2 max-h-48 overflow-auto pr-1">
                  {comments.length === 0 && <p className="text-xs text-gray-500">아직 의견이 없습니다.</p>}
                  {comments.map((c: any) => (
                    <div key={c.id} className="bg-white border border-amber-200 rounded px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-gray-600">
                          {c.user?.name || c.user?.email} · {new Date(c.createdAt).toLocaleString('ko-KR')}
                        </div>
                        <span className={clsx('text-[11px] px-2 py-0.5 rounded border', c.isResolved ? 'bg-green-50 text-green-700 border-green-300' : 'bg-yellow-50 text-yellow-700 border-yellow-300')}>
                          {c.isResolved ? '처리완료' : '미처리'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{c.content}</p>
                      {canEdit && (
                        <div className="mt-2 text-right">
                          <button
                            type="button"
                            className="text-xs text-navy-700 hover:underline"
                            onClick={() => resolveCommentMutation.mutate({ id: c.id, isResolved: !c.isResolved })}
                          >
                            {c.isResolved ? '미처리로 되돌리기' : '처리완료로 변경'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="이 조항에 대한 의견을 남겨주세요."
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={!commentDraft.trim() || createCommentMutation.isPending}
                    onClick={() => createCommentMutation.mutate(commentDraft.trim())}
                  >
                    등록
                  </button>
                </div>
              </div>
              )}

              <div className="p-4 border-b border-gray-200 bg-white space-y-4 lg:hidden">
                {articleViewMode === 'segment' && selectedArticle && (
                  <section className="border border-navy-200 rounded bg-slate-50/80 overflow-hidden">
                    <header className="px-3 py-2 bg-navy-800 text-white text-xs font-semibold">판·법·규 · 근거 (모바일)</header>
                    <div className="p-3 space-y-3 text-xs">
                      {canEdit && selectedChapterId && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-gray-800">
                          <span className="font-semibold text-gray-700 w-full">표시</span>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              checked={!!selectedArticle.hasPrecedent}
                              disabled={updateArticleTagsMutation.isPending}
                              onChange={(e) =>
                                updateArticleTagsMutation.mutate({
                                  hasPrecedent: e.target.checked,
                                  hasRelatedLaw: !!selectedArticle.hasRelatedLaw,
                                  hasRelatedRule: !!selectedArticle.hasRelatedRule,
                                })
                              }
                            />
                            <RelatedBadge label="판" />
                            <span>판례</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              checked={!!selectedArticle.hasRelatedLaw}
                              disabled={updateArticleTagsMutation.isPending}
                              onChange={(e) =>
                                updateArticleTagsMutation.mutate({
                                  hasPrecedent: !!selectedArticle.hasPrecedent,
                                  hasRelatedLaw: e.target.checked,
                                  hasRelatedRule: !!selectedArticle.hasRelatedRule,
                                })
                              }
                            />
                            <RelatedBadge label="법" />
                            <span>법령</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              checked={!!selectedArticle.hasRelatedRule}
                              disabled={updateArticleTagsMutation.isPending}
                              onChange={(e) =>
                                updateArticleTagsMutation.mutate({
                                  hasPrecedent: !!selectedArticle.hasPrecedent,
                                  hasRelatedLaw: !!selectedArticle.hasRelatedLaw,
                                  hasRelatedRule: e.target.checked,
                                })
                              }
                            />
                            <RelatedBadge label="규" />
                            <span>규정</span>
                          </label>
                        </div>
                      )}
                      {!canEdit &&
                        (selectedArticle.relatedPrecedentNote ||
                          selectedArticle.relatedLawNote ||
                          selectedArticle.relatedRuleNote) && (
                          <div className="space-y-2 text-sm text-gray-800">
                            <div className="text-[11px] font-semibold text-gray-600">등록된 근거 메모</div>
                            {selectedArticle.relatedPrecedentNote && (
                              <p className="whitespace-pre-wrap border border-gray-200 rounded p-2 bg-white text-[11px]">
                                <span className="font-semibold text-green-800">판</span> {selectedArticle.relatedPrecedentNote}
                              </p>
                            )}
                            {selectedArticle.relatedLawNote && (
                              <p className="whitespace-pre-wrap border border-gray-200 rounded p-2 bg-white text-[11px]">
                                <span className="font-semibold text-green-800">법</span> {selectedArticle.relatedLawNote}
                              </p>
                            )}
                            {selectedArticle.relatedRuleNote && (
                              <p className="whitespace-pre-wrap border border-gray-200 rounded p-2 bg-white text-[11px]">
                                <span className="font-semibold text-green-800">규</span> {selectedArticle.relatedRuleNote}
                              </p>
                            )}
                          </div>
                        )}
                      {canEdit && selectedChapterId && (
                        <div className="space-y-2 border-t border-gray-200 pt-3">
                          <div className="text-[11px] font-semibold text-gray-700">근거 메모</div>
                          <textarea
                            className="input font-mono text-[11px] resize-y min-h-[56px]"
                            value={relationNotesDraft.relatedPrecedentNote}
                            onChange={(e) =>
                              setRelationNotesDraft((d) => ({ ...d, relatedPrecedentNote: e.target.value }))
                            }
                            placeholder="판 — 사건번호·요지"
                          />
                          <textarea
                            className="input font-mono text-[11px] resize-y min-h-[56px]"
                            value={relationNotesDraft.relatedLawNote}
                            onChange={(e) => setRelationNotesDraft((d) => ({ ...d, relatedLawNote: e.target.value }))}
                            placeholder="법 — 법령·조문"
                          />
                          <textarea
                            className="input font-mono text-[11px] resize-y min-h-[56px]"
                            value={relationNotesDraft.relatedRuleNote}
                            onChange={(e) => setRelationNotesDraft((d) => ({ ...d, relatedRuleNote: e.target.value }))}
                            placeholder="규 — 내부 규정 코드"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className="btn-primary text-[11px] py-1"
                              disabled={
                                saveRelationNotesMutation.isPending ||
                                !selectedChapterId ||
                                (relationNotesDraft.relatedPrecedentNote === (selectedArticle.relatedPrecedentNote || '') &&
                                  relationNotesDraft.relatedLawNote === (selectedArticle.relatedLawNote || '') &&
                                  relationNotesDraft.relatedRuleNote === (selectedArticle.relatedRuleNote || ''))
                              }
                              onClick={() => saveRelationNotesMutation.mutate()}
                            >
                              {saveRelationNotesMutation.isPending ? '저장 중…' : '저장'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="border border-gray-200 rounded">
                    <header className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
                      신구 규정 비교표
                    </header>
                    <div className="p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select className="input text-xs" value={compareV1} onChange={(e) => setCompareV1(e.target.value)}>
                          <option value="">기준 버전</option>
                          {versions.map((v: any) => (
                            <option key={v.id} value={v.id}>v{v.versionNum} · {statusLabel[v.status] || v.status}</option>
                          ))}
                        </select>
                        <select className="input text-xs" value={compareV2} onChange={(e) => setCompareV2(e.target.value)}>
                          <option value="">비교 버전</option>
                          {versions.map((v: any) => (
                            <option key={v.id} value={v.id}>v{v.versionNum} · {statusLabel[v.status] || v.status}</option>
                          ))}
                        </select>
                      </div>
                      {compareV1 && compareV2 && compareV1 === compareV2 && (
                        <p className="text-[11px] text-amber-700">서로 다른 버전을 선택해 주세요.</p>
                      )}
                      {isDiffLoading && <p className="text-[11px] text-gray-500">비교 중...</p>}
                      {compareRows.length > 0 && (
                        <div className="max-h-44 overflow-auto border border-gray-200 rounded">
                          <table className="w-full text-[11px]">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left px-2 py-1.5 border-b border-gray-200">이전</th>
                                <th className="text-left px-2 py-1.5 border-b border-gray-200">이후</th>
                              </tr>
                            </thead>
                            <tbody>
                              {compareRows.map((row) => (
                                <tr
                                  key={row.idx}
                                  className={clsx(
                                    row.kind === 'added' && 'bg-green-50',
                                    row.kind === 'deleted' && 'bg-red-50',
                                    row.kind === 'changed' && 'bg-amber-50',
                                  )}
                                >
                                  <td className="px-2 py-1 align-top border-b border-gray-100 text-gray-700">{row.before || '-'}</td>
                                  <td className="px-2 py-1 align-top border-b border-gray-100 text-gray-800">{row.after || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="border border-gray-200 rounded">
                    <header className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
                      개정이유 / 원문 PDF
                    </header>
                    <div className="p-3 space-y-3">
                      <div>
                        <p className="text-[11px] font-semibold text-gray-600 mb-1">최근 개정 사유</p>
                        <div className="space-y-1 max-h-20 overflow-auto">
                          {versions.filter((v: any) => v.changeNote).slice(0, 3).map((v: any) => (
                            <p key={v.id} className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                              <span className="font-semibold mr-1">v{v.versionNum}</span>
                              {v.changeNote}
                            </p>
                          ))}
                          {versions.filter((v: any) => v.changeNote).length === 0 && (
                            <p className="text-[11px] text-gray-500">기록된 개정 사유가 없습니다.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-600 mb-1">원문 PDF 다운로드</p>
                        <div className="space-y-1 max-h-20 overflow-auto">
                          {pdfFiles.slice(0, 4).map((file: any) => (
                            <a
                              key={file.id}
                              href={file.url}
                              className="block text-[11px] text-navy-700 hover:underline truncate"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {file.originalName}
                            </a>
                          ))}
                          {pdfFiles.length === 0 && <p className="text-[11px] text-gray-500">PDF 파일이 없습니다.</p>}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-600 mb-1">개정 이력 타임라인</p>
                        <div className="space-y-1 max-h-24 overflow-auto">
                          {versions.slice(0, 6).map((v: any) => (
                            <p key={v.id} className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                              <span className="font-semibold mr-1">v{v.versionNum}</span>
                              <span className="mr-1">{statusLabel[v.status] || v.status}</span>
                              <span className="text-gray-500">
                                {new Date(v.createdAt).toLocaleDateString('ko-KR')}
                              </span>
                            </p>
                          ))}
                          {versions.length === 0 && <p className="text-[11px] text-gray-500">이력이 없습니다.</p>}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
                <section className="border border-gray-200 rounded">
                  <header className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
                    관련 정보 바로가기
                  </header>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRelatedType('precedent')}
                        className={clsx('px-2 py-1 rounded border text-[11px]', relatedType === 'precedent' ? 'border-green-400 bg-green-50' : 'border-gray-200')}
                      >
                        판
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelatedType('law')}
                        className={clsx('px-2 py-1 rounded border text-[11px]', relatedType === 'law' ? 'border-green-400 bg-green-50' : 'border-gray-200')}
                      >
                        법
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelatedType('rule')}
                        className={clsx('px-2 py-1 rounded border text-[11px]', relatedType === 'rule' ? 'border-green-400 bg-green-50' : 'border-gray-200')}
                      >
                        규
                      </button>
                    </div>
                    {relatedType === 'precedent' && (
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(`site:scourt.go.kr ${relatedQuery}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-[11px] text-navy-700 hover:underline"
                      >
                        대법원 판례 검색으로 이동
                      </a>
                    )}
                    {relatedType === 'law' && (
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(`site:law.go.kr ${relatedQuery}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-[11px] text-navy-700 hover:underline"
                      >
                        국가법령정보 검색으로 이동
                      </a>
                    )}
                    {relatedType === 'rule' && (
                      <Link
                        to={`/search?q=${encodeURIComponent(relatedQuery)}`}
                        className="block text-[11px] text-navy-700 hover:underline"
                      >
                        내부 연관 규정 검색으로 이동
                      </Link>
                    )}
                  </div>
                </section>
              </div>

              {articleViewMode === 'full' && (
                <>
                  <FullViewSearchToolbar
                    inputId="policy-full-view-search"
                    query={fullViewSearchQuery}
                    onQueryChange={setFullViewSearchQuery}
                    matchCount={fullViewMatchCount}
                    activeIndex={fullViewActiveMatchIndex}
                    onScrollFirst={scrollToFirstFullViewHit}
                    onPrev={goToPrevFullViewHit}
                    onNext={goToNextFullViewHit}
                  />
                  <div ref={fullViewMainRef} className="p-4 space-y-3">
                    <TemplateRenderer
                      template={activeTemplate}
                      data={templateRenderData}
                      fullViewGroups={fullViewGroups}
                      highlightQuery={fullViewSearchQuery}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <aside className={clsx('space-y-3', articleViewMode === 'full' ? 'hidden' : 'hidden lg:block lg:col-span-3')}>
          <section className="bg-white border border-gray-300 shadow-sm sticky top-3 flex flex-col min-h-0 max-h-[calc(100vh-7.5rem)]">
            <header className="bg-navy-800 text-white px-3 py-2 text-xs font-semibold shrink-0">
              조문 보조 패널
              <span className="block text-[10px] font-normal text-navy-200 mt-0.5 leading-snug">
                위: 판·법·규 · 근거 · 아래: 비교 · 미리보기 · 고정
              </span>
            </header>
            <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
              {selectedArticle && (
                <div className="shrink-0 border-b border-gray-200 bg-slate-50/90 max-h-[min(42vh,380px)] overflow-y-auto">
                  <div className="px-3 py-2 text-[11px] font-semibold text-gray-800 border-b border-gray-200/80 bg-white">
                    판·법·규 · 근거 메모
                  </div>
                  <div className="p-3 space-y-3 text-xs">
                    {canEdit && selectedChapterId && (
                      <div className="flex flex-col gap-2 border border-amber-100 rounded-md bg-amber-50/40 p-2.5">
                        <span className="font-semibold text-gray-800">목차·본문 배지</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              checked={!!selectedArticle.hasPrecedent}
                              disabled={updateArticleTagsMutation.isPending}
                              onChange={(e) =>
                                updateArticleTagsMutation.mutate({
                                  hasPrecedent: e.target.checked,
                                  hasRelatedLaw: !!selectedArticle.hasRelatedLaw,
                                  hasRelatedRule: !!selectedArticle.hasRelatedRule,
                                })
                              }
                            />
                            <RelatedBadge label="판" />
                            <span>관련 판례</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              checked={!!selectedArticle.hasRelatedLaw}
                              disabled={updateArticleTagsMutation.isPending}
                              onChange={(e) =>
                                updateArticleTagsMutation.mutate({
                                  hasPrecedent: !!selectedArticle.hasPrecedent,
                                  hasRelatedLaw: e.target.checked,
                                  hasRelatedRule: !!selectedArticle.hasRelatedRule,
                                })
                              }
                            />
                            <RelatedBadge label="법" />
                            <span>관련 법령</span>
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300"
                              checked={!!selectedArticle.hasRelatedRule}
                              disabled={updateArticleTagsMutation.isPending}
                              onChange={(e) =>
                                updateArticleTagsMutation.mutate({
                                  hasPrecedent: !!selectedArticle.hasPrecedent,
                                  hasRelatedLaw: !!selectedArticle.hasRelatedLaw,
                                  hasRelatedRule: e.target.checked,
                                })
                              }
                            />
                            <RelatedBadge label="규" />
                            <span>연관 규정</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <details className="rounded border border-gray-200 bg-white px-2.5 py-2 text-[11px] text-gray-700">
                      <summary className="cursor-pointer font-semibold text-gray-800 select-none">판·법·규 안내</summary>
                      <div className="mt-2 space-y-2 leading-relaxed">
                        <p>
                          자동 판별은 하지 않습니다. 배지는 참고 표시이며, 구체적 근거는{' '}
                          <strong>이 패널의 메모</strong>에 적습니다.
                        </p>
                        <p className="text-gray-600">
                          아래 미리보기는 규정명·조문 제목 등으로 만든 검색어 기반 참고 링크입니다.
                        </p>
                      </div>
                    </details>
                    {!canEdit &&
                      (selectedArticle.relatedPrecedentNote ||
                        selectedArticle.relatedLawNote ||
                        selectedArticle.relatedRuleNote) && (
                        <div className="space-y-2 text-sm text-gray-800">
                          <div className="text-[11px] font-semibold text-gray-600">등록된 근거 메모</div>
                          {selectedArticle.relatedPrecedentNote && (
                            <div>
                              <div className="text-[11px] font-semibold text-green-800 mb-0.5">판</div>
                              <p className="whitespace-pre-wrap text-[11px] border border-gray-200 rounded p-2 bg-white">
                                {selectedArticle.relatedPrecedentNote}
                              </p>
                            </div>
                          )}
                          {selectedArticle.relatedLawNote && (
                            <div>
                              <div className="text-[11px] font-semibold text-green-800 mb-0.5">법</div>
                              <p className="whitespace-pre-wrap text-[11px] border border-gray-200 rounded p-2 bg-white">
                                {selectedArticle.relatedLawNote}
                              </p>
                            </div>
                          )}
                          {selectedArticle.relatedRuleNote && (
                            <div>
                              <div className="text-[11px] font-semibold text-green-800 mb-0.5">규</div>
                              <p className="whitespace-pre-wrap text-[11px] border border-gray-200 rounded p-2 bg-white">
                                {selectedArticle.relatedRuleNote}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    {canEdit && selectedChapterId && (
                      <div className="space-y-2 border border-gray-200 rounded-md bg-white p-2.5">
                        <div className="text-[11px] font-semibold text-gray-700">근거 메모 (선택)</div>
                        <textarea
                          className="input font-mono text-[11px] resize-y min-h-[64px]"
                          value={relationNotesDraft.relatedPrecedentNote}
                          onChange={(e) =>
                            setRelationNotesDraft((d) => ({ ...d, relatedPrecedentNote: e.target.value }))
                          }
                          placeholder="판 — 사건번호·요지"
                        />
                        <textarea
                          className="input font-mono text-[11px] resize-y min-h-[64px]"
                          value={relationNotesDraft.relatedLawNote}
                          onChange={(e) => setRelationNotesDraft((d) => ({ ...d, relatedLawNote: e.target.value }))}
                          placeholder="법 — 법령·조문"
                        />
                        <textarea
                          className="input font-mono text-[11px] resize-y min-h-[64px]"
                          value={relationNotesDraft.relatedRuleNote}
                          onChange={(e) => setRelationNotesDraft((d) => ({ ...d, relatedRuleNote: e.target.value }))}
                          placeholder="규 — 내부 규정 코드"
                        />
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            className="btn-primary text-[11px] py-1.5"
                            disabled={
                              saveRelationNotesMutation.isPending ||
                              !selectedChapterId ||
                              (relationNotesDraft.relatedPrecedentNote === (selectedArticle.relatedPrecedentNote || '') &&
                                relationNotesDraft.relatedLawNote === (selectedArticle.relatedLawNote || '') &&
                                relationNotesDraft.relatedRuleNote === (selectedArticle.relatedRuleNote || ''))
                            }
                            onClick={() => saveRelationNotesMutation.mutate()}
                          >
                            {saveRelationNotesMutation.isPending ? '저장 중…' : '근거 메모 저장'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="p-3 space-y-3 flex-1 min-h-0 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700">고정된 결과(Pin)</p>
                  {pinnedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPinnedItems([])}
                      className="text-[11px] text-gray-500 hover:text-gray-700 underline"
                    >
                      전체 해제
                    </button>
                  )}
                </div>
                <div className="space-y-1 max-h-28 overflow-auto">
                  {pinnedItems.map((item, idx) => (
                    <div key={`${item.title}-${idx}`} className="border border-gray-200 rounded px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const foundIdx = relatedItems.findIndex(
                              (r: any) => r.title === item.title && (r.url || '') === (item.url || ''),
                            );
                            if (foundIdx >= 0) setRelatedDetailIndex(foundIdx);
                          }}
                          className="text-[11px] text-gray-800 font-semibold truncate text-left"
                        >
                          <span className="inline-flex items-center rounded border border-green-300 bg-green-50 text-green-700 px-1.5 py-0.5 mr-1">
                            {item.type === 'precedent' ? '판' : item.type === 'law' ? '법' : '규'}
                          </span>
                          {item.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => togglePin(item, item.type)}
                          className="text-[11px] text-gray-500 hover:text-gray-700"
                        >
                          해제
                        </button>
                      </div>
                    </div>
                  ))}
                  {pinnedItems.length === 0 && (
                    <p className="text-[11px] text-gray-500">고정된 결과가 없습니다.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-700">신구 규정 비교표</p>
                  <div className="inline-flex rounded border border-gray-300 overflow-hidden text-[11px]">
                    <button
                      type="button"
                      onClick={() => setDiffViewMode('line')}
                      className={clsx('px-2 py-0.5', diffViewMode === 'line' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600')}
                    >
                      라인
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiffViewMode('word')}
                      className={clsx('px-2 py-0.5 border-l border-gray-300', diffViewMode === 'word' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600')}
                    >
                      문장(diffWords)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select className="input text-xs" value={compareV1} onChange={(e) => setCompareV1(e.target.value)}>
                    <option value="">기준 버전</option>
                    {versions.map((v: any) => (
                      <option key={v.id} value={v.id}>v{v.versionNum}</option>
                    ))}
                  </select>
                  <select className="input text-xs" value={compareV2} onChange={(e) => setCompareV2(e.target.value)}>
                    <option value="">비교 버전</option>
                    {versions.map((v: any) => (
                      <option key={v.id} value={v.id}>v{v.versionNum}</option>
                    ))}
                  </select>
                </div>
                {isDiffLoading && <p className="text-[11px] text-gray-500">비교 중...</p>}
                {diffViewMode === 'line' && compareRows.length > 0 && (
                  <div className="max-h-56 overflow-auto border border-gray-200 rounded">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {compareRows.map((row) => (
                          <tr key={row.idx} className={clsx(row.kind === 'added' && 'bg-green-50', row.kind === 'deleted' && 'bg-red-50', row.kind === 'changed' && 'bg-amber-50')}>
                            <td className="px-2 py-1 border-b border-gray-100 align-top text-gray-700">{row.before || '-'}</td>
                            <td className="px-2 py-1 border-b border-gray-100 align-top text-gray-800">{row.after || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {diffViewMode === 'word' && Array.isArray(diffResult?.changes) && (
                  <div className="max-h-56 overflow-auto border border-gray-200 rounded p-2 text-xs leading-5">
                    {diffResult.changes.map((c: any, idx: number) => (
                      <span
                        key={idx}
                        className={clsx(
                          c.added && 'bg-green-100 text-green-900',
                          c.removed && 'bg-red-100 text-red-900 line-through',
                        )}
                      >
                        {c.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-1">판/법/규 미리보기 API</p>
                <div className="inline-flex rounded border border-gray-300 overflow-hidden text-[11px] mb-2">
                  <button
                    type="button"
                    onClick={() => setRelatedSort('relevance')}
                    className={clsx('px-2 py-0.5', relatedSort === 'relevance' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600')}
                  >
                    관련도순
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelatedSort('latest')}
                    className={clsx('px-2 py-0.5 border-l border-gray-300', relatedSort === 'latest' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600')}
                  >
                    최신순
                  </button>
                </div>
                <div className="inline-flex rounded border border-gray-300 overflow-hidden text-[11px] mb-2 ml-2">
                  <button
                    type="button"
                    onClick={() => setRelatedScope('title')}
                    className={clsx('px-2 py-0.5', relatedScope === 'title' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600')}
                  >
                    제목만
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelatedScope('fulltext')}
                    className={clsx('px-2 py-0.5 border-l border-gray-300', relatedScope === 'fulltext' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600')}
                  >
                    본문포함
                  </button>
                </div>
                <div className="flex items-center gap-1 mb-2">
                  <button type="button" onClick={() => setRelatedType('precedent')} className={clsx('px-2 py-0.5 rounded border text-[11px]', relatedType === 'precedent' ? 'border-green-400 bg-green-50' : 'border-gray-200')}>판</button>
                  <button type="button" onClick={() => setRelatedType('law')} className={clsx('px-2 py-0.5 rounded border text-[11px]', relatedType === 'law' ? 'border-green-400 bg-green-50' : 'border-gray-200')}>법</button>
                  <button type="button" onClick={() => setRelatedType('rule')} className={clsx('px-2 py-0.5 rounded border text-[11px]', relatedType === 'rule' ? 'border-green-400 bg-green-50' : 'border-gray-200')}>규</button>
                </div>
                <div className="mb-2">
                  <label className="sr-only" htmlFor="related-custom-query">직접 검색어</label>
                  <input
                    id="related-custom-query"
                    className="input text-[11px]"
                    value={relatedCustomQuery}
                    onChange={(e) => setRelatedCustomQuery(e.target.value)}
                    placeholder="직접 검색어 입력(예: 개인정보 보호 동의 철회 판례)"
                  />
                  <p className="mt-1 text-[10px] text-gray-500">
                    규정번호는 자동 제외됩니다. 비워두면 현재 조항 제목/근거메모로 자동 검색합니다.
                  </p>
                </div>
                {isRelatedLoading && <p className="text-[11px] text-gray-500">미리보기 조회 중...</p>}
                <div className="space-y-1 max-h-48 overflow-auto">
                  {relatedItems.map((item: any, idx: number) => (
                    <div
                      key={`${item.title}-${idx}`}
                      className="block w-full text-left border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                    >
                      {(() => {
                        const previewKey = `${relatedType}:${item.title}:${item.url || idx}`;
                        const expanded = !!expandedPreviewMap[previewKey];
                        const rawSnippet = String(item.snippet || '-');
                        const collapsedSnippet =
                          rawSnippet.length > 140 ? `${rawSnippet.slice(0, 140)}...` : rawSnippet;
                        const displaySnippet = expanded ? rawSnippet : collapsedSnippet;
                        return (
                          <>
                      <button type="button" onClick={() => setRelatedDetailIndex(idx)} className="w-full text-left">
                        <p className="text-[11px] text-gray-800 font-semibold truncate flex items-center gap-1.5">
                          <span className="inline-flex items-center rounded border border-green-300 bg-green-50 text-green-700 px-1.5 py-0.5">
                            {relatedType === 'precedent' ? '판' : relatedType === 'law' ? '법' : '규'}
                          </span>
                          {highlightText(item.title, relatedSearchKeyword)}
                        </p>
                        <p className="text-[11px] text-gray-600">{highlightText(displaySnippet, relatedSearchKeyword)}</p>
                      </button>
                      {rawSnippet.length > 140 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPreviewMap((prev) => ({ ...prev, [previewKey]: !expanded }))
                          }
                          className="text-[11px] text-navy-700 hover:underline mt-0.5"
                        >
                          {expanded ? '접기' : '더보기'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => togglePin(item, relatedType)}
                        className="mt-1 inline-flex text-[11px] text-gray-500 hover:text-gray-700 underline"
                      >
                        {isPinned(item, relatedType) ? '고정 해제' : '결과 고정'}
                      </button>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {relatedItems.length === 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-gray-500">표시할 미리보기 결과가 없습니다.</p>
                      {recommendedQueries.length > 0 && (
                        <div className="text-[11px] text-gray-600">
                          <p className="mb-1">추천 검색어</p>
                          <div className="flex flex-wrap gap-1">
                            {recommendedQueries.map((row) =>
                              row.external ? (
                                <button
                                  key={row.label}
                                  type="button"
                                  onClick={() => window.open(row.href, '_blank')}
                                  className="px-2 py-0.5 border border-gray-300 rounded bg-white hover:bg-gray-50"
                                >
                                  {row.label}
                                </button>
                              ) : (
                                <Link
                                  key={row.label}
                                  to={row.href}
                                  className="px-2 py-0.5 border border-gray-300 rounded bg-white hover:bg-gray-50 inline-block"
                                >
                                  {row.label}
                                </Link>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
      </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadMutation.mutate(file);
          e.target.value = '';
        }}
      />

      {showFullTextModal && (
        <div className="printable-policy-modal fixed inset-0 z-50 bg-black/60 p-2 sm:p-4 print:bg-white print:p-0">
          <div className="mx-auto h-full w-full max-w-6xl bg-white border border-gray-300 shadow-xl flex flex-col print:max-w-none print:h-auto print:min-h-0 print:border-0 print:shadow-none">
            <div className="bg-navy-900 text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-2 print:hidden">
              <div className="min-w-0">
                <div className="text-xs text-navy-200">전체화면 전문 보기</div>
                <h2 className="text-sm sm:text-base font-semibold truncate" title={policy.title}>
                  {policy.title}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm"
                >
                  인쇄
                </button>
                <button
                  type="button"
                  onClick={() => setShowFullTextModal(false)}
                  className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm inline-flex items-center gap-1"
                  aria-label="닫기"
                >
                  <X size={14} />
                  닫기
                </button>
              </div>
            </div>
            <div className="px-4 sm:px-6 py-4 overflow-auto print:overflow-visible print:p-0 print:min-h-0">
              <div className="hidden print:block border-b border-gray-300 pb-3 mb-4">
                <h2 className="text-xl font-bold text-gray-900">{policy.title}</h2>
                <p className="text-sm text-gray-600 mt-1">
                  출력일: {new Date().toLocaleDateString('ko-KR')}
                  {printSelection.size > 0 && ` · 선택 조문 ${printSelection.size}건만 출력 (전문 아님)`}
                </p>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs print:hidden">
                <button
                  type="button"
                  onClick={() => setSelectMode((v) => !v)}
                  className={clsx(
                    'px-2.5 py-1 rounded border',
                    selectMode
                      ? 'border-navy-600 bg-navy-700 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {selectMode ? '조문 선택 중' : '조문 선택'}
                </button>
                {printSelection.size > 0 ? (
                  <>
                    <span className="text-navy-800 font-medium">
                      선택 {printSelection.size}개 조문만 표시·인쇄합니다
                    </span>
                    <button
                      type="button"
                      onClick={() => setPrintSelection(new Set())}
                      className="underline text-gray-600"
                    >
                      전체로 되돌리기
                    </button>
                  </>
                ) : (
                  <span className="text-gray-500">
                    전체 조문을 인쇄합니다. 좌측 목차에서 조문을 고르면 그 조만 인쇄됩니다.
                  </span>
                )}
                {selectMode && (
                  <button
                    type="button"
                    onClick={() => setPrintSelection(new Set(allJoNumbers))}
                    className="underline text-gray-600"
                  >
                    전체 선택
                  </button>
                )}
              </div>
              <FullViewSearchToolbar
                inputId="policy-full-view-search-modal"
                query={fullViewSearchQuery}
                onQueryChange={setFullViewSearchQuery}
                matchCount={fullViewMatchCount}
                activeIndex={fullViewActiveMatchIndex}
                onScrollFirst={scrollToFirstFullViewHit}
                onPrev={goToPrevFullViewHit}
                onNext={goToNextFullViewHit}
              />
              <div ref={fullViewModalRef} className="space-y-3">
                <TemplateRenderer
                  template={activeTemplate}
                  data={templateRenderData}
                  fullViewGroups={printableGroups}
                  highlightQuery={fullViewSearchQuery}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {showThreeWay && id && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-auto">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-6xl my-8">
            <div className="bg-navy-800 text-white px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium">3단비교 — 규정 · 세칙 · 지침</span>
              <button
                type="button"
                onClick={() => setShowThreeWay(false)}
                className="text-white/80 hover:text-white text-sm"
              >
                닫기
              </button>
            </div>
            <div className="p-4">
              <ThreeWayComparePanel policyId={id} />
            </div>
          </div>
        </div>
      )}

      {showComparison && id && (
        <ComparisonTableModal
          policyId={id}
          effectiveDates={effectiveDates}
          onClose={() => setShowComparison(false)}
        />
      )}

      {showRevisionReasons && id && (
        <RevisionReasonsModal
          policyId={id}
          policy={policy}
          canEdit={canEdit}
          onClose={() => setShowRevisionReasons(false)}
        />
      )}

      {showAttachmentsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-lg">
            <div className="bg-navy-800 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Paperclip size={16} />
                첨부파일 확인
              </div>
              <button type="button" className="text-navy-200 hover:text-white p-1" onClick={() => setShowAttachmentsModal(false)} aria-label="닫기">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {fileError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{fileError}</div>}
              {files.length === 0 ? (
                <p className="text-sm text-gray-500">등록된 첨부파일이 없습니다.</p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-auto">
                  {files.map((file: any) => {
                    const removing =
                      deleteFileMutation.isPending && deleteFileMutation.variables === file.id;
                    return (
                      <li key={file.id} className="flex items-start justify-between gap-2 border border-gray-200 rounded px-3 py-2 text-sm">
                        <a href={file.url} target="_blank" rel="noreferrer" className="text-navy-700 hover:underline break-all min-w-0">
                          {file.originalName}
                        </a>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-gray-500">{formatSize(file.size)}</span>
                          {canEdit && (
                            <button
                              type="button"
                              // 되돌릴 수 없다. 어느 파일인지 이름으로 확인시킨다.
                              onClick={() => {
                                if (!window.confirm(`「${file.originalName}」을(를) 삭제할까요?\n되돌릴 수 없습니다.`)) return;
                                deleteFileMutation.mutate(file.id);
                              }}
                              disabled={deleteFileMutation.isPending}
                              className="text-gray-400 hover:text-red-600 disabled:opacity-40 p-1"
                              aria-label={`${file.originalName} 삭제`}
                              title="삭제"
                            >
                              {removing ? <span className="text-xs">삭제 중…</span> : <Trash2 size={14} />}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canEdit && (
                <div className="flex gap-2 pt-1 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                    className="btn-primary text-sm py-1.5 inline-flex items-center gap-1"
                  >
                    <Upload size={14} />
                    {uploadMutation.isPending ? '업로드 중...' : '파일 추가'}
                  </button>
                  <button type="button" className="btn-secondary text-sm py-1.5" onClick={() => setShowAttachmentsModal(false)}>
                    닫기
                  </button>
                </div>
              )}
              {!canEdit && (
                <button type="button" className="btn-secondary text-sm py-1.5 w-full" onClick={() => setShowAttachmentsModal(false)}>
                  닫기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 조 추가 모달 */}
      {newArticle && canEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">조문 추가</div>
            <div className="p-5 space-y-4">
              <div className="flex gap-3">
                <div className="w-28">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">조 번호</label>
                  <input type="number" className="input" min={1}
                    value={newArticle.number}
                    onChange={(e) => setNewArticle({ ...newArticle, number: +e.target.value })} />
                </div>
                <div className="w-24">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">항 (선택)</label>
                  <p className="text-[10px] text-gray-400 mb-1">표기: ① ② …</p>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={newArticle.clauseNumber ?? ''}
                    onChange={(e) => setNewArticle({
                      ...newArticle,
                      clauseNumber: e.target.value ? Number(e.target.value) : undefined,
                    })}
                  />
                </div>
                <div className="w-24">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">목 (선택)</label>
                  <p className="text-[10px] text-gray-400 mb-1">표기: 1. 2. …</p>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={newArticle.itemNumber ?? ''}
                    onChange={(e) => setNewArticle({
                      ...newArticle,
                      itemNumber: e.target.value ? Number(e.target.value) : undefined,
                    })}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    {titleFieldLabel(newArticle)}
                  </label>
                  <input
                    className="input"
                    placeholder={
                      newArticle.clauseNumber != null || newArticle.itemNumber != null
                        ? '항·목은 보통 제목 없이 본문만 입력'
                        : '예) 목적, 정의, 적용범위'
                    }
                    value={newArticle.title}
                    onChange={(e) => setNewArticle({ ...newArticle, title: e.target.value })}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    {(() => {
                      const ch = policy?.chapters?.find((c: any) => c.id === newArticle.chapterId);
                      const arts = ch?.articles || [];
                      let hint = titleFieldHint(newArticle);
                      if (
                        newArticle.clauseNumber != null &&
                        !chapterHasJoRoot(arts, newArticle.number) &&
                        newArticle.title.trim()
                      ) {
                        hint += ` 입력한 제목은 ${formatArticleJo(newArticle.number)} 제목으로 저장됩니다.`;
                      }
                      return hint;
                   })()}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">관련 정보 배지</p>
                <div className="flex items-center gap-3 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={newArticle.hasPrecedent}
                      onChange={(e) => setNewArticle({ ...newArticle, hasPrecedent: e.target.checked })}
                    />
                    <RelatedBadge label="판" />
                    <span className="text-gray-600">관련 판례</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={newArticle.hasRelatedLaw}
                      onChange={(e) => setNewArticle({ ...newArticle, hasRelatedLaw: e.target.checked })}
                    />
                    <RelatedBadge label="법" />
                    <span className="text-gray-600">관련 법령</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={newArticle.hasRelatedRule}
                      onChange={(e) => setNewArticle({ ...newArticle, hasRelatedRule: e.target.checked })}
                    />
                    <RelatedBadge label="규" />
                    <span className="text-gray-600">연관 규정</span>
                  </label>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">
                  배지는 표시용입니다. 사건번호·법령·규정명은 아래 메모에 적을 수 있습니다.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                <label className="block text-xs text-gray-600">
                  <span className="font-semibold text-gray-700">근거 메모 · 판</span>
                  <textarea
                    className="input font-mono text-xs resize-y min-h-[56px] mt-1"
                    value={newArticle.relatedPrecedentNote}
                    onChange={(e) => setNewArticle({ ...newArticle, relatedPrecedentNote: e.target.value })}
                    placeholder="선택 — 예) 대법원 …"
                  />
                </label>
                <label className="block text-xs text-gray-600">
                  <span className="font-semibold text-gray-700">근거 메모 · 법</span>
                  <textarea
                    className="input font-mono text-xs resize-y min-h-[56px] mt-1"
                    value={newArticle.relatedLawNote}
                    onChange={(e) => setNewArticle({ ...newArticle, relatedLawNote: e.target.value })}
                    placeholder="선택 — 예) ○○법 제○조 …"
                  />
                </label>
                <label className="block text-xs text-gray-600">
                  <span className="font-semibold text-gray-700">근거 메모 · 규</span>
                  <textarea
                    className="input font-mono text-xs resize-y min-h-[56px] mt-1"
                    value={newArticle.relatedRuleNote}
                    onChange={(e) => setNewArticle({ ...newArticle, relatedRuleNote: e.target.value })}
                    placeholder="선택 — 예) POL-xxx …"
                  />
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  초기 내용 {newArticle.clauseNumber != null || newArticle.itemNumber != null ? '' : '(선택)'}
                </label>
                <textarea
                  className="input resize-none"
                  rows={4}
                  placeholder={
                    newArticle.clauseNumber != null || newArticle.itemNumber != null
                      ? '항·목 본문을 입력하세요. (제목 없이 저장 가능)'
                      : '조문의 초기 내용을 입력하세요.'
                  }
                  value={newArticle.content}
                  onChange={(e) => setNewArticle({ ...newArticle, content: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => addArticleMutation.mutate(newArticle)}
                  disabled={!canSubmitNewArticleForm(newArticle) || addArticleMutation.isPending}
                  className="btn-primary"
                >
                  추가
                </button>
                <button type="button" onClick={() => setNewArticle(null)} className="btn-secondary">취소</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVersionEditor && canEdit && selectedArticle && articleViewMode === 'segment' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="bg-navy-800 text-white px-5 py-3 flex items-center justify-between">
              <div className="text-sm font-medium">
                조문 편집 · {articleShortLabel(selectedArticle)} ({selectedArticle.title})
              </div>
              <button
                type="button"
                className="text-navy-100 hover:text-white"
                onClick={() => {
                  setShowVersionEditor(false);
                  setEditingDraftVersionId(null);
                }}
                aria-label="편집 창 닫기"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-700">개정 사유 선택 (초안)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-gray-500 mb-1">내부 요인</p>
                    <div className="space-y-1">
                      {INTERNAL_REVISION_REASONS.map((reason) => (
                        <label key={reason} className="flex items-center gap-1.5 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={revisionInternalReasons.includes(reason)}
                            onChange={(e) => {
                              setRevisionInternalReasons((prev) =>
                                e.target.checked ? [...prev, reason] : prev.filter((r) => r !== reason),
                              );
                            }}
                          />
                          {reason}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500 mb-1">외부 요인</p>
                    <div className="space-y-1">
                      {EXTERNAL_REVISION_REASONS.map((reason) => (
                        <label key={reason} className="flex items-center gap-1.5 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={revisionExternalReasons.includes(reason)}
                            onChange={(e) => {
                              setRevisionExternalReasons((prev) =>
                                e.target.checked ? [...prev, reason] : prev.filter((r) => r !== reason),
                              );
                            }}
                          />
                          {reason}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1.5"
                    onClick={() => setVersionChangeNote(draftRevisionReasonText)}
                    disabled={!draftRevisionReasonText}
                  >
                    자동 개정문안 생성
                  </button>
                  <span className="text-[11px] text-gray-500">
                    선택한 사유를 바탕으로 개정 사유 문안을 자동 생성합니다.
                  </span>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">개정 사유</span>
                  <textarea
                    className="input resize-none text-sm mt-1"
                    rows={3}
                    placeholder="예: 법령 개정 및 내부 통제 개선 사항 반영"
                    value={versionChangeNote}
                    onChange={(e) => setVersionChangeNote(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-col gap-1.5 mb-1.5">
                <span className="text-xs font-medium text-gray-600">조문 내용</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1"
                    onClick={() =>
                      setVersionContent(String(selectedArticle?.versions?.[0]?.content || '').trim())
                    }
                  >
                    게시 본문 불러오기
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1"
                    onClick={() => setVersionContent(buildFullAutoDraftBody())}
                  >
                    본문 초안 자동 생성
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs py-1"
                    onClick={applySearchRefsToDraft}
                    disabled={!pinnedItems.length && !relatedItems.length && !relatedQuery.trim()}
                  >
                    검색·미리보기 반영
                  </button>
                </div>
              </div>
              <textarea
                className="input resize-none text-sm"
                rows={10}
                placeholder="조문 내용을 입력하세요..."
                value={versionContent}
                onChange={(e) => setVersionContent(e.target.value)}
              />
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    requestReviewMutation.mutate({
                      content: versionContent,
                      changeNote: versionChangeNote.trim() || undefined,
                    })
                  }
                  disabled={!versionContent.trim() || requestReviewMutation.isPending}
                  className="btn-primary"
                >
                  <Clock size={14} className="inline mr-1" />
                  검토 요청
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowVersionEditor(false);
                    setEditingDraftVersionId(null);
                  }}
                  className="btn-secondary"
                >
                  취소
                </button>
                {editingDraftVersionId && (
                  <span className="text-[11px] text-gray-500 self-center">
                    기존 초안을 수정 후 요청합니다.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {appendixModal && canEdit && id && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
              {appendixModal.mode === 'create' ? '부칙·별표·서식 추가' : '부칙·별표·서식 수정'}
            </div>
            <div className="p-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">구분</label>
                  <select
                    className="input text-sm"
                    value={appendixDraft.kind}
                    onChange={(e) =>
                      setAppendixDraft((d) => ({ ...d, kind: e.target.value as AppendixKind }))
                    }
                  >
                    <option value="supplementary">{appendixKindLabel.supplementary}</option>
                    <option value="annex">{appendixKindLabel.annex}</option>
                    <option value="form">{appendixKindLabel.form}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">정렬 순서 (선택)</label>
                  <input
                    type="number"
                    className="input text-sm"
                    min={0}
                    placeholder="비우면 0"
                    value={appendixDraft.sortOrder}
                    onChange={(e) => setAppendixDraft((d) => ({ ...d, sortOrder: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">제목</label>
                <input
                  className="input text-sm"
                  placeholder="예) 부칙, 별표 1, 서식 제1호"
                  value={appendixDraft.title}
                  onChange={(e) => setAppendixDraft((d) => ({ ...d, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">본문</label>
                <textarea
                  className="input text-sm font-mono resize-y min-h-[200px]"
                  placeholder="전문 또는 표 형태를 평문으로 입력하세요."
                  value={appendixDraft.body}
                  onChange={(e) => setAppendixDraft((d) => ({ ...d, body: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    !appendixDraft.title.trim() ||
                    createAppendixMutation.isPending ||
                    updateAppendixMutation.isPending
                  }
                  onClick={() => {
                    const title = appendixDraft.title.trim();
                    if (!title) return;
                    const sortOrder =
                      appendixDraft.sortOrder.trim() === ''
                        ? undefined
                        : Math.max(0, Math.floor(Number(appendixDraft.sortOrder)) || 0);
                    const payload = {
                      kind: appendixDraft.kind,
                      title,
                      body: appendixDraft.body,
                      sortOrder,
                    };
                    if (appendixModal.mode === 'create') {
                      createAppendixMutation.mutate(payload);
                    } else {
                      updateAppendixMutation.mutate({ appendixId: appendixModal.id, payload });
                    }
                  }}
                >
                  저장
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAppendixModal(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {approveTargetId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">시행 승인</div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">개정·시행 사유</label>
                <textarea
                  className="input resize-none w-full"
                  rows={4}
                  placeholder="승인 시 기록될 사유를 입력하세요."
                  value={approveNote}
                  onChange={(e) => setApproveNote(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="approve-effective-date">
                  시행일
                </label>
                <input
                  id="approve-effective-date"
                  type="date"
                  className="input w-full"
                  value={approveEffectiveDate}
                  onChange={(e) => setApproveEffectiveDate(e.target.value)}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  비워두면 오늘로 기록됩니다. 이 날짜가 <strong>시점 조회</strong>의 기준이 됩니다.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const note = approveNote.trim();
                    if (!note) return;
                    approveMutation.mutate({
                      id: approveTargetId,
                      changeNote: note,
                      effectiveDate: approveEffectiveDate || undefined,
                    });
                  }}
                  disabled={!approveNote.trim() || approveMutation.isPending}
                  className="btn-primary"
                >
                  승인
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApproveTargetId(null);
                    setApproveNote('');
                  }}
                  className="btn-secondary"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {relatedDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-2xl">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">관련 정보 상세 보기</div>
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <span className="inline-flex items-center rounded border border-green-300 bg-green-50 text-green-700 px-1.5 py-0.5 text-[11px]">
                    {relatedType === 'precedent' ? '판' : relatedType === 'law' ? '법' : '규'}
                  </span>
                  {highlightText(relatedDetail.title, relatedSearchKeyword)}
                </h3>
                {relatedItems.length > 1 && (
                  <div className="text-xs text-gray-500">{(relatedDetailIndex ?? 0) + 1} / {relatedItems.length}</div>
                )}
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 border border-gray-200 rounded p-3 max-h-80 overflow-auto">
                {highlightText(relatedDetail.snippet || '미리보기 본문이 없습니다.', relatedSearchKeyword)}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => togglePin(relatedDetail, relatedType)}
                  className="btn-secondary"
                >
                  {isPinned(relatedDetail, relatedType) ? '고정 해제' : '결과 고정'}
                </button>
                <button
                  type="button"
                  onClick={() => setRelatedDetailIndex((prev) => (prev === null ? null : Math.max(0, prev - 1)))}
                  disabled={relatedDetailIndex === null || relatedDetailIndex <= 0}
                  className="btn-secondary"
                >
                  이전 결과
                </button>
                <button
                  type="button"
                  onClick={() => setRelatedDetailIndex((prev) => (prev === null ? null : Math.min(relatedItems.length - 1, prev + 1)))}
                  disabled={relatedDetailIndex === null || relatedDetailIndex >= relatedItems.length - 1}
                  className="btn-secondary"
                >
                  다음 결과
                </button>
                {relatedDetail.url && (
                  relatedDetail.url.startsWith('http') ? (
                    <a
                      href={relatedDetail.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary"
                    >
                      원문 열기
                    </a>
                  ) : (
                    <Link to={relatedDetail.url} className="btn-primary">
                      내부 문서 열기
                    </Link>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setRelatedDetailIndex(null)}
                  className="btn-secondary"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showPlanModal && <PlanModal onClose={() => setShowPlanModal(false)} />}
      {activeToggleTarget !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
              {activeToggleTarget ? '시행중으로 변경' : '비활성으로 변경'}
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">
                <span className="font-medium">{policy.title}</span> 을(를){' '}
                <strong>{activeToggleTarget ? '시행중' : '비활성'}</strong> 으로 표시할까요?
              </p>
              {/* "비활성 = 안 보이게 됨"으로 읽기 쉽다. 실제로 무엇이 바뀌는지 적어 둔다. */}
              <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-700 space-y-1">
                <p>
                  <strong>바뀌는 것</strong>: 규정 목록·상세·체계도·즐겨찾기에 표시되는 상태 배지, 대시보드의
                  시행중 규정 수.
                </p>
                <p>
                  <strong>바뀌지 않는 것</strong>: 조문·본문·이력은 그대로 남고,{' '}
                  <strong>검색에서도 계속 나옵니다.</strong> 폐지된 규정도 찾을 수 있어야 하기 때문입니다.
                </p>
              </div>
              {toggleActiveMutation.isError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  {(toggleActiveMutation.error as any)?.response?.data?.message || '상태를 바꾸지 못했습니다.'}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleActiveMutation.mutate(activeToggleTarget)}
                  disabled={toggleActiveMutation.isPending}
                  className="btn-primary"
                >
                  {toggleActiveMutation.isPending ? '처리 중…' : '변경'}
                </button>
                <button type="button" onClick={() => setActiveToggleTarget(null)} className="btn-secondary">
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rejectTargetId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">검토 반려</div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-600">
                이 버전을 <strong>초안으로 되돌립니다.</strong> 내용은 지워지지 않고, 편집자가 고쳐서 다시 올릴 수 있습니다.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="reject-reason">
                  반려 사유
                </label>
                <textarea
                  id="reject-reason"
                  className="input resize-none w-full"
                  rows={4}
                  placeholder="무엇을 고쳐야 하는지 적어 주세요. 편집자에게 그대로 보입니다."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  autoFocus
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  사유는 되돌린 초안에 함께 표시됩니다. 감사 로그는 관리자만 볼 수 있어서 거기에만 적으면 편집자에게 닿지 않습니다.
                </p>
              </div>
              {rejectMutation.isError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  {(rejectMutation.error as any)?.response?.data?.message || '반려하지 못했습니다.'}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const reason = rejectReason.trim();
                    if (!reason) return;
                    rejectMutation.mutate({ id: rejectTargetId, reason });
                  }}
                  disabled={!rejectReason.trim() || rejectMutation.isPending}
                  className="btn-primary"
                >
                  {rejectMutation.isPending ? '처리 중…' : '반려'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejectTargetId(null);
                    setRejectReason('');
                  }}
                  className="btn-secondary"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md">
            <div className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">게시본 폐지</div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">
                <span className="font-mono text-xs bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">
                  v{archiveTarget.versionNum}
                </span>{' '}
                을(를) 폐지할까요?
              </p>
              {/* 게시본이 하나뿐이면 조문이 본문 없이 남는다. 정당한 폐지도 있으므로 막지 않고 알린다. */}
              <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-900 space-y-1">
                <p>폐지하면 이 버전은 게시 상태에서 내려갑니다. 내용과 이력은 남습니다.</p>
                <p>
                  이 조문의 <strong>마지막 게시본이면 전문 보기·인쇄에 본문 없이 나옵니다.</strong> 새 버전을 올려
                  승인하거나, 조문 자체를 정리해야 합니다.
                </p>
              </div>
              {archiveMutation.isError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  {(archiveMutation.error as any)?.response?.data?.message || '폐지하지 못했습니다.'}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => archiveMutation.mutate(archiveTarget.id)}
                  disabled={archiveMutation.isPending}
                  className="btn-primary"
                >
                  {archiveMutation.isPending ? '처리 중…' : '폐지'}
                </button>
                <button type="button" onClick={() => setArchiveTarget(null)} className="btn-secondary">
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reorderOpen && (
        <ArticleReorderPanel
          chapters={policy?.chapters}
          saving={reorderSaving}
          error={reorderError}
          onCancel={() => setReorderOpen(false)}
          onSave={async (order) => {
            if (!id) return;
            setReorderSaving(true);
            setReorderError('');
            try {
              await policiesApi.reorderArticles(id, order);
              await qc.invalidateQueries({ queryKey: ['policy', id] });
              // 선택 중이던 조문의 번호가 바뀌었을 수 있다. 옛 번호를 들고 있으면
              // 본문이 엉뚱한 조를 가리키므로 선택을 놓는다.
              setSelectedArticle(null);
              setReorderOpen(false);
            } catch (e: any) {
              setReorderError(
                e?.response?.data?.message || '조 순서를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
              );
            } finally {
              setReorderSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}
