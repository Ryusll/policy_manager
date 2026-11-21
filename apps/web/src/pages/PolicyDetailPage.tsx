import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { holdPrintRoot } from '../lib/printRoot';
import { apiErrorMessage, serverMessage } from '../lib/apiError';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { policiesApi, versionsApi, filesApi, commentsApi, searchApi, type PolicyScheduledArticle } from '../api/policies';
import { templatesApi } from '../api/templates';
import {
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
  Download,
  History,
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
import { countFullViewMatches } from '../lib/fullViewSearch';
import { highlightText } from '../lib/highlightSearch';
import PlanModal from '../components/PlanModal';
import { ArticleBodyInline } from '../components/ArticleBodyInline';
import {
  type ArticleLabelParts,
  articleShortLabel,
  countDistinctJo,
  formatArticleJo,
  formatClauseHang,
  isArticleJoRoot,
  isChapterHeaderHidden,
  formatKoDate,
  joKeyOf,
  sortArticlesForToc,
} from '../lib/legalArticleLabel';
import {
  articleDisplayLabel,
  articlePositionLabel,
  articleRowHeading,
  chapterArticleLabel,
  formatArticleHeading,
} from '../lib/articleHeading';
import CrossPolicyComparePanel from '../components/CrossPolicyComparePanel';
import { buildPolicyPlainText, policyPlainTextFilename } from '../lib/policyPlainText';
import { sortAppendices } from '../lib/appendixOrder';
import { asOfViewState } from '../lib/asOfView';
import { AsOfStatusBlock } from '../components/AsOfStatusBlock';
import {
  bodyScaleStyle,
  BODY_SCALE_CLASS,
  canStepBodyScale,
  loadBodyScale,
  saveBodyScale,
  stepBodyScale,
  DEFAULT_BODY_SCALE,
} from '../lib/bodyScale';
import {
  buildFullViewGroups,
  collectJoNumbers,
  filterFullViewGroupsByJo,
  fullViewGroupKey,
} from '../lib/fullViewGroups';
import {
  buildArticleCreateRequests,
  canSubmitNewArticleForm,
  chapterHasJoRoot,
  nextClauseNumberForJo,
  nextJoNumberForPolicy,
  segmentArticleHeading,
  titleFieldHint,
  titleFieldLabel,
} from '../lib/articleStructure';
import { filterTocChapters, filterTocGroups, tocArticleLabel, type TocRow } from '../lib/tocLabel';
import { parseRevisionNotify } from '../lib/policyRevisionNotify';
import { notificationGroupsApi } from '../api/notificationGroups';
import { usersApi } from '../api/users';
import { toast } from '../stores/toastStore';
import { ThreeWayComparePanel } from '../components/ThreeWayComparePanel';
import { FavoriteButton } from '../components/FavoriteButton';
import { LawLinksPanel } from '../components/LawLinksPanel';
import { EffectiveDateFillNotice } from '../components/EffectiveDateFillNotice';
import { ReparseReviewNotice } from '../components/ReparseReviewNotice';
import VariableBindingDialog from '../components/VariableBindingDialog';
import { serviceToday } from '../lib/serviceDate';
import { POLICY_TOC_PANEL_ID, backToListLink, planFullViewJump } from '../lib/policyDetailLinks';
import { useFullViewJump } from '../components/policy-detail/useFullViewJump';
import { pickActiveTemplate, useTemplateSelection } from '../components/policy-detail/useTemplateSelection';
import { useAttachmentActions } from '../components/policy-detail/useAttachmentActions';
import { joOrderSignature, reorderNotice, useReorderSave, type ReorderNote } from '../components/policy-detail/useReorderSave';
import { PublishDraftsDialog } from '../components/policy-detail/PublishDraftsDialog';
import { ActiveToggleDialog } from '../components/policy-detail/ActiveToggleDialog';
import { ApproveDialog, ArchiveDialog, RejectDialog, WithdrawDialog } from '../components/policy-detail/VersionDialogs';
import { AppendixDialog } from '../components/policy-detail/AppendixDialog';
import { LengthCap } from '../components/policy-detail/LengthCap';
import { COMMENT_MAX, useBodyWrites } from '../components/policy-detail/useBodyWrites';
import { useVersionActions, versionLocked, versionTargetArgs, type VersionDialogTarget } from '../components/policy-detail/useVersionActions';
import { useArticleBanner } from '../lib/articleBanner';
import { nextDialogToken, useWriteDialogRegistration, useWriteDialogState } from '../lib/writeDialogs';
import { useFlashMessage } from '../lib/flashMessage';
import { useLatest } from '../lib/useLatest';
import { authScopeGuard, fetchPolicyNowSince } from '../lib/policyRefresh';
import { useClearStaleOnReceive } from '../lib/toolStatus';
import { dialogErrorTarget, exportBusyFor, isRunning, pendingJumpAction, policyLabel, reportAfterRefresh, resultTarget, runningNow, useReportResult, useRuns, useShownPolicy, useShownToolbar, useToolStatus, type ToolStatusKind } from '../lib/policyResult';
import { exportButtonLabel, exportFailedMessage, exportMenu, moreMenu, viewMenu } from '../lib/policyToolMenus';
import PolicyTopBar from '../components/policy-detail/PolicyTopBar';
import PolicyHeaderCard from '../components/policy-detail/PolicyHeaderCard';
import PolicyInfoEdit from '../components/policy-detail/PolicyInfoEdit';
import PolicyToolbar from '../components/policy-detail/PolicyToolbar';
import PolicyAsOfBar from '../components/policy-detail/PolicyAsOfBar';
import {
  VERSION_STATE_BADGE,
  VERSION_STATE_LABEL,
  articleBadgeState,
  articleDraftBase,
  isDraftOnlyArticle,
  nextScheduled,
  versionDisplayState,
  type VersionDisplayState, groupScheduledByJo } from '../lib/versionState';
import { formatVersionDates, versionDates } from '../lib/versionDates';
import { VersionDatesLine } from '../components/VersionDatesLine';
import { SpeechControls } from '../components/SpeechControls';
import { useI18n } from '../i18n/useI18n';
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
  // 내려간 버전 — 폐지 시행일이 있으면 "폐지", 없으면 새 버전에 밀려 내려간 것(T-126, versionStatusLabel)
  archived: '이전 버전',
};

/** 버전 상태 표시 — 같은 archived 라도 폐지한 것과 새 버전에 밀려 내려간 것을 가른다(T-126) */
function versionStatusLabel(v: { status: string; repealedOn?: string | null }): string {
  if (v.status === 'archived' && v.repealedOn) return '폐지';
  return statusLabel[v.status] || v.status;
}

const statusClass: Record<string, string> = {
  draft: 'badge-draft',
  review: 'badge-review',
  published: 'badge-published',
  archived: 'badge-archived',
};

function StatusBadge({ status, repealedOn }: { status: string; repealedOn?: string | null }) {
  return (
    <span className={`${statusClass[status] || 'badge-draft'} inline-flex whitespace-nowrap`}>
      {versionStatusLabel({ status, repealedOn })}
    </span>
  );
}

/** 버전·조문 상태 배지 — 상태(status)가 아니라 "오늘" 기준(T-127, lib/versionState). 미래 시행 개정이 있으면
 * 지금 시행 중인 버전이 archived, 시행 예정 버전이 published 라 status 로 붙이면 거꾸로 보인다 */
function StateBadge({ state, title, compact }: { state: VersionDisplayState; title?: string; compact?: boolean }) {
  return (
    <span title={title} className={`${VERSION_STATE_BADGE[state]} inline-flex whitespace-nowrap`}>
      {compact && state === 'scheduled' ? '예정' : VERSION_STATE_LABEL[state]}
    </span>
  );
}

const ymd = (d?: string | null) => (d ? d.slice(0, 10) : '');

/** 오늘 자리에만 남은 장(T-127 `virtual` — 시행 예정 구조 변경으로 그날 없어지는 장)에는 조·절을 넣거나 빼지 않는다(T-132 ⑦) */
const VIRTUAL_CHAPTER_MESSAGE = '이 장은 오늘 자리에만 남은 장입니다(시행 예정 구조 변경으로 그날 없어집니다) — 여기에는 조·절을 넣거나 뺄 수 없습니다.';

/** 조문의 지금 행 자리 — 링크(앵커)는 이 번호로 만들고 찾는다. 오늘 자리(화면 번호)와 다를 수 있다(T-127 `live*`) */
function liveAnchorOf<T extends { number: number; branchNumber?: number | null; clauseNumber?: number | null; itemNumber?: number | null }>(
  a: T & { liveNumber?: number; liveBranchNumber?: number | null; liveClauseNumber?: number | null; liveItemNumber?: number | null },
) {
  if (a.liveNumber == null) return a;
  return {
    ...a,
    number: a.liveNumber,
    branchNumber: a.liveBranchNumber ?? null,
    clauseNumber: a.liveClauseNumber ?? null,
    itemNumber: a.liveItemNumber ?? null,
  };
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
  parts.push(`현재 시행 버전: v${vn}`);
  const upcoming = nextScheduled(article);
  if (upcoming) parts.push(`시행 예정 v${upcoming.versionNum} (${ymd(upcoming.effectiveDate)}부터)`);
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
  // 조는 조 머리 `제1조(목적)`, 항·목은 번호와 부제(없으면 본문 앞부분) — `tocArticleLabel`(T-211)
  const label = tocArticleLabel(article, joTitle ?? '');
  const hasOpenComments = Number(article._count?.comments ?? 0) > 0;
  const badge = articleBadgeState(article);
  const upcoming = nextScheduled(article);
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
      {hasOpenComments ? (
        <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" title="처리 안 된 의견 있음" />
      ) : null}
      <span className="flex-1 truncate">
        <span className={clsx('whitespace-nowrap', isArticleJoRoot(article) && 'font-medium')}>{label}</span>
      </span>
      <span className="inline-flex items-center gap-1 shrink-0">
        {article.hasPrecedent && <RelatedBadge label="판" />}
        {article.hasRelatedLaw && <RelatedBadge label="법" />}
        {article.hasRelatedRule && <RelatedBadge label="규" />}
        <RevisionBadge article={article} />
      </span>
      {badge ? (
        <StateBadge
          state={badge}
          title={badge === 'scheduled' && upcoming ? `${ymd(upcoming.effectiveDate)}부터 시행` : undefined}
        />
      ) : null}
      {badge === 'in_force' && upcoming ? (
        <StateBadge state="scheduled" compact title={`v${upcoming.versionNum} · ${ymd(upcoming.effectiveDate)}부터 시행 예정`} />
      ) : null}
      {badge === 'in_force' && article.repealScheduledOn ? (
        <span
          className="inline-flex whitespace-nowrap rounded border border-dashed border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-800"
          title={`${article.repealScheduledOn}부터 폐지 — 그때까지는 시행 중`}
        >
          폐지 예정
        </span>
      ) : null}
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
  titleRows,
}: {
  selectMode?: boolean;
  /** 선택 인쇄 키 — 조 번호, 가지 조문은 "3-2" (fullViewGroupKey) */
  printSelection?: Set<number | string>;
  onToggleJo?: (key: number | string) => void;
  articles: any[];
  query: string;
  plJo: string;
  plHang: string;
  plItem: string;
  selectedArticle: any;
  onSelect: (article: any) => void;
  canEdit?: boolean;
  onAddHang?: (jo: number, branch: number | null) => void;
  /** 조 제목을 추정할 거르기 전의 행(장 전체). 없으면 `articles` — 걸러진 행으로 추정하면 거를 때만 조 제목이 바뀐다 */
  titleRows?: TocRow[];
}) {
  const groups = filterTocGroups(articles, query, titleRows ?? articles);
  return (
    <>
      {groups.map((group) => {
        const joTitle = group.joTitle;
        const selectKey = fullViewGroupKey({ articleNumber: group.jo, articleBranch: group.branch });
        const joLabel = formatArticleJo(group.jo, group.branch);
        return (
        <div key={`jo-${joKeyOf(group.jo, group.branch)}`} className="border-b border-gray-100/80 last:border-b-0">
          {selectMode && onToggleJo && (
            <label className="flex items-center gap-1.5 px-2 pt-1.5 text-[11px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={printSelection?.has(selectKey) ?? false}
                onChange={() => onToggleJo(selectKey)}
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
              {formatArticleHeading(group.jo, group.branch, joTitle)}
            </div>
          )}
          {group.hangs.map((hang) => (
            <div key={`jo-${joKeyOf(group.jo, group.branch)}-h-${hang.clauseNumber}`}>
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
              onClick={() => onAddHang(group.jo, group.branch)}
              className={clsx(
                plHang,
                'w-full flex items-center gap-1 pr-4 py-1.5 text-[11px] text-gray-400 hover:text-navy-700 hover:bg-gray-50',
              )}
            >
              <Plus size={11} /> {joLabel} 항 추가
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

/**
 * 규정 상세 — 규정마다 화면을 새로 그린다(T-215 11차). 경로(/policies/:id)에서 규정만 바뀌면 React 가 같은 화면을 다시 써서, 규정별
 * 상태(열어 둔 쓰기 창·입력·진행 표시·mutation 관찰자)가 앞 규정의 것으로 남았다 — 창을 하나씩 비우는 목록은 새 창이 생길 때마다 빠졌다.
 * 앞 규정에서 진행 중이던 작업 가운데 진행을 규정별로 두는 것(lib/policyResult RunKind — 내보내기·초안 일괄 시행·상태 전환·규정 정보·
 * 적용 양식·첨부·조 순서·본문 안 쓰기(판 쓰기·부칙·별표·서식·의견·조문 추가))은 내려간 화면에서 끝나도 그 결과를 버리지 않고 알린다(T-224).
 */
export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <PolicyDetailView key={id} />;
}

function PolicyDetailView() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [selectedArticle, setSelectedArticle] = useState<any>(null);
  const [newChapter, setNewChapter] = useState({ number: 1, title: '' });
  const [newArticle, setNewArticle] = useState<{
    chapterId: string;
    /** 소속 절(선택 계층). 절 없이 장 직속이면 undefined */
    sectionId?: string;
    number: number;
    /** "제3조의2"의 2 */
    branchNumber?: number;
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
  // 편집기도 쓰기 창 등록부에 건다(T-224 단계 B2) — 열 때마다 번호, 검토 요청이 거절되면 그 번호의 편집기 안에 실패를, 초안은 저장됐는데
  // 제출이 실패하면 편집기를 그 초안을 고치는 상태로(adopt — 다시 눌러 초안이 또 생기지 않게)
  const [editorToken, setEditorToken] = useState<number | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  // 편집기를 연 조문 — 고른 조문이 바뀌거나 풀리면 편집기를 닫는다(아래 효과)
  const [editorArticleId, setEditorArticleId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullViewMainRef = useRef<HTMLDivElement>(null);
  const fullViewModalRef = useRef<HTMLDivElement>(null);
  // 업로드·삭제가 같은 모달에서 같은 자리에 오류를 띄운다
  const [fileError, setFileError] = useState('');
  // 본문 글자 크기(T-75). 초기값을 저장소에서 바로 읽어 첫 렌더부터 적용한다.
  const [bodyScale, setBodyScale] = useState(loadBodyScale);
  const [showCrossCompare, setShowCrossCompare] = useState(false);
  const [showAttachmentsModal, setShowAttachmentsModal] = useState(false);
  const [showFullTextModal, setShowFullTextModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  // 판 확인 창 넷(T-224) — 창을 열 때마다 번호를 매겨 등록부에 건다. 쓰기는 시작할 때 그 번호를 잡아, 끝났을 때 같은 창이 아직 열려
  // 있을 때만 닫거나 창 안에 실패를 보인다(lib/writeDialogs, lib/policyWrite)
  // 대상에는 창을 연 때의 조문(id·표기)을 싣는다 — 창이 열린 사이 고른 조문이 바뀌거나 풀려도 그 판의 조문으로 보내고 알린다
  // 승인 창은 그 조문의 가장 늦은 시행 예정일(그보다 이른 날로는 승인할 수 없다)도 연 때의 것으로 든다(B1 재검토 #4)
  const approveDlg = useWriteDialogState<VersionDialogTarget & { minDate: string | null }>('approve', id);
  const rejectDlg = useWriteDialogState<VersionDialogTarget>('reject', id);
  const [rejectReason, setRejectReason] = useState('');
  const archiveDlg = useWriteDialogState<VersionDialogTarget>('archive', id);
  // 폐지 시행일(T-132 ③) — 비우면 오늘
  const [archiveDate, setArchiveDate] = useState('');
  // 시행 예정 철회(T-132 ②)
  const withdrawDlg = useWriteDialogState<VersionDialogTarget & { effectiveDate: string }>('withdraw', id);
  const [withdrawReason, setWithdrawReason] = useState('');
  // 변수 연결 창(T-109) — 시행 중인 버전의 문구를 변수에 잇는다
  const [bindingTarget, setBindingTarget] = useState<{ id: string; versionNum: number; content: string; articleId: string } | null>(null);
  const [activeToggleTarget, setActiveToggleTarget] = useState<boolean | null>(null);
  const [approveNote, setApproveNote] = useState('');
  /** 시행 승인 시 확정할 시행일(YYYY-MM-DD). 비우면 서버가 승인일로 기록 */
  const [approveEffectiveDate, setApproveEffectiveDate] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [tocQuery, setTocQuery] = useState('');
  // 순서 창이 열렸는가 — 연 뒤에 창을 새로 그렸다는 안내는 훅의 창 기준(reorder.redrawn — 서명을 견주지 않는다, T-215 15차 #5·T-225)
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorderError, setReorderError] = useState('');
  const [reorderNote, setReorderNote] = useState<ReorderNote | null>(null);
  const [fullViewSearchQuery, setFullViewSearchQuery] = useState('');
  const [fullViewActiveMatchIndex, setFullViewActiveMatchIndex] = useState(0);
  const [tocOpen, setTocOpen] = useState(true);
  const [tocPinnedMode, setTocPinnedMode] = useState(false);
  const [leftSidebarTab, setLeftSidebarTab] = useState<'toc' | 'history' | 'appendices'>('toc');
  const [selectedAppendixId, setSelectedAppendixId] = useState<string | null>(null);
  // 부칙·별표·서식 창 — 쓰기 창 등록부에 건다(T-224 단계 C, 창을 열 때마다 번호·창 안 실패)
  const appendixDlg = useWriteDialogState<{ mode: 'create' } | { mode: 'edit'; id: string }>('appendix', id);
  // 조문 추가 양식(newArticle)도 등록부에 건다 — 열 때마다 번호, 거절은 양식 안에(T-224 단계 C)
  const [addArticleToken, setAddArticleToken] = useState<number | null>(null);
  const [addArticleError, setAddArticleError] = useState<string | null>(null);
  const [appendixDraft, setAppendixDraft] = useState<{
    kind: AppendixKind;
    title: string;
    body: string;
    sortOrder: string;
  }>({ kind: 'supplementary', title: '', body: '', sortOrder: '' });
  const [lawToolMsg, setLawToolMsg] = useState('');
  // 도구 줄 알림을 잠깐 보이고 지운다 — 그사이 다른 알림(실패 문구 등)으로 바뀌었거나 같은 알림을 다시 띄웠으면 남긴다(T-215, lib/flashMessage)
  const flashToolMsg = useFlashMessage(setLawToolMsg);
  // 도구 줄 상태 — 남긴 실패는 다른 작업의 결과가 덮지 않는다(lib/policyResult.useToolStatus)
  const [lawToolKind, setLawToolKind] = useState<ToolStatusKind>('info');
  const toolStatus = useToolStatus(setLawToolMsg, flashToolMsg, setLawToolKind);
  // 지금 보이는 규정과 화면이 떠 있는지, 그리고 비동기 작업(내보내기·초안 시행·양식 저장)의 결과 알림 — 시작한 규정을 떠났으면
  // 그 규정 이름을 붙여 화면 전체 알림으로(lib/policyResult)
  const shownPolicy = useShownPolicy(id);
  const reportResult = useReportResult(shownPolicy, toolStatus, t);
  // 이 화면이 그리는 규정의 도구 줄 — 앞 화면(옮겼다 돌아오기 전)이 시작한 작업의 결과도 여기에 남는다(12차)
  useShownToolbar(id, toolStatus);
  // 낡음 표시(받기 실패)는 그 조회를 그 뒤에 받으면 걷힌다(T-224 ④)
  useClearStaleOnReceive(qc, toolStatus);
  const [articleViewMode, setArticleViewMode] = useState<'full' | 'segment'>('full');
  // 판 쓰기의 결과 띠(T-224) — 그 조문을 분절 보기로 보이는 동안 등록부에 걸고, 조문을 바꾸면 걷는다(lib/articleBanner)
  const banner = useArticleBanner(qc, id, selectedArticle?.id, articleViewMode === 'segment' && !!selectedArticle);
  /** 시점 조회 기준일(YYYY-MM-DD). 빈 문자열이면 현행 본문 */
  const [asOfDate, setAsOfDate] = useState('');
  // PDF·한/글 내보내기·초안 일괄 시행 진행 — 규정마다 따로(다른 규정에서 시작한 작업이 이 규정의 버튼·항목을 막지 않는다)
  const { running: runs, start: startRun, end: endRun, targetOf: runTarget } = useRuns();
  const [showRevisionReasons, setShowRevisionReasons] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showThreeWay, setShowThreeWay] = useState(false);
  const [showA11y, setShowA11y] = useState(false);
  /** 선택 조문 인쇄 (T-74). 비어 있으면 전체를 뜻한다. */
  const [printSelection, setPrintSelection] = useState<Set<number | string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [relationNotesDraft, setRelationNotesDraft] = useState({
    relatedPrecedentNote: '',
    relatedLawNote: '',
    relatedRuleNote: '',
  });
  const [articleMetaDraft, setArticleMetaDraft] = useState({
    number: 1,
    branchNumber: '' as string | number,
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

  // 열람자는 분절 보기를 쓰지 않는다(SRS POLICY-13 ①) — 어느 길로 바뀌어도 전문 보기로 돌린다. 조문 선택·조문 링크는
  // 분절 보기 대신 전문 보기 안의 그 조로 스크롤한다(T-215)
  useEffect(() => {
    if (!canUseSegmentMode && articleViewMode === 'segment') setArticleViewMode('full');
  }, [canUseSegmentMode, articleViewMode]);
  const { jump: jumpFullView } = useFullViewJump(showFullTextModal ? fullViewModalRef : fullViewMainRef, () =>
    toast(t('policyDetail.jump.notInView'), 'info'),
  );

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

  const { data: policy, isLoading } = useQuery({
    queryKey: ['policy', id],
    queryFn: () => policiesApi.get(id!),
    enabled: !!id,
  });

  // 시점(as-of) 조회: 기준일이 있으면 그날 시행 중이던 본문으로 전문을 갈아끼운다.
  const { data: asOfPolicy, isFetching: isAsOfLoading, isError: isAsOfError, refetch: refetchAsOf } = useQuery({
    queryKey: ['policy', id, 'as-of', asOfDate],
    queryFn: () => policiesApi.getAsOf(id!, asOfDate),
    enabled: !!id && !!asOfDate,
  });
  const { data: effectiveDates = [] } = useQuery<string[]>({
    queryKey: ['policy', id, 'effective-dates'],
    queryFn: () => policiesApi.effectiveDates(id!),
    enabled: !!id,
  });
  // 시점 조회 중이면 고른 날짜의 응답만 그린다(T-180) — 받는 중이거나 실패면 현행 본문으로 대신하지 않는다. 전에는 현행 본문에
  // "D 시점 본문" 라벨·파일명·인쇄 머리말이 붙어 나갔다. 판정·머리말(basisLine)은 lib/asOfView(표 시험)
  const {
    blocked: asOfBlocked,
    failed: asOfFailed,
    viewPolicy,
    info: asOfInfo,
    basisLine,
  } = asOfViewState({ asOfDate, policy, asOfPolicy, isError: isAsOfError, isFetching: isAsOfLoading, today: serviceToday() });
  /** 시점 조회는 전문 보기에서만(T-180) — 날짜를 고르면 전문 보기로 */
  const pickAsOfDate = (d: string) => {
    setAsOfDate(d);
    if (d) setArticleViewMode('full');
  };
  // 분절 보기는 현행 본문이라 — 분절 보기로 가면(목록·조문 선택·딥링크 어느 길이든) 시점 조회를 풀고 알린다
  useEffect(() => {
    if (articleViewMode !== 'segment' || !asOfDate) return;
    setAsOfDate('');
    toast(t('asOfView.segmentIsCurrent'), 'info');
  }, [articleViewMode, asOfDate, t]);
  // 전문 보기 안의 그 조로(T-215) — 지금 그려진 본문(시점 조회면 그 시점 본문)의 번호로 찾는다. 본문을 아직 못 받았거나 그 본문에
  // 없는 조문(그 날짜 뒤에 생긴 조)이면 조용히 그만두지 않고 알린다. 열람자의 조문 선택·조문 링크와 전문 보기의 목차가 부른다
  // 시점 본문을 받는 중에 고른 조 — 받으면 그 본문에서 다시 찾는다(조문 링크로 들어온 경우처럼 다시 부를 길이 없을 때도)
  // 보류는 고른 규정과 함께 둔다 — 다른 규정으로 옮긴 뒤에 앞 규정의 보류가 실행되지 않게
  const [pendingJump, setPendingJump] = useState<{ id: string; policyId: string | undefined } | null>(null);
  const jumpInFullView = useCallback(
    (article: { id: string }) => {
      const plan = planFullViewJump(article.id, { asOfBlocked, shownChapters: viewPolicy?.chapters });
      if (plan.kind === 'blocked') {
        setPendingJump({ id: article.id, policyId: id });
        // 받지 못했으면 기다려도 풀리지 않는다 — 다시 시도하면 간다
        return void toast(t(asOfFailed ? 'policyDetail.jump.asOfFailed' : 'policyDetail.jump.asOfBlocked'), 'info');
      }
      if (plan.kind === 'missing') return void toast(t('policyDetail.jump.notInView'), 'info');
      jumpFullView(plan.target);
    },
    [asOfBlocked, asOfFailed, viewPolicy, jumpFullView, t, id],
  );
  useEffect(() => {
    // 받는 중이면 기다리고, 그사이 분절 보기로 갔거나(편집자) 다른 규정으로 옮겼으면 버린다(lib/policyResult)
    const act = pendingJumpAction(pendingJump, { asOfBlocked, fullView: articleViewMode === 'full', id });
    if (act === 'none' || act === 'wait') return;
    setPendingJump(null);
    if (act === 'run' && pendingJump) jumpInFullView(pendingJump);
  }, [pendingJump, asOfBlocked, articleViewMode, jumpInFullView, id]);
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
      // 링크는 지금 행 번호로 만든다(즐겨찾기·검색·규정 질문·링크 복사) — 미래 시행 묶음이 조문을 옮겨 둔 동안은 화면 번호와
      // 다르므로 지금 행 번호로 찾는다(T-127). 시행일이 지나면 둘이 같다
      type Linkable = { id: string; number: number; branchNumber?: number | null; clauseNumber?: number | null; itemNumber?: number | null };
      const all = (policy.chapters as { articles?: Linkable[] }[]).flatMap((ch) =>
        (ch.articles || []).map((a) => ({ ...liveAnchorOf(a), __a: a, __ch: ch })),
      );
      const hit = findByAnchor(all, anchor);
      if (hit) found = { ch: hit.__ch, hit: hit.__a };
    } else {
      const legacyId = parseLegacyArticleId(window.location.hash);
      if (legacyId) found = findChapterOf((a: any) => a.id === legacyId);
    }

    if (!found) return;
    if (!canUseSegmentMode) {
      // 목차 강조도 그 조로(주소는 이미 그 조문 링크다)
      setSelectedArticle(found.hit);
      jumpInFullView(found.hit);
      return;
    }
    setSelectedArticle(found.hit);
    setArticleViewMode('segment');
    setExpandedChapters((prev) => new Set(prev).add(found.ch.id));
  }, [policy?.id]);

  /** 현재 조문을 가리키는 안정 링크를 클립보드에 복사한다 */
  const copyArticleLink = useCallback(async () => {
    if (!selectedArticle) return;
    const url = `${window.location.origin}${window.location.pathname}${articleHash(liveAnchorOf(selectedArticle))}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`링크를 복사했습니다 — ${formatArticleAnchor(selectedArticle)}`, 'success');
    } catch {
      // 클립보드 권한이 없으면(비 HTTPS 등) 주소만 바꿔 사용자가 직접 복사하게 한다
      window.location.hash = articleHash(liveAnchorOf(selectedArticle)).slice(1);
      toast('클립보드를 쓸 수 없어 주소창을 갱신했습니다. 주소를 복사하세요.', 'info');
    }
  }, [selectedArticle]);
  const { data: templates = [] } = useQuery({
    queryKey: ['policy-templates'],
    queryFn: () => templatesApi.list(),
    enabled: !!id,
  });

  // 선택한 조문의 최신 모양 — selectedArticle 은 누른 순간의 사본이라 승인 뒤에도 옛 버전을 들고 있다(T-127)
  const liveSelectedArticle = useMemo(() => {
    if (!selectedArticle) return null;
    for (const ch of policy?.chapters ?? []) {
      const found = (ch.articles || []).find((x: { id: string }) => x.id === selectedArticle.id);
      if (found) return found;
    }
    return selectedArticle;
  }, [policy?.chapters, selectedArticle]);
  // 새 초안의 바탕 — 시행 예정 본문이 있으면 그것(오늘 본문으로 고치면 시행 예정 개정을 잃는다)
  const selectedDraftBase = useMemo(() => articleDraftBase(liveSelectedArticle ?? {}), [liveSelectedArticle]);
  const currentVersionId: string | null = liveSelectedArticle?.versions?.[0]?.id ?? null;
  // 변수를 이을 수 있는 버전 — 오늘 시행본과 시행 예정본(날짜마다 그날 이기는 판, 서버와 같은 기준 — T-132 ⑥)
  const bindablePhase = useMemo(() => {
    const m = new Map<string, 'in_force' | 'scheduled'>();
    if (currentVersionId) m.set(currentVersionId, 'in_force');
    for (const v of (liveSelectedArticle?.scheduledVersions ?? []) as { id: string }[]) m.set(v.id, 'scheduled');
    return m;
  }, [currentVersionId, liveSelectedArticle]);
  // 이 조문의 가장 늦은 시행 예정일 — 그보다 이른 날로는 승인할 수 없다(서버도 409, T-132 ①). 승인 창은 연 때의 값을 대상에 싣는다
  const approveMinDate: string | null = selectedDraftBase.kind === 'scheduled' ? selectedDraftBase.effectiveDate : null;
  // 비워 두면 오늘로 승인된다
  const approveDlgMin = approveDlg.target?.minDate ?? null;
  const approveTooEarly = !!approveDlgMin && (approveEffectiveDate || serviceToday()) < approveDlgMin;
  // 미래 시행 구조 변경(재파싱 묶음, T-110 ②)으로 오늘 자리와 지금 행이 다른 조문·장이 있다(T-127). 목차·본문은 오늘 자리로
  // 보이고, 구조 편집은 지금 행 — 그날부터의 자리 — 을 고친다(T-132 ⑦). 자리가 바뀌는 중인 조에 조문을 넣거나 옮겨 넣는 것은
  // 서버가 막는다(`assertNotIntoMovingJo`). 화면은 미리 알리고, 편집 칸은 지금 행 값으로 채운다
  const structureScheduled = Number(policy?.current?.structureChanges ?? 0) > 0;
  // 조 순서 재정렬은 그동안 막는다 — 오늘 자리와 그날부터의 자리가 섞인 목록을 한 번에 다시 매기게 된다
  const guardReorder = useCallback((): boolean => {
    if (!structureScheduled) return true;
    toast(
      '시행 예정 구조 변경(재파싱 묶음)이 있는 동안은 조 순서를 다시 매길 수 없습니다 — 그날 뒤에 하세요. 조·항 추가와 번호·제목 고치기는 할 수 있습니다.',
      'error',
    );
    return false;
  }, [structureScheduled]);
  const policyChapters: any[] | undefined = policy?.chapters;
  const scheduledArticles: PolicyScheduledArticle[] | undefined = policy?.current?.scheduledArticles;
  const nextScheduledDate: string | null = policy?.current?.nextScheduledDate ?? null;
  /** 자리가 바뀌는 중인 조(오늘 조와 그날부터의 조, 조 번호 기준 — 서버 `assertNotIntoMovingJo` 와 같다) */
  const movingJos = useMemo(() => {
    const m = new Map<string, { today: string; live: string; date: string }>();
    if (!structureScheduled) return m;
    for (const ch of policyChapters ?? []) {
      for (const a of ch.articles ?? []) {
        if (!a.displaced || a.liveNumber == null) continue;
        if (a.number === a.liveNumber && (a.branchNumber ?? 0) === (a.liveBranchNumber ?? 0) && ch.id === a.liveChapterId) continue;
        const info = {
          today: formatArticleJo(a.number, a.branchNumber),
          live: formatArticleJo(a.liveNumber, a.liveBranchNumber),
          date: ymd(a.scheduledVersions?.[0]?.effectiveDate ?? nextScheduledDate),
        };
        m.set(`${a.number}|${a.branchNumber ?? 0}`, info);
        m.set(`${a.liveNumber}|${a.liveBranchNumber ?? 0}`, info);
      }
    }
    return m;
  }, [structureScheduled, policyChapters, nextScheduledDate]);
  /** 지금 행 자리로 본 장의 조문 — 새 조·항 번호와 조 머리 유무는 지금 행으로 센다(화면 번호는 오늘 자리일 수 있다) */
  const liveRowsOf = useCallback(
    (chapterId: string) => {
      const rows: ArticleLabelParts[] = [];
      for (const ch of policyChapters ?? []) {
        for (const a of ch.articles ?? []) if ((a.liveChapterId ?? ch.id) === chapterId) rows.push(liveAnchorOf(a));
      }
      for (const a of scheduledArticles ?? []) if (a.liveChapterId === chapterId) rows.push(a);
      return rows;
    },
    [policyChapters, scheduledArticles],
  );
  // 지금 행(그날부터의 자리)으로 채운다 — 저장도 지금 행을 고친다. 오늘 자리와 다르면 칸 아래에 알린다(T-132 ⑦)
  useEffect(() => {
    const a = liveSelectedArticle;
    if (!a) return;
    const live = a.liveNumber != null;
    setArticleMetaDraft({
      number: Number(live ? a.liveNumber : a.number) || 1,
      branchNumber: (live ? a.liveBranchNumber : a.branchNumber) ?? '',
      clauseNumber: (live ? a.liveClauseNumber : a.clauseNumber) ?? '',
      itemNumber: (live ? a.liveItemNumber : a.itemNumber) ?? '',
      title: (live ? a.liveTitle : a.title) ?? '',
    });
  }, [
    liveSelectedArticle?.id,
    liveSelectedArticle?.number,
    liveSelectedArticle?.branchNumber,
    liveSelectedArticle?.clauseNumber,
    liveSelectedArticle?.itemNumber,
    liveSelectedArticle?.title,
    liveSelectedArticle?.liveNumber,
    liveSelectedArticle?.liveBranchNumber,
    liveSelectedArticle?.liveClauseNumber,
    liveSelectedArticle?.liveItemNumber,
    liveSelectedArticle?.liveTitle,
  ]);

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
    // 다른 조문의 버전 id 가 남아 있으면 이 조문 것으로 — 캐시된 조문으로 돌아오면 versions 가 바로 차 있어 위에서 비우지 않는다.
    // 남겨 두면 버전 비교(T-134 로 살아남)가 앞 조문의 차이를 보였다
    const has = (vid: string) => versions.some((v: { id: string }) => v.id === vid);
    if (!compareV1 || !has(compareV1)) setCompareV1(versions[0].id);
    if (versions[1] ? !compareV2 || !has(compareV2) : !!compareV2) setCompareV2(versions[1]?.id ?? '');
  }, [versions, compareV1, compareV2]);

  const segmentVersionWorkflow = useMemo(() => {
    const list = versions as any[];
    return {
      drafts: list.filter((v) => v.status === 'draft'),
      inReview: list.filter((v) => v.status === 'review'),
    };
  }, [versions]);

  const openVersionEditor = useCallback(() => {
    // 판 쓰기·초안 일괄 시행이 도는 동안은 열지 않는다(T-224 E1·E11 — 여는 단추도 막힌다)
    if (!selectedArticle || !id || runningNow('version', id) || runningNow('publish', id)) return;
    // 재파싱 묶음 초안은 이어 쓰지 않는다 — 묶음의 검토가 적용할 본문을 편집기가 덮어쓰지 않게(B2 재검토, 서버 수정에는 묶음 검사가 없다)
    const draft = (versions as any[]).find((v) => v.status === 'draft' && !v.reparseItem);
    setEditorToken(nextDialogToken());
    setEditorError(null);
    setEditorArticleId(selectedArticle.id);
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
    setVersionContent(selectedDraftBase.content.trim());
  }, [selectedArticle, id, versions, selectedDraftBase]);

  const { data: comments = [], isSuccess: commentsLoaded } = useQuery({
    queryKey: ['comments', selectedArticle?.id],
    queryFn: () => commentsApi.list(selectedArticle.id),
    enabled: !!selectedArticle,
  });

  const { data: files = [] } = useQuery({
    queryKey: ['files', id],
    queryFn: () => filesApi.list(id!),
    enabled: !!id,
  });

  const { data: diffResult, isFetching: isDiffLoading } = useQuery({
    queryKey: ['versionDiff', compareV1, compareV2],
    queryFn: () => versionsApi.diff(compareV1, compareV2),
    enabled: !!compareV1 && !!compareV2 && compareV1 !== compareV2,
  });

  // 첨부 올리기·지우기 — 진행·결과는 시작한 규정에 묶는다(components/policy-detail/useAttachmentActions, 12차)
  const attachments = useAttachmentActions({ id, label: policyLabel(policy), modalOpen: showAttachmentsModal, shown: shownPolicy, report: reportResult, setError: setFileError, t });
  // 조 순서 저장 — 같은 규칙(components/policy-detail/useReorderSave). 저장하면 선택 중이던 조를 놓는다 — 번호가 바뀌었을 수 있어
  // 옛 번호를 들고 있으면 본문이 엉뚱한 조를 가리킨다
  // 순서 서명 — 바뀌면 열린 순서 창을 새로 그린다(옛 순서를 들고 남지 않게, T-215 14차)
  const reorderSig = useMemo(() => joOrderSignature(policy?.chapters), [policy?.chapters]);
  const reorder = useReorderSave({
    id,
    label: policyLabel(policy),
    panelOpen: reorderOpen,
    chapters: policy?.chapters,
    basedOn: policy?.current?.joOrderBasis,
    signature: reorderSig,
    shown: shownPolicy,
    report: reportResult,
    setError: setReorderError,
    note: reorderNote,
    setNote: setReorderNote,
    onSaved: () => {
      setSelectedArticle(null);
      setReorderOpen(false);
    },
    t,
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
    if (chapter?.virtual) {
      toast(VIRTUAL_CHAPTER_MESSAGE, 'error');
      return;
    }
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

  // 규정 정보 편집(저장·상태 전환)의 결과는 시작한 규정에 묶는다(9차 — 진행 중인 mutation 은 나중 그리기의 옵션으로 불려 닫힌 id 가
  // 옮긴 규정일 수 있다). 결과 자리는 도구 줄 하나 — 떠났으면 규정 이름을 붙인 화면 전체 알림(T-224 ④: 편집 칸 상태 줄·알림으로 나뉘어
  // 받기 실패의 '새로 고침해 확인'이 다시 저장해 성공해도 남았다). 받기 실패는 낡음 표시로 남겨 그 뒤 이 규정을 받으면 걷힌다
  type InfoTarget = { routeId: string; policyId: string; label: string };
  const infoTarget = (): InfoTarget => ({ routeId: id!, policyId: policy!.id, label: policyLabel(policy) });
  const savePolicyDatesMutation = useMutation({
    mutationFn: (v: InfoTarget & { revisionDate: string | null; effectiveDate: string | null; revisionNotify: unknown }) =>
      policiesApi.update(v.policyId, { revisionDate: v.revisionDate, effectiveDate: v.effectiveDate, revisionNotify: v.revisionNotify }),
    onSuccess: async (_res, v) => {
      // 이 규정을 다시 받은 뒤에 알리고 진행을 푼다(onSettled 는 이 약속을 기다린다) — 알림이 옛 날짜 위에 뜨거나, 다시 그린 화면이
      // 그 사이 옛 날짜로 풀리지 않게(T-215 14·15차). 본 조회만 기다리고, 그 사이 로그아웃했으면 알리지 않는다(16차, lib/policyRefresh)
      // 다시 받지 못했으면 화면이 옛 값이라고 덧붙인다(17차)
      const inScope = authScopeGuard();
      const { fresh, since } = await fetchPolicyNowSince(qc, v.routeId, inScope);
      if (!inScope()) return;
      reportAfterRefresh(qc, reportResult, t, { startedId: v.routeId, label: v.label, done: t('policyDetail.info.saved'), received: fresh !== null, since, source: 'info' });
    },
    // 실패 줄은 이 작업의 이름을 달아 남긴다 — 다시 저장해 성공하면 걷힌다(T-224)
    onError: (err, v) => reportResult(v.routeId, v.label, apiErrorMessage(err, t('policyDetail.info.saveFailed')), 'error', { source: 'info' }),
    onSettled: (_res, _err, v) => endRun('info', v.routeId),
  });

  /**
   * 시행중 ↔ 비활성 (T-15).
   *
   * `isActive` 는 지금 **표시 전용**이다 — 검색에서 빠지지도, 목록에서 사라지지도 않는다.
   * 폐지된 규정도 찾을 수 있어야 하므로 그게 맞다. 다만 사용자는 "비활성"을 "안 보이게
   * 됨"으로 읽기 쉬워서, 확인 창에 무엇이 바뀌고 무엇이 안 바뀌는지 적어 둔다.
   */
  // 상태 전환 확인 창이 열린 규정 — 그 창이 떠 있으면 실패는 창 안에 적히고, 아니면 알림으로(dialogErrorTarget)
  const toggleDialogOf = useLatest(activeToggleTarget === null ? null : id);
  const toggleActiveMutation = useMutation({
    mutationFn: (v: InfoTarget & { next: boolean }) => policiesApi.update(v.policyId, { isActive: v.next }),
    onSuccess: async (_res, v) => {
      void qc.invalidateQueries({ queryKey: ['policies'] });
      // 이 규정을 다시 받은 뒤에 창을 닫고 알리며 진행을 푼다 — 알림이 옛 상태 위에 뜨거나, 다시 그린 화면이 옛 상태로 풀려 같은 전환을
      // 또 보내지 않게(T-215 14·15차). 본 조회만 기다리고, 그 사이 로그아웃했으면 알리지 않는다(16차)
      const inScope = authScopeGuard();
      const { fresh, since } = await fetchPolicyNowSince(qc, v.routeId, inScope);
      if (!inScope()) return;
      // 창 닫기는 진행을 풀기(onSettled 의 endRun — 진행 저장소 구독은 동기라 먼저 그려진다) 전에 그린다 — 풀린 그리기에서 창이 열린 채
      // 확인 단추가 다시 살아나 같은 전환을 또 보내지 않게(T-224 — T-225 와 같은 까닭)
      if (resultTarget(v.routeId, shownPolicy) === 'toolbar') flushSync(() => setActiveToggleTarget(null));
      const done = t(v.next ? 'policyDetail.status.madeActive' : 'policyDetail.status.madeInactive');
      reportAfterRefresh(qc, reportResult, t, { startedId: v.routeId, label: v.label, done, received: fresh !== null, since, source: 'toggle' });
    },
    onError: (err, v) => {
      if (dialogErrorTarget(v.routeId, shownPolicy, toggleDialogOf.current) === 'dialog') return;
      reportResult(v.routeId, v.label, apiErrorMessage(err, t('policyDetail.status.toggleFailed')), 'error', { source: 'toggle' });
    },
    onSettled: (_res, _err, v) => endRun('toggle', v.routeId),
  });
  // 진행·실패 표시는 그 규정의 것만(10차 — 앞 규정의 진행이 다른 규정의 저장 버튼·확인 창을 막거나 그 실패가 보이지 않게)
  const infoBusy = isRunning(runs, 'info', id);
  // 저장 중이면 보낸 날짜·알림 설정을 그린다 — 다시 그린 화면은 캐시의 옛 값만 안다(T-215 13·14차)
  const infoSent = infoBusy ? (JSON.parse(runTarget('info', id) ?? 'null') as { revisionDate: string | null; effectiveDate: string | null; notify: typeof revisionNotify } | null) : null;
  const toggleBusy = isRunning(runs, 'toggle', id);
  // 부칙·별표·서식·의견·조문 추가(T-224 단계 C) — 누를 때의 규정·조문·대상을 잡아 끝까지 쓴다(lib/policyWrite). 종류마다 한 규정에서 한 번에 하나
  const bodyWrites = useBodyWrites({ policyId: id, label: policyLabel(policy), qc, shown: shownPolicy, toolbar: toolStatus, t, start: startRun, end: endRun });

  const openAddArticleForm = useCallback(
    (
      chapterId?: string,
      preset?: { number?: number; branchNumber?: number; clauseNumber?: number; itemNumber?: number },
      sectionId?: string,
    ) => {
      if (!id || !canEdit) return;
      // 조문 추가가 도는 동안은 열지 않는다 — 다시 연 양식이 아직 받지 못한 새 조의 번호를 또 제안해 같은 조가 둘 생기지 않게(단계 C 검토)
      if (runningNow('addArticle', id)) return toast(t('bodyWrites.article.running'), 'info');
      // 장 id 는 지금 행의 장이다 — 오늘 화면에 없는 장(그날부터 생기는 장)일 수도 있어 못 찾아도 그대로 쓴다
      const ch: { id: string; virtual?: boolean } | undefined = chapterId
        ? policyChapters?.find((c) => c.id === chapterId) ?? { id: chapterId }
        : policyChapters?.find((c) => c.suppressHeader && !c.virtual);
      if (ch?.virtual) {
        toast(VIRTUAL_CHAPTER_MESSAGE, 'error');
        return;
      }
      const openFor = (chapterIdToOpen: string) => {
        // 조 번호는 법령·규정 관례대로 문서 전체에서 이어진다(장이 바뀌어도 1로 돌아가지 않음). 구조 변경 예정 동안은 오늘 자리·
        // 지금 행·시행 예정 신설 조문 번호를 모두 넘겨야 어느 날에도 겹치지 않는다(T-132 ⑦)
        const rows = (policyChapters ?? []).flatMap((c) => c.articles ?? []);
        const jo =
          preset?.number ??
          nextJoNumberForPolicy([{ articles: rows }, { articles: rows.map(liveAnchorOf) }, { articles: scheduledArticles ?? [] }]);
        setAddArticleToken(nextDialogToken());
        setAddArticleError(null);
        setNewArticle({
          chapterId: chapterIdToOpen,
          sectionId,
          number: jo,
          branchNumber: preset?.branchNumber,
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
      };
      // 장이 하나도 없으면 숨은 장을 먼저 만든다 — 다른 쓰기와 같은 진행·결과 규칙(useBodyWrites.ensureHiddenChapter), 만들어졌으면 그 장으로 연다
      if (!ch) return void bodyWrites.ensureHiddenChapter({ onReady: openFor });
      openFor(ch.id);
    },
    [id, canEdit, policyChapters, scheduledArticles, t, bodyWrites],
  );

  // 항 추가 — 지금 행의 장·조로(T-132 ⑦). 자리가 바뀌는 중인 조는 그날 뒤에(서버도 막는다)
  const addHangAt = useCallback(
    (chapter: any, jo: number, branch?: number | null) => {
      const moving = movingJos.get(`${jo}|${branch ?? 0}`);
      if (moving) {
        toast(
          `이 조는 ${moving.date}부터 자리가 바뀝니다(오늘 ${moving.today} → 그날부터 ${moving.live}, 시행 예정 재파싱 묶음) — 항은 그날 뒤에 넣으세요. 본문 개정은 그대로 할 수 있습니다.`,
          'error',
        );
        return;
      }
      const head = (chapter?.articles || []).find((a: any) => a.number === jo && (a.branchNumber ?? null) === (branch ?? null));
      const liveChapterId: string = head?.liveChapterId ?? chapter.id;
      void openAddArticleForm(liveChapterId, {
        number: jo,
        ...(branch ? { branchNumber: branch } : {}),
        clauseNumber: nextClauseNumberForJo(liveRowsOf(liveChapterId), jo, branch),
      });
    },
    [movingJos, openAddArticleForm, liveRowsOf],
  );


  // 시행본 없이 초안만 있는 조문 — 넣은 내용이 열람자에게는 안 보이는 상태
  const draftOnlyCount = useMemo(
    () =>
      (policy?.chapters ?? []).reduce(
        (n: number, c: any) =>
          n + (c.articles ?? []).filter(isDraftOnlyArticle).length,
        0,
      ),
    [policy],
  );
  // 시행 예정 개정이 있는 조문 수(T-127) — 현행 PDF·한글 파일에는 넣지 않는다
  const scheduledArticleCount: number = Number(policy?.current?.scheduledCount ?? 0);
  // 시행 창은 연 규정에 묶는다(규정을 옮기면 화면이 새로 그려져 닫힌다)
  const [publishDraftsForm, setPublishDraftsForm] = useState<{ policyId: string; changeNote: string; effectiveDate: string } | null>(null);
  const publishFormOf = useLatest(publishDraftsForm?.policyId);
  // 이 규정의 일괄 시행이 끝나기 전에는 창을 다시 열거나 또 시행하지 않는다(9차 — 다시 열면 관찰이 끊겨 실패가 사라졌고, 겹쳐 시행됐다)
  const publishBusy = isRunning(runs, 'publish', id);
  // 같은 규정의 판 쓰기가 도는 동안은 열지 않는다(T-224 E11 — 창에서 시행을 눌러도 아무 말 없이 무시되지 않게 여는 단추부터 막는다)
  const publishLockedByVersion = isRunning(runs, 'version', id);
  // 실패 문구 — 창 안과 창 밖 알림이 같은 글(서버가 준 까닭이 있으면 붙인다)
  const publishFailedText = (err: unknown) => `${t('policyDetail.publishDrafts.failed')} ${serverMessage(err) ?? t('policyDetail.publishDrafts.retry')}`;
  // 결과는 시행을 시작한 규정(v.policyId)에 묶는다 — 진행 중인 요청의 콜백은 나중 그리기의 옵션으로 불려(TanStack Query v5) 닫힌 id 가 옮긴 규정일 수 있다
  const publishDraftsMutation = useMutation({
    mutationFn: (v: { policyId: string; label: string; changeNote: string; effectiveDate: string }) =>
      versionsApi.publishDrafts(v.policyId, { changeNote: v.changeNote.trim(), effectiveDate: v.effectiveDate }),
    onSuccess: async (res, v) => {
      // 다시 받은 뒤에 창을 닫고 알리며 진행을 푼다 — 그 사이 옛 초안 수로 시행 버튼이 풀려 같은 시행을 또 열지 않게(T-215 15차 #6).
      // 본 조회만 기다리고, 그 사이 로그아웃했으면 알리지 않는다(16차)
      const inScope = authScopeGuard();
      const { fresh, since } = await fetchPolicyNowSince(qc, v.policyId, inScope);
      if (!inScope()) return;
      // 창 닫기는 진행을 풀기 전에 그린다(상태 전환과 같은 까닭 — T-224)
      flushSync(() => setPublishDraftsForm((f) => (f?.policyId === v.policyId ? null : f)));
      const done = t('policyDetail.publishDrafts.done', { n: res.published });
      reportAfterRefresh(qc, reportResult, t, { startedId: v.policyId, label: v.label, done, received: fresh !== null, since, flashMs: 4000, source: 'publish' });
    },
    // 그 규정의 시행 창이 떠 있으면 창 안에 적힌다 — 창을 닫았거나 다른 규정을 보고 있으면 도구 줄·화면 전체 알림으로
    onError: (err, v) => {
      if (dialogErrorTarget(v.policyId, shownPolicy, publishFormOf.current) === 'dialog') return;
      reportResult(v.policyId, v.label, publishFailedText(err), 'error', { source: 'publish' });
    },
    onSettled: (_res, _err, v) => endRun('publish', v.policyId),
  });
  // 시행일은 비워 둔다 — 오늘로 채워 두면 옮겨 적은 기존 규정이 그대로 오늘 시행으로 들어간다(PAT-02)
  const openPublishDrafts = () => {
    if (publishBusy || publishLockedByVersion) return;
    publishDraftsMutation.reset();
    setPublishDraftsForm({ policyId: id!, changeNote: '제정', effectiveDate: '' });
  };
  const submitPublishDrafts = () => {
    // 같은 규정의 판 쓰기가 도는 동안은 시작하지 않는다(T-224 E11 — 판 쓰기 쪽도 일괄 시행이 돌면 시작하지 않는다)
    if (!publishDraftsForm || runningNow('version', publishDraftsForm.policyId) || !startRun('publish', publishDraftsForm.policyId)) return;
    publishDraftsMutation.mutate({ ...publishDraftsForm, label: policyLabel(policy) });
  };

  const saveArticleMetaMutation = useMutation({
    mutationFn: () =>
      policiesApi.updateArticle(id!, selectedChapterId, selectedArticle!.id, {
        number: Number(articleMetaDraft.number) || 1,
        branchNumber:
          articleMetaDraft.branchNumber === '' || articleMetaDraft.branchNumber == null
            ? null
            : Number(articleMetaDraft.branchNumber),
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
    onSuccess: async (updated: any) => {
      if (!structureScheduled) {
        qc.invalidateQueries({ queryKey: ['policy', id] });
        setSelectedArticle((prev: any) => (prev && updated?.id === prev.id ? { ...prev, ...updated } : prev));
        return;
      }
      // 응답은 지금 행이라 오늘 자리(화면)와 다를 수 있다 — 다시 읽은 규정의 그 조문으로(T-132 ⑦)
      await qc.invalidateQueries({ queryKey: ['policy', id] });
      const fresh = (qc.getQueryData<any>(['policy', id])?.chapters ?? [])
        .flatMap((c: any) => c.articles ?? [])
        .find((a: any) => a.id === updated?.id);
      setSelectedArticle((prev: any) => (prev && fresh && fresh.id === prev.id ? { ...prev, ...fresh } : prev));
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
      // 고친 칸만 — 응답은 지금 행이라, 미래 시행 묶음이 옮겨 둔 조문이면 번호·제목·장이 오늘 자리와 다르다(T-127)
      setSelectedArticle((prev: any) =>
        prev && updated?.id === prev.id
          ? {
              ...prev,
              hasPrecedent: updated.hasPrecedent,
              hasRelatedLaw: updated.hasRelatedLaw,
              hasRelatedRule: updated.hasRelatedRule,
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
      // 고친 칸만(위와 같은 까닭)
      setSelectedArticle((prev: any) =>
        prev && updated?.id === prev.id
          ? {
              ...prev,
              hasPrecedent: updated.hasPrecedent,
              hasRelatedLaw: updated.hasRelatedLaw,
              hasRelatedRule: updated.hasRelatedRule,
              relatedPrecedentNote: updated.relatedPrecedentNote,
              relatedLawNote: updated.relatedLawNote,
              relatedRuleNote: updated.relatedRuleNote,
            }
          : prev,
      );
      setRelationNotesDraft({
        relatedPrecedentNote: updated.relatedPrecedentNote || '',
        relatedLawNote: updated.relatedLawNote || '',
        relatedRuleNote: updated.relatedRuleNote || '',
      });
    },
  });

  // 판 전환 다섯(시행 승인·반려·폐지·폐지 예정 취소·시행 예정 철회, T-224) — 누를 때의 규정·조문·판을 잡아 끝까지 쓴다. 진행은 규정별
  // 저장소('version' — 판 쓰기는 한 규정에서 한 번에 하나, 초안 일괄 시행과도 서로 막는다), 결과는 조문 배너 → 도구 줄 → 이름 붙은 알림
  const versionActions = useVersionActions({
    policyId: id,
    label: policyLabel(policy),
    qc,
    shown: shownPolicy,
    toolbar: toolStatus,
    t,
    start: startRun,
    end: endRun,
  });
  const versionLock = versionLocked(runs, id);
  // 편집기 닫기 — 취소·X 는 열 때 다시 채우므로 창만 닫고, 검토 요청이 반영되면(등록부의 close) 쓰던 내용도 비운다
  const closeVersionEditor = useCallback(() => {
    setShowVersionEditor(false);
    setEditingDraftVersionId(null);
    setEditorToken(null);
    setEditorError(null);
    setEditorArticleId(null);
  }, []);
  const finishVersionEditor = useCallback(() => {
    closeVersionEditor();
    setVersionContent('');
    setVersionChangeNote('');
    setRevisionInternalReasons([]);
    setRevisionExternalReasons([]);
  }, [closeVersionEditor]);
  useWriteDialogRegistration('review', id, editorToken, { setError: setEditorError, close: finishVersionEditor, adopt: setEditingDraftVersionId });
  const appendixRun = runTarget('appendix', id);
  const appendixBusy = isRunning(runs, 'appendix', id);
  const commentRun = runTarget('comment', id);
  const commentBusy = isRunning(runs, 'comment', id);
  // 고른 조문의 의견 등록이 도는 중일 때만 그 단추에 '처리 중…'(다른 조문의 등록·처리 표시가 막을 때는 까닭을 단다)
  const commentPostRun = `comment:new:${(liveSelectedArticle ?? selectedArticle)?.id ?? ''}`;
  const addArticleBusy = isRunning(runs, 'addArticle', id);
  const closeAddArticle = useCallback(() => {
    setNewArticle(null);
    setAddArticleToken(null);
    setAddArticleError(null);
  }, []);
  useWriteDialogRegistration('addArticle', id, newArticle ? addArticleToken : null, { setError: setAddArticleError, close: closeAddArticle });
  // 의견 입력칸은 보낸 글 그대로일 때만 비운다(설계 E7 — 그 사이 더 쓴 글은 둔다). 칸은 조문마다가 아니라 하나라서 조문을 옮겼어도 비운다 —
  // 이미 등록한 글이 다른 조문의 칸에 남아 또 등록되지 않게(단계 C 검토)
  const commentNow = useLatest({ draft: commentDraft });
  // 편집기가 보이지 않게 되면(고른 조문이 풀리거나 바뀜, 전문 보기로) 닫는다 — 보이지 않는 편집기가 등록부에 남아 결과를 삼키거나, 다른
  // 조문에서 앞 조문의 글·초안으로 다시 나타나지 않게(B2 검토). 닫힌 뒤 끝난 결과는 배너·도구 줄로 간다
  const editorShownFor = showVersionEditor && articleViewMode === 'segment' ? (selectedArticle?.id ?? null) : null;
  useLayoutEffect(() => {
    if (!showVersionEditor || editorShownFor === editorArticleId) return;
    closeVersionEditor();
    // 말없이 닫으면 다시 열 때 쓰던 글이 덮여도 모른다 — 보내지 않았다고 알린다(B2 재검토)
    toast(t('versionDialog.editorClosed'), 'info');
  }, [showVersionEditor, editorShownFor, editorArticleId, closeVersionEditor, t]);
  // 판 단추가 그리는 판의 대상 — 판 단추는 고른 조문의 패널 안에만 있다. 표기는 지금 받은 조문으로(고른 사본은 조 번호·제목을 고친 뒤
  // 옛 표기일 수 있다 — B1 재검토 #6)
  const versionTargetOf = (v: { id: string; versionNum: number }): VersionDialogTarget => {
    const article = liveSelectedArticle ?? selectedArticle;
    return { id: v.id, versionNum: v.versionNum, articleId: article?.id ?? '', articleLabel: article ? articleRowHeading(article) : '' };
  };
  const versionRun = runTarget('version', id);
  const versionLockTitle = versionLock ? t(versionRun ? 'policyWrites.locked' : 'policyWrites.lockedPublish') : undefined;


  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const selectTocArticle = useCallback(
    (article: any) => {
      setSelectedArticle(article);
      window.history.replaceState(null, '', `${window.location.pathname}#article-${article.id}`);
      // 전문 보기에서는 본문의 그 조로 스크롤한다 — 열람자는 분절 보기가 없어 목차가 본문을 움직이는 유일한 길이다(T-215)
      if (articleViewMode === 'full') jumpInFullView(article);
    },
    [articleViewMode, jumpInFullView],
  );
  // 장마다 맞는 행과 조 제목을 추정할 장 전체 행(allArticles)을 싣는다 — 목차 묶음에 titleRows 로 넘긴다(T-211)
  const filteredChapters = filterTocChapters(policy?.chapters, tocQuery);
  const pdfFiles = files.filter((file: any) => /\.pdf$/i.test(file.originalName || ''));

  /**
   * 첨부파일 열기. 서버가 토큰을 헤더로만 받아서 `<a href>`로는 401이 났다(첨부가 열리지 않던 문제).
   * 로그인 정보와 함께 받아 PDF·그림은 새 탭에서 열고, 나머지는 내려받는다.
   */
  const openPolicyFile = useCallback(
    async (file: any, mode: 'open' | 'download' = 'open') => {
      if (!id) return;
      try {
        const blob = await filesApi.fetchBlob(id, file.id);
        const url = URL.createObjectURL(blob);
        const viewable = /\.(pdf|png|jpe?g)$/i.test(file.originalName || '');
        if (mode === 'open' && viewable) {
          window.open(url, '_blank', 'noopener');
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = file.originalName || file.id;
          a.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        toast('첨부파일을 열지 못했습니다.', 'error');
      }
    },
    [id],
  );

  // 원문 PDF 나란히 보기 — 넓은 화면에서 웹 본문 옆에 원문을 띄워 대조한다
  const [sourcePdfUrl, setSourcePdfUrl] = useState<string | null>(null);
  const [sourcePdfLoading, setSourcePdfLoading] = useState(false);
  const toggleSourcePdf = useCallback(async () => {
    if (sourcePdfUrl) {
      URL.revokeObjectURL(sourcePdfUrl);
      setSourcePdfUrl(null);
      return;
    }
    const first = pdfFiles[0];
    if (!first || !id) return;
    setSourcePdfLoading(true);
    try {
      const blob = await filesApi.fetchBlob(id, first.id);
      setSourcePdfUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })));
    } catch {
      toast('원문 PDF를 불러오지 못했습니다.', 'error');
    } finally {
      setSourcePdfLoading(false);
    }
  }, [sourcePdfUrl, pdfFiles, id]);
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
  const toggleJo = useCallback((key: number | string) => {
    setPrintSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const fullViewMatchCount = useMemo(
    () => countFullViewMatches(fullViewGroups, fullViewSearchQuery),
    [fullViewSearchQuery, fullViewGroups],
  );

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

  // 화면의 장(오늘의 계층)과 편집 호출의 장(지금 행)은 다를 수 있다 — 미래 시행 묶음이 조문을 옮겨 둔 동안 화면은 오늘 자리로
  // 보이고, 조문 수정·삭제·항 추가는 지금 행의 장으로 해야 한다(T-127, 서버가 liveChapterId 를 싣는다)
  const selectedViewChapter = useMemo(() => {
    if (!policy?.chapters || !selectedArticle) return null;
    return (
      policy.chapters.find((ch: { articles?: { id: string }[] }) => (ch.articles || []).some((a) => a.id === selectedArticle.id)) ?? null
    );
  }, [policy?.chapters, selectedArticle]);

  const selectedChapterId = useMemo(() => {
    if (!selectedViewChapter || !selectedArticle) return '';
    const a = (selectedViewChapter.articles || []).find((x: { id: string; liveChapterId?: string }) => x.id === selectedArticle.id);
    return (a?.liveChapterId ?? selectedViewChapter.id) as string;
  }, [selectedViewChapter, selectedArticle]);

  const selectedChapterArticles = useMemo(() => selectedViewChapter?.articles || [], [selectedViewChapter]);

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
          label: chapterArticleLabel(ch.number, a),
        });
      }
    }
    return out;
  }, [policy]);

  const historySnapshotRows = useMemo(() => {
    if (!policy?.chapters) return [];
    const rows: { key: string; articleId: string; line: string; sub: string; sub2?: string }[] = [];
    for (const ch of policy.chapters) {
      for (const a of [...(ch.articles || [])].sort(sortArticlesToc)) {
        const v = a.versions?.[0];
        const s = nextScheduled(a);
        if (!v && !s) continue;
        // 날짜 3종(T-111) — 작성일(createdAt)은 시행·발행과 상관없어 보이지 않는다. 시행 예정 개정(T-127)도 같은 표기로
        const dates = v ? versionDates(v) : null;
        const sDates = s ? versionDates(s) : null;
        rows.push({
          key: a.id,
          articleId: a.id,
          line: chapterArticleLabel(ch.number, a),
          sub: v
            ? `v${v.versionNum} · ${VERSION_STATE_LABEL.in_force}${dates ? ` · ${formatVersionDates(dates)}` : ''}`
            : '오늘 시행 중인 본문 없음',
          ...(s ? { sub2: `v${s.versionNum} · ${VERSION_STATE_LABEL.scheduled}${sDates ? ` · ${formatVersionDates(sDates)}` : ''}` } : {}),
        });
      }
    }
    return rows;
  }, [policy]);

  const appendicesGrouped = useMemo(() => {
    const list = sortAppendices((policy?.appendices || []) as any[]);
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
    const articleName = selectedArticle ? articleRowHeading(selectedArticle) : '해당 조문';
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
          if (!canUseSegmentMode) {
            // 목차를 누른 것과 같은 길 — 목차 강조·주소(조문 링크)·스크롤이 같다
            setArticleViewMode('full');
            selectTocArticle(art);
            return;
          }
          setArticleViewMode('segment');
          setTocOpen(true);
          setLeftSidebarTab('toc');
          setExpandedChapters((prev) => new Set(prev).add(ch.id));
          setSelectedArticle(art);
          return;
        }
      }
    },
    [policy, canUseSegmentMode, selectTocArticle],
  );

  const downloadFullTextTxt = useCallback(() => {
    if (!policy || asOfBlocked) return;
    const text = buildPolicyPlainText({
      policy,
      basis: basisLine,
      chapters: fullViewGroups,
      // 시점 모드는 본문과 같은 응답(같은 스냅숏)의 부칙·별표
      appendices: asOfInfo ? sortAppendices(viewPolicy?.appendices) : appendicesGrouped.all,
      appendixKindLabel,
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = policyPlainTextFilename(policy.code, asOfInfo?.date);
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
    toolStatus.flash(t('policyDetail.export.txtDone'), 2500);
  }, [policy, fullViewGroups, appendicesGrouped.all, asOfBlocked, asOfInfo, basisLine, viewPolicy?.appendices, t, toolStatus]);

  // 내보낸 결과 문구 — 빼고 넣은 것(시행 전 초안·시행 예정 개정)을 함께 알린다
  const exportDoneMessage = useCallback(
    (doneKey: string) =>
      [
        t(doneKey),
        draftOnlyCount > 0 ? t('policyDetail.export.leftOutDrafts', { n: draftOnlyCount }) : '',
        !asOfDate && scheduledArticleCount > 0 ? t('policyDetail.export.leftOutScheduled', { n: scheduledArticleCount }) : '',
      ]
        .filter(Boolean)
        .join(' '),
    [t, draftOnlyCount, asOfDate, scheduledArticleCount],
  );

  // 같은 규정의 파일을 만드는 중이면 다시 시작하지 않는다 — 메뉴 항목도 막지만 함수가 스스로 본다. 결과는 시작한 규정에 묶는다(T-215)
  const downloadPdf = useCallback(async () => {
    if (!policy || !id || asOfBlocked || !startRun('pdf', id)) return;
    const label = policyLabel(policy);
    toolStatus.show(t('policyDetail.export.pdfMaking'), 'pdf'); // 진행의 주인 — 그 사이 끝난 다른 작업의 성공은 이 문구를 덮지 않는다(T-224)
    try {
      // 전문 보기와 같은 빌더로 만든 HTML을 그대로 보낸다(화면 = 인쇄물 = PDF).
      const html = buildEnterprisePolicyBodyHtml(fullViewGroups, '');
      const metaParts = [
        policy.code ? `코드: ${policy.code}` : '',
        // 시점 본문에는 현행 규정의 개정일·시행일을 싣지 않는다(T-180)
        !asOfInfo && policy.revisionDate ? `개정일: ${formatKoDate(policy.revisionDate)}` : '',
        !asOfInfo && policy.effectiveDate ? `시행일: ${formatKoDate(policy.effectiveDate)}` : '',
        // 어느 날의 본문인지 밝힌다 — 현행은 오늘 시행 중인 본문이라 시행 예정 개정이 생기면 그날 바뀐다(T-127)
        basisLine,
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
      a.download = `${(policy.code || 'policy').replace(/[^\w.-]+/g, '_')}${asOfInfo ? `-${asOfInfo.date}` : ''}.pdf`;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
      reportResult(id, label, exportDoneMessage('policyDetail.export.pdfDone'), 'success', { flashMs: 3000, source: 'pdf' });
    } catch (err: any) {
      reportResult(id, label, exportFailedMessage(t, 'pdf', err?.response?.status), 'error', { source: 'pdf' });
    } finally {
      endRun('pdf', id);
    }
  }, [policy, id, fullViewGroups, asOfInfo, asOfBlocked, basisLine, exportDoneMessage, startRun, endRun, toolStatus, reportResult, t]);

  /**
   * 한/글 내보내기 (T-85).
   *
   * 만들어지는 파일은 `.hwpx` 다. `.hwp` 는 한컴 독점 바이너리라 서버에서 생성할 수단이
   * 없고, `.hwpx` 는 같은 한/글이 여는 KS X 6101 표준이다(ADR-0016). 한/글 2014 이전
   * 버전은 열지 못하므로 안내 문구에 적어 둔다.
   */
  const downloadHwpx = useCallback(async () => {
    if (!policy || !id || asOfBlocked || !startRun('hwpx', id)) return;
    const label = policyLabel(policy);
    toolStatus.show(t('policyDetail.export.hwpxMaking'), 'hwpx');
    try {
      // PDF 와 같은 빌더로 만든 HTML 을 보낸다(화면 = 인쇄물 = PDF = HWPX). 맨 위에 어느 날의 본문인지(T-180)
      const html = `<p>${basisLine}</p>${buildEnterprisePolicyBodyHtml(fullViewGroups, '')}`;
      const blob = await policiesApi.exportHwpx(id, { html, title: policy.title });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(policy.code || 'policy').replace(/[^\w.-]+/g, '_')}${asOfInfo ? `-${asOfInfo.date}` : ''}.hwpx`;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
      reportResult(id, label, exportDoneMessage('policyDetail.export.hwpxDone'), 'success', { flashMs: 4000, source: 'hwpx' });
    } catch (err: any) {
      reportResult(id, label, exportFailedMessage(t, 'hwpx', err?.response?.status), 'error', { source: 'hwpx' });
    } finally {
      endRun('hwpx', id);
    }
  }, [policy, id, fullViewGroups, asOfInfo, asOfBlocked, basisLine, exportDoneMessage, startRun, endRun, toolStatus, reportResult, t]);

  const copyPageUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toolStatus.flash(t('policyDetail.export.copied'), 2500);
    } catch {
      // 실패 문구는 남긴다 — 주소창에서 직접 복사하라는 안내다. 사용자 동작의 결과라 앞에 남은 실패를 바꾼다(덧붙이지 않는다)
      toolStatus.failNow(t('policyDetail.export.copyFailed'));
    }
  }, [t, toolStatus]);

  const openStdKoreanDict = useCallback(() => {
    window.open('https://stdict.korean.go.kr/main/main.do', '_blank', 'noopener,noreferrer');
  }, []);

  // 적용 양식(보기 설정 메뉴) — 고르기·저장·되돌리기는 components/policy-detail/useTemplateSelection(T-215)
  const templateSel = useTemplateSelection({
    policyId: policy?.id,
    serverValue: policy ? (policy.templateId ?? '') : null,
    canSave: canEdit,
    save: async (templateId) => {
      await policiesApi.update(policy!.id, { templateId: templateId || null });
      await qc.invalidateQueries({ queryKey: ['policy', id] });
    },
    // 저장이 끝나기 전에 다른 규정으로 옮겼거나 떠났으면 어느 규정의 양식인지 붙여 알린다
    onError: (err) => {
      const message = apiErrorMessage(err, t('policyDetail.viewMenu.templateFailed'));
      toast(resultTarget(id ?? '', shownPolicy) === 'toolbar' ? message : t('policyDetail.result.forPolicy', { label: policyLabel(policy), message }), 'error');
    },
  });
  const activeTemplate = useMemo(() => pickActiveTemplate(templates as any[], templateSel.selectedId), [templates, templateSel.selectedId]);
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
        // 시점 본문이면 현행 규정의 개정일·시행일을 싣지 않는다(T-180 — 그 시점 값은 복원하지 않는다)
        asOf: asOfInfo?.date ?? null,
      }),
    [user?.tenantName, policy?.title, policy?.code, policy?.revisionDate, policy?.effectiveDate, asOfInfo?.date],
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
    const pub = selectedDraftBase.content.trim();
    const existingDraft = String(versionContent || '').trim();
    const bodyLines: string[] = [];
    // 사용자가 이미 입력한 초안이 있으면 그것을 우선 보존한다.
    if (existingDraft) bodyLines.push(stripAutoRefBlock(existingDraft).trim());
    else if (pub) bodyLines.push(pub);
    else bodyLines.push('(지금 시행 중이거나 시행 예정인 본문이 없습니다. 아래부터 초안을 작성하세요.)');

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
  }, [selectedDraftBase, versionContent, draftRevisionReasonText, versionChangeNote, buildAutoReferenceBlock]);

  const applySearchRefsToDraft = useCallback(() => {
    const refBlock = buildAutoReferenceBlock();
    if (!refBlock.trim()) {
      toolStatus.flash(t('policyDetail.draft.noSearchRefs'), 2500);
      return;
    }
    setVersionContent((prev) => {
      const stripped = stripAutoRefBlock(prev);
      const glue = stripped.trim().length ? '\n\n' : '';
      return `${stripped.trimEnd()}${glue}${refBlock}`.trim();
    });
  }, [buildAutoReferenceBlock, toolStatus, t]);

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
    // 인쇄할 때 앱 화면은 통째로 빼고 이 창만 흐름대로 찍는다(index.css, T-133)
    const releasePrintRoot = holdPrintRoot();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      releasePrintRoot();
    };
  }, [showFullTextModal]);

  if (isLoading) return <LoadingBlock />;
  if (!policy) {
    return (
      <div className="card">
        <EmptyState
          icon={FileText}
          title={t('policyDetail.notFound.title')}
          description={t('policyDetail.notFound.desc')}
          action={
            // 열람자는 규정 목록을 열 수 없다 — 통합검색으로(T-215)
            <Link to={backToListLink(user?.role).to} className="btn-primary text-sm">
              {t(backToListLink(user?.role).labelKey)}
            </Link>
          }
        />
      </div>
    );
  }

  // 전체화면 전문 — 인쇄는 그 창 안에서 한다(창이 열린 동안만 인쇄 격리가 걸린다, T-133)
  const openFullscreen = () => {
    setArticleViewMode('full');
    setShowFullTextModal(true);
  };
  const exportBusy = exportBusyFor(runs, id);
  const toolMenus = {
    exportLabel: exportButtonLabel(t, exportBusy),
    exportItems: exportMenu({
      t,
      asOfBlocked,
      asOfFailed,
      busy: exportBusy,
      onPdf: () => void downloadPdf(),
      onHwpx: () => void downloadHwpx(),
      onTxt: downloadFullTextTxt,
      onFullscreen: openFullscreen,
      onCopyUrl: () => void copyPageUrl(),
    }),
    viewItems: viewMenu({
      t,
      scale: { percent: bodyScale, canSmaller: canStepBodyScale(bodyScale, -1), canLarger: canStepBodyScale(bodyScale, 1), isDefault: bodyScale === DEFAULT_BODY_SCALE },
      // 바뀐 크기를 도구 줄 알림 영역으로 알린다 — 메뉴 항목 글만 바뀌면 화면 읽기 프로그램이 알려 주지 않는다
      onScale: (step) => {
        const next = step === 0 ? DEFAULT_BODY_SCALE : stepBodyScale(bodyScale, step);
        setBodyScale(saveBodyScale(next));
        toolStatus.flash(t('policyDetail.viewMenu.fontNow', { n: next }), 2500);
      },
      a11yOn: showA11y,
      onToggleA11y: () => setShowA11y((v) => !v),
      templates: {
        feature: canUseTemplateFeature,
        list: templates,
        selectedId: templateSel.selectedId,
        saving: templateSel.saving,
        onSelect: (tid) => void templateSel.change(tid),
        onPro: () => setShowPlanModal(true),
      },
      onDictionary: openStdKoreanDict,
    }),
    moreItems: moreMenu({ t, role: user?.role, canEdit, policyId: policy.id, onReasons: () => setShowRevisionReasons(true), onCrossCompare: () => setShowCrossCompare(true) }),
  };

  return (
    <div className={clsx('page-shell max-w-none', showFullTextModal && 'print:hidden')}>
      <style>{`
        .tmpl-fullview-hit-active {
          outline: 2px solid rgb(245 158 11 / 0.95);
          outline-offset: 1px;
          box-shadow: 0 0 0 2px rgb(255 251 235);
        }
      `}</style>
      {/* 위쪽 줄 — 목록으로(열람자는 통합검색)·현재 위치·목차 토글(T-215, components/policy-detail/PolicyTopBar) */}
      <PolicyTopBar
        role={user?.role}
        title={policy.title}
        viewMode={articleViewMode}
        tocVisible={tocOpen || tocPinnedMode}
        onToggleToc={() => {
          if (tocOpen || tocPinnedMode) {
            setTocOpen(false);
            setTocPinnedMode(false);
          } else {
            setTocOpen(true);
          }
        }}
      />

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
              aria-pressed={leftSidebarTab === 'toc'}
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
              aria-pressed={leftSidebarTab === 'history'}
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
              aria-pressed={leftSidebarTab === 'appendices'}
            >
              <Layers size={13} aria-hidden className="flex-shrink-0" />
              <span className="leading-tight text-center">부칙·별표</span>
            </button>
          </nav>
          <div
            id={POLICY_TOC_PANEL_ID}
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
                    // 저장 중에는 열지 않는다 — 연 창은 열 때의 옛 순서를 들고 있어, 끝난 뒤 다시 저장하면 바뀐 번호에 옛 순서를 보낸다(T-215 13차)
                    disabled={reorder.saving}
                    onClick={() => {
                      if (!guardReorder()) return;
                      setReorderError('');
                      setReorderNote(null);
                      setReorderOpen(true);
                    }}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-gray-600 hover:text-navy-700 border border-gray-300 rounded py-1.5 hover:bg-white transition-colors disabled:opacity-60"
                  >
                    <ArrowUpDown size={12} aria-hidden /> {t(reorder.saving ? 'policyDetail.reorder.busy' : 'policyDetail.reorder.open')}
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
                      titleRows={chapter.allArticles}
                      query={tocQuery}
                      plJo="pl-3"
                      plHang="pl-8"
                      plItem="pl-14"
                      selectedArticle={selectedArticle}
                      onSelect={selectTocArticle}
                      canEdit={canEdit}
                      onAddHang={(jo, branch) => addHangAt(chapter, jo, branch)}
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
                      titleRows={chapter.allArticles}
                      query={tocQuery}
                      plJo="pl-3"
                      plHang="pl-8"
                      plItem="pl-14"
                      selectedArticle={selectedArticle}
                      onSelect={selectTocArticle}
                      canEdit={canEdit}
                      onAddHang={(jo, branch) => addHangAt(chapter, jo, branch)}
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
                              onClick={() => {
                                if (chapter.virtual) toast(VIRTUAL_CHAPTER_MESSAGE, 'error');
                                else removeSectionMutation.mutate({ chapterId: chapter.id, sectionId: section.id });
                              }}
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
                          titleRows={chapter.allArticles}
                          query={tocQuery}
                          plJo="pl-5"
                          plHang="pl-10"
                          plItem="pl-16"
                          selectedArticle={selectedArticle}
                          onSelect={selectTocArticle}
                          canEdit={canEdit}
                          onAddHang={(jo, branch) => addHangAt(chapter, jo, branch)}
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
                    onClick={() => {
                      setShowAddChapter(true);
                    }}
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
                각 조의 <strong>지금 시행 중인 버전</strong>(시행 예정 개정이 있으면 함께) 스냅샷입니다. 상세 개정
                비교·신구대비는 분절 보기에서 조를 선택한 뒤 우측 패널을 이용해 주세요.
              </p>
              {historySnapshotRows.length === 0 ? (
                <p className="text-gray-400 py-6 text-center">시행 중이거나 시행 예정인 조문 버전이 없습니다.</p>
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
                        {row.sub2 && <div className="text-[11px] text-amber-800 mt-0.5">{row.sub2}</div>}
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
                        appendixDlg.open({ mode: 'create' });
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
                              appendixDlg.open({ mode: 'edit', id: selectedAppendix.id });
                            }}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="text-[11px] py-1 px-2 rounded border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={appendixBusy}
                            onClick={() => {
                              const appendixId = selectedAppendix.id;
                              const kindLabel = appendixKindLabel[selectedAppendix.kind as AppendixKind] ?? '';
                              const title = selectedAppendix.title || kindLabel;
                              if (!window.confirm(t('bodyWrites.appendix.confirmDelete', { title }))) return;
                              void bodyWrites.deleteAppendix({
                                appendixId,
                                title,
                                kindLabel,
                                onApplied: () => setSelectedAppendixId((prev) => (prev === appendixId ? null : prev)),
                              });
                            }}
                          >
                            {appendixRun === `delete:${selectedAppendix.id}` ? t('versionDialog.busy') : t('bodyWrites.appendix.deleteButton')}
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
        {/* 머리 카드 — 코드·상태·제목·첨부파일, 관리자·편집자의 규정 정보 편집(접힘), 그 아래 안내 띠(T-215) */}
        <PolicyHeaderCard
          code={policy.code}
          title={policy.title}
          description={policy.description}
          isActive={policy.isActive}
          canEdit={canEdit}
          revisionDate={policy.revisionDate}
          effectiveDate={policy.effectiveDate}
          filesCount={files.length}
          onOpenAttachments={() => setShowAttachmentsModal(true)}
          infoEdit={
            <PolicyInfoEdit
              key={id}
              isActive={policy.isActive}
              onRequestToggleActive={() => {
                // 이 규정의 전환이 진행 중이 아니면 지난 결과(실패 등)를 비우고 연다
                if (!toggleBusy) toggleActiveMutation.reset();
                setActiveToggleTarget(!policy.isActive);
              }}
              revisionDate={infoSent ? (infoSent.revisionDate ?? '') : policyRevisionDate}
              onRevisionDate={setPolicyRevisionDate}
              effectiveDate={infoSent ? (infoSent.effectiveDate ?? '') : policyEffectiveDate}
              onEffectiveDate={setPolicyEffectiveDate}
              saving={infoBusy}
              onSave={() => {
                const sent = { revisionDate: policyRevisionDate || null, effectiveDate: policyEffectiveDate || null, notify: revisionNotify };
                if (!startRun('info', id!, JSON.stringify(sent))) return;
                savePolicyDatesMutation.mutate({ ...infoTarget(), revisionDate: policyRevisionDate || null, effectiveDate: policyEffectiveDate || null, revisionNotify });
              }}
              notify={infoSent?.notify ?? revisionNotify}
              onNotify={setRevisionNotify}
              groups={notifyGroups}
              users={tenantUsers}
            />
          }
        >
          {canEdit && draftOnlyCount > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="flex-1 leading-relaxed">
                <strong>{t('policyDetail.drafts.count', { n: draftOnlyCount })}</strong>
                {t('policyDetail.drafts.note')}
                {user?.role !== 'admin' && t('policyDetail.drafts.adminWill')}
              </p>
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={openPublishDrafts}
                  disabled={publishBusy || publishLockedByVersion}
                  title={publishLockedByVersion ? t('policyWrites.lockedVersion') : undefined}
                  className="shrink-0 rounded bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {publishBusy ? t('policyDetail.publishDrafts.busy') : t('policyDetail.publishDrafts.open')}
                </button>
              )}
            </div>
          )}

          {canEdit && !asOfDate && structureScheduled && (
            <div
              className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
              data-testid="structure-locked-notice"
            >
              <p className="leading-relaxed">
                <strong>시행 예정 구조 변경</strong> — 승인된 재파싱 묶음이 조문 자리·장을 바꾸는데 아직 시행일 전이라, 목차와 본문은
                오늘 자리로 보입니다. 번호·제목을 고치면 <b>그날부터의 자리</b>(지금 행)가 바뀌고 오늘 자리는 그대로입니다 — 옮겨질 조문은
                편집 칸에 그날부터의 번호가 나옵니다. 자리가 바뀌는 중인 조에 조문을 넣거나 옮겨 넣는 것과 조 순서 재정렬은 그날 뒤에 할
                수 있습니다. 본문 개정은 그대로 할 수 있습니다.
              </p>
            </div>
          )}

          {!asOfDate && (policy?.current?.scheduledArticles?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="leading-relaxed">
                <strong>시행 예정 신설 조문 {groupScheduledByJo(policy.current.scheduledArticles as PolicyScheduledArticle[]).length}건</strong> — 오늘 본문의 자리를 아직
                다른 조문이 쓰고 있어 본문에는 넣지 않았습니다. 시행일부터 보입니다.
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {groupScheduledByJo(policy.current.scheduledArticles as PolicyScheduledArticle[]).map((g) => (
                  <li key={g.key}>
                    <button
                      type="button"
                      disabled={!g.effectiveDate}
                      onClick={() => g.effectiveDate && pickAsOfDate(g.effectiveDate)}
                      className="rounded border border-amber-300 bg-white px-2 py-0.5 hover:bg-amber-100"
                      title="그날 시점의 본문으로 보기"
                    >
                      {formatArticleHeading(g.number, g.branchNumber, g.title)} · {g.effectiveDate}부터
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canEdit && policy && (
            <EffectiveDateFillNotice policyId={id!} chapters={policy.chapters ?? []} isAdmin={user?.role === 'admin'} />
          )}
          {canEdit && policy && <ReparseReviewNotice policyId={id!} />}
        </PolicyHeaderCard>

      {/* 도구 줄 — 늘 보이는 것과 메뉴 셋(내보내기·보기 설정·더보기, T-215 — components/policy-detail/PolicyToolbar·lib/policyToolMenus) */}
      <PolicyToolbar
        lawToolMsg={lawToolMsg || null}
        lawToolKind={lawToolKind}
        view={{ mode: articleViewMode, canSegment: canUseSegmentMode, onChange: setArticleViewMode }}
        jump={{ value: selectedArticle?.id || '', options: flatArticlesForJump, onJump: jumpToArticle }}
        compare={{ hasDates: effectiveDates.length > 0, onOldNew: () => setShowComparison(true), onThreeWay: () => setShowThreeWay(true) }}
        menus={toolMenus}
        asOf={
          <PolicyAsOfBar
            asOfDate={asOfDate}
            onPick={pickAsOfDate}
            onClear={() => setAsOfDate('')}
            effectiveDates={effectiveDates}
            today={serviceToday()}
            info={asOfInfo}
            failed={asOfFailed}
            loading={isAsOfLoading}
            onRetry={() => void refetchAsOf()}
          />
        }
        a11yPanel={
          showA11y ? (
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50/70 space-y-2 print:hidden">
              <SpeechControls chunks={speechChunks} label={policy.title} />
              <p className="text-[11px] text-gray-500 leading-relaxed">{t('policyDetail.a11y.note')}</p>
            </div>
          ) : null
        }
      />

      {/* 본문: 전문은 전폭, 분절 보기는 우측 비교 패널만 그리드 */}
      <div className={clsx('grid grid-cols-1 gap-4', articleViewMode === 'segment' && 'lg:grid-cols-12')}>
        {/* 조문 내용 패널. 전문 보기에서 좁은 화면이면 본문을 비교표·개정이유 패널보다 먼저 보인다
            (PDF와 나란히 띄우고 입력하는 사람은 본문이 맨 아래에 있으면 결과를 찾지 못한다) */}
        <div
          className={clsx(
            'bg-white border border-gray-300 shadow-sm',
            articleViewMode === 'segment' && 'lg:col-span-9',
            articleViewMode === 'full' && 'flex flex-col',
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
                        disabled={versionLock}
                        title={versionLockTitle}
                        className="text-xs bg-navy-600 hover:bg-navy-500 px-3 py-1.5 rounded flex items-center gap-1 disabled:opacity-50"
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
                    <div className="w-16">
                      <label className="block text-[11px] text-gray-500 mb-1" title="제3조의2처럼 조 사이에 끼운 조문">
                        의 (선택)
                      </label>
                      <input
                        type="number"
                        min={1}
                        className="input text-sm py-1.5"
                        value={articleMetaDraft.branchNumber}
                        onChange={(e) =>
                          setArticleMetaDraft({
                            ...articleMetaDraft,
                            branchNumber: e.target.value ? Number(e.target.value) : '',
                          })
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
                  {saveArticleMetaMutation.isError && (
                    <p className="text-[11px] text-red-700 mt-2" role="alert">
                      {apiErrorMessage(saveArticleMetaMutation.error, '구조를 저장하지 못했습니다.')}
                    </p>
                  )}
                  {liveSelectedArticle?.displaced && liveSelectedArticle?.liveNumber != null && (
                    <p className="text-[11px] text-amber-800 mt-2" data-testid="structure-live-note">
                      이 조문은{' '}
                      {ymd(liveSelectedArticle.scheduledVersions?.[0]?.effectiveDate ?? policy?.current?.nextScheduledDate ?? null) || '시행 예정일'}
                      부터{' '}
                      {articlePositionLabel(
                        liveAnchorOf(liveSelectedArticle),
                        liveSelectedArticle.liveTitle,
                        formatArticleAnchor(liveAnchorOf(liveSelectedArticle)),
                      )}{' '}
                      자리입니다(시행 예정 재파싱 묶음). 위 칸은 그
                      자리(지금 행)라 고치면 그날부터 적용되고, 오늘 자리({formatArticleAnchor(liveSelectedArticle)})는 그대로입니다.
                    </p>
                  )}
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
                        {v.reparseItem ? (
                          <ReparseBundleLink policyId={id!} reviewId={v.reparseItem.reviewId} />
                        ) : canEdit && (
                          <button
                            type="button"
                            disabled={versionLock}
                            title={versionLockTitle}
                            onClick={() => void versionActions.submit(versionTargetArgs(versionTargetOf(v)))}
                            className="text-[11px] text-blue-700 font-medium hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                          >
                            <Clock size={12} aria-hidden />
                            {versionRun === `submit:${v.id}` ? t('versionDialog.busy') : t('versionDialog.requestReview')}
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
                        {v.reparseItem ? (
                          <ReparseBundleLink policyId={id!} reviewId={v.reparseItem.reviewId} />
                        ) : user?.role === 'admin' && (
                          <span className="shrink-0 inline-flex items-center gap-3">
                            <button
                              type="button"
                              disabled={versionLock}
                              title={versionLockTitle}
                              onClick={() => {
                                approveDlg.open({ ...versionTargetOf(v), minDate: approveMinDate });
                                setApproveNote('');
                                setApproveEffectiveDate('');
                              }}
                              className="text-[11px] text-green-800 font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                            >
                              <CheckCircle size={12} aria-hidden />
                              시행 승인
                            </button>
                            <button
                              type="button"
                              disabled={versionLock}
                              title={versionLockTitle}
                              onClick={() => {
                                rejectDlg.open(versionTargetOf(v));
                                setRejectReason('');
                              }}
                              className="text-[11px] text-red-700 font-medium hover:underline inline-flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
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
              {articleViewMode === 'segment' && selectedArticle && banner.message && (
                <div
                  className={clsx('px-4 py-2 border-b flex items-start gap-2', banner.kind === 'error' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-navy-50')}
                  role="status"
                  data-kind={banner.kind}
                >
                  <p className={clsx('text-xs flex-1', banner.kind === 'error' ? 'text-red-800' : 'text-navy-900')}>{banner.message}</p>
                  <button
                    type="button"
                    onClick={banner.close}
                    className="text-navy-500 hover:text-navy-800 shrink-0"
                    aria-label={t('policyWrites.bannerClose')}
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
                          <StateBadge state={versionDisplayState(version, { currentId: currentVersionId })} />
                          {/* 폐지 예정(오늘 시행 중)은 오른쪽 「폐지 예정 · 날짜부터」가 말한다 — 여기서는 지난 폐지만(T-132 ③) */}
                          {version.repealedOn && String(version.repealedOn).slice(0, 10) <= serviceToday() && (
                            <span className="text-[11px] text-red-700">· {String(version.repealedOn).slice(0, 10)} 폐지</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {version.reparseItem && (version.status === 'draft' || version.status === 'review') && (
                            <ReparseBundleLink policyId={id!} reviewId={version.reparseItem.reviewId} />
                          )}
                          {version.status === 'draft' && canEdit && !version.reparseItem && (
                            <button
                              type="button"
                              disabled={versionLock}
                              title={versionLockTitle}
                              onClick={() => void versionActions.submit(versionTargetArgs(versionTargetOf(version)))}
                              className="text-xs text-blue-600 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                            >
                              <Clock size={12} /> {versionRun === `submit:${version.id}` ? t('versionDialog.busy') : t('versionDialog.requestReview')}
                            </button>
                          )}
                          {version.status === 'review' && user?.role === 'admin' && !version.reparseItem && (
                            <>
                              <button
                                type="button"
                                disabled={versionLock}
                                title={versionLockTitle}
                                onClick={() => {
                                  approveDlg.open({ ...versionTargetOf(version), minDate: approveMinDate });
                                  setApproveNote('');
                                  setApproveEffectiveDate('');
                                }}
                                className="text-xs text-green-700 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                              >
                                <CheckCircle size={12} /> 시행 승인
                              </button>
                              <button
                                type="button"
                                disabled={versionLock}
                                title={versionLockTitle}
                                onClick={() => {
                                  rejectDlg.open(versionTargetOf(version));
                                  setRejectReason('');
                                }}
                                className="text-xs text-red-700 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                              >
                                <Undo2 size={12} /> 반려
                              </button>
                            </>
                          )}
                          {bindablePhase.has(version.id) && (canEdit || version._count?.variableBindings > 0) && (
                            <button
                              type="button"
                              onClick={() => setBindingTarget(version)}
                              className="text-xs text-navy-700 hover:underline"
                            >
                              변수 연결{version._count?.variableBindings ? ` ${version._count.variableBindings}` : ''}
                            </button>
                          )}
                          {/* 시행 예정 철회(T-132 ②) — 가장 늦은 시행 예정 버전만, 재파싱 묶음 버전은 묶음으로 */}
                          {user?.role === 'admin' &&
                            !version.reparseItemId &&
                            versionDisplayState(version, { currentId: currentVersionId }) === 'scheduled' &&
                            selectedDraftBase.kind === 'scheduled' &&
                            liveSelectedArticle?.scheduledVersions?.at(-1)?.id === version.id && (
                            <button
                              type="button"
                              disabled={versionLock}
                              title={versionLockTitle}
                              onClick={() => {
                                setWithdrawReason('');
                                withdrawDlg.open({ ...versionTargetOf(version), effectiveDate: String(version.effectiveDate ?? '').slice(0, 10) });
                              }}
                              className="text-xs text-gray-500 hover:text-red-700 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                            >
                              <Undo2 size={12} /> 시행 예정 철회
                            </button>
                          )}
                          {/* 폐지 예정(T-132 ③) — 오늘은 시행 중, 그날부터 빠진다. 그 전에는 취소할 수 있다 */}
                          {version.id === currentVersionId && version.repealedOn && String(version.repealedOn).slice(0, 10) > serviceToday() && (
                            <span className="text-[11px] text-red-800 bg-red-50 border border-dashed border-red-200 rounded px-1.5 py-0.5" data-testid="repeal-scheduled">
                              폐지 예정 · {String(version.repealedOn).slice(0, 10)}부터
                            </span>
                          )}
                          {version.id === currentVersionId &&
                            version.repealedOn &&
                            String(version.repealedOn).slice(0, 10) > serviceToday() &&
                            user?.role === 'admin' && (
                            <button
                              type="button"
                              disabled={versionLock}
                              title={versionLockTitle}
                              onClick={() => {
                                if (window.confirm(t('policyWrites.version.cancelRepealConfirm', { date: String(version.repealedOn).slice(0, 10) }))) {
                                  const target = versionTargetOf(version);
                                  void versionActions.cancelRepeal({ versionId: target.id, versionNum: target.versionNum, articleId: target.articleId, articleLabel: target.articleLabel });
                                }
                              }}
                              className="text-xs text-gray-500 hover:text-navy-700 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                            >
                              <Undo2 size={12} /> {versionRun === `cancelRepeal:${version.id}` ? t('versionDialog.busy') : t('versionDialog.cancelRepeal')}
                            </button>
                          )}
                          {/* 폐지는 오늘 시행 중인 게시본만 — 시행 예정 개정이 있는 동안은 지금 본문이 archived 라 서버가 받지 않는다 */}
                          {version.status === 'published' &&
                            versionDisplayState(version, { currentId: currentVersionId }) === 'in_force' &&
                            user?.role === 'admin' && (
                            <button
                              type="button"
                              disabled={versionLock}
                              title={versionLockTitle}
                              onClick={() => {
                                setArchiveDate('');
                                archiveDlg.open(versionTargetOf(version));
                              }}
                              className="text-xs text-gray-500 hover:text-red-700 hover:underline flex items-center gap-1 disabled:opacity-50 disabled:no-underline"
                            >
                              <Archive size={12} /> 폐지
                            </button>
                          )}
                        </div>
                      </div>
                      {/* 날짜 3종(T-111) — 사내 시행일 · 발행일시 · 법령 시행일. 법령·후보 화면은 열람자가 못 연다 */}
                      <VersionDatesLine version={version} linkable={user?.role !== 'viewer'} />
                      <div
                        className={clsx(
                          'bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed',
                          BODY_SCALE_CLASS,
                        )}
                        style={bodyScaleStyle(bodyScale)}
                      >
                        <ArticleBodyInline text={version.content} />
                      </div>
                      {version.changeNote && (
                        <p className="text-xs text-gray-400 mt-1.5 italic">변경사유: {version.changeNote}</p>
                      )}
                      {(version.status === 'draft' || version.status === 'review') && version.structure?.kind === 'proposal' && (
                        // 재파싱이 제안한 새 자리(T-110 ②) — 승인한 시행일부터 이 자리로 옮긴다
                        <p className="text-xs text-sky-800 mt-1.5" data-testid="proposed-structure">
                          {/* 조 자리면 조 머리 표기 `제1조(목적)`(T-211), 항·목 자리면 위치 뒤에 그 행의 부제 */}
                          제안 계층:{' '}
                          {articlePositionLabel(
                            version.structure,
                            version.structure.title,
                            `${formatArticleJo(version.structure.number, version.structure.branchNumber)}${
                              version.structure.clauseNumber ? ` 제${version.structure.clauseNumber}항` : ''
                            }${version.structure.itemNumber ? ` 제${version.structure.itemNumber}목` : ''}`,
                          )}{' '}
                          — 승인한 시행일부터 이 자리로 옮깁니다
                        </p>
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
                            className="text-xs text-navy-700 hover:underline disabled:opacity-50 disabled:no-underline"
                            disabled={commentBusy}
                            title={commentBusy && commentRun !== `resolve:${c.id}` ? t('bodyWrites.comment.otherRunning') : undefined}
                            onClick={() => {
                              const article = liveSelectedArticle ?? selectedArticle;
                              if (!article) return;
                              void bodyWrites.resolveComment({ articleId: article.id, articleLabel: articleRowHeading(article), commentId: c.id, resolve: !c.isResolved });
                            }}
                          >
                            {commentRun === `resolve:${c.id}` ? t('versionDialog.busy') : t(c.isResolved ? 'bodyWrites.comment.markOpen' : 'bodyWrites.comment.markResolved')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    className="input flex-1 text-sm"
                    placeholder={t('bodyWrites.comment.placeholder')}
                    maxLength={COMMENT_MAX}
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={!commentDraft.trim() || commentBusy}
                    title={commentBusy && commentRun !== commentPostRun ? t('bodyWrites.comment.otherRunning') : undefined}
                    onClick={() => {
                      const article = liveSelectedArticle ?? selectedArticle;
                      if (!article) return;
                      const content = commentDraft.trim();
                      void bodyWrites.postComment({
                        articleId: article.id,
                        articleLabel: articleRowHeading(article),
                        content,
                        idsBefore: commentsLoaded ? (comments as { id: string }[]).map((x) => x.id) : null,
                        userId: user?.id,
                        clearInput: () => {
                          if (commentNow.current.draft.trim() === content) setCommentDraft('');
                        },
                      });
                    }}
                  >
                    {commentRun === commentPostRun ? t('versionDialog.busy') : t('bodyWrites.comment.submit')}
                  </button>
                </div>
                <LengthCap value={commentDraft} max={COMMENT_MAX} />
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
                      {selectedArticle && <LawLinksPanel articleId={selectedArticle.id} currentVersionId={currentVersionId} canEdit={canEdit} />}
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
                            <option key={v.id} value={v.id}>
                              v{v.versionNum} · {VERSION_STATE_LABEL[versionDisplayState(v, { currentId: currentVersionId })]}
                            </option>
                          ))}
                        </select>
                        <select className="input text-xs" value={compareV2} onChange={(e) => setCompareV2(e.target.value)}>
                          <option value="">비교 버전</option>
                          {versions.map((v: any) => (
                            <option key={v.id} value={v.id}>
                              v{v.versionNum} · {VERSION_STATE_LABEL[versionDisplayState(v, { currentId: currentVersionId })]}
                            </option>
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
                            <button
                              type="button"
                              key={file.id}
                              onClick={() => void openPolicyFile(file)}
                              className="block w-full text-left text-[11px] text-navy-700 hover:underline truncate"
                            >
                              {file.originalName}
                            </button>
                          ))}
                          {pdfFiles.length === 0 && <p className="text-[11px] text-gray-500">PDF 파일이 없습니다.</p>}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-600 mb-1">개정 이력 타임라인</p>
                        <div className="space-y-1 max-h-24 overflow-auto">
                          {versions.slice(0, 6).map((v: any) => {
                            // 발행 이력은 날짜 3종(T-111), 초안·검토 중은 작성일
                            const dates = versionDates(v);
                            return (
                              <p key={v.id} className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                <span className="font-semibold mr-1">v{v.versionNum}</span>
                                <span className="mr-1">{VERSION_STATE_LABEL[versionDisplayState(v, { currentId: currentVersionId })]}</span>
                                <span className="text-gray-500">
                                  {dates ? formatVersionDates(dates) : `작성 ${new Date(v.createdAt).toLocaleDateString('ko-KR')}`}
                                </span>
                              </p>
                            );
                          })}
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
                <div className="max-lg:order-first">
                  {pdfFiles.length > 0 && (
                    <div className="hidden lg:flex items-center justify-end gap-2 px-4 pt-3 print:hidden">
                      <button
                        type="button"
                        onClick={() => void toggleSourcePdf()}
                        disabled={sourcePdfLoading}
                        className="inline-flex items-center gap-1.5 text-xs font-medium border border-gray-300 bg-white px-2.5 py-1.5 rounded hover:bg-gray-50 text-navy-800 disabled:opacity-50"
                      >
                        <FileText size={14} aria-hidden />
                        {sourcePdfLoading ? '원문 불러오는 중…' : sourcePdfUrl ? '원문 PDF 닫기' : '원문 PDF 나란히 보기'}
                      </button>
                    </div>
                  )}
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
                  <div className={clsx(sourcePdfUrl && 'lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start')}>
                    <div
                      ref={fullViewMainRef}
                      data-testid="policy-full-view-body"
                      className={clsx('p-4 space-y-3', BODY_SCALE_CLASS)}
                      style={bodyScaleStyle(bodyScale)}
                    >
                      {/* 시점 응답이 아직 없으면 양식(현행 머리)·빈 본문 대신 받는 중·실패를(T-180) */}
                      {asOfBlocked ? (
                        <AsOfStatusBlock date={asOfDate} failed={asOfFailed} onRetry={() => void refetchAsOf()} />
                      ) : (
                        <TemplateRenderer
                          template={activeTemplate}
                          data={templateRenderData}
                          fullViewGroups={fullViewGroups}
                          highlightQuery={fullViewSearchQuery}
                        />
                      )}
                    </div>
                    {sourcePdfUrl && (
                      <iframe
                        title="원문 PDF"
                        src={sourcePdfUrl}
                        className="hidden lg:block sticky top-3 w-full h-[calc(100vh-6rem)] border border-gray-300 bg-gray-100 print:hidden"
                      />
                    )}
                  </div>
                </div>
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
                    {selectedArticle && <LawLinksPanel articleId={selectedArticle.id} currentVersionId={currentVersionId} canEdit={canEdit} />}
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
          if (file) attachments.upload(file);
          e.target.value = '';
        }}
      />

      {/* 인쇄 창은 body 바로 아래에 그린다(T-133) — 화면 영역(page-shell)은 인쇄 때 숨기므로 그 안에 있으면 통째로 빈 쪽이 나왔다 */}
      {showFullTextModal &&
        createPortal(
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
                  disabled={asOfBlocked}
                  title={asOfBlocked ? t('asOfView.exportBlocked') : undefined}
                  onClick={() => window.print()}
                  className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
                  {asOfBlocked ? '' : ` · ${basisLine}`}
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
              <div
                ref={fullViewModalRef}
                className={clsx('space-y-3', BODY_SCALE_CLASS)}
                style={bodyScaleStyle(bodyScale)}
              >
                {asOfBlocked ? (
                  <AsOfStatusBlock date={asOfDate} failed={asOfFailed} onRetry={() => void refetchAsOf()} />
                ) : (
                  <TemplateRenderer
                    template={activeTemplate}
                    data={templateRenderData}
                    fullViewGroups={printableGroups}
                    highlightQuery={fullViewSearchQuery}
                  />
                )}
              </div>
            </div>
          </div>
        </div>,
          document.body,
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

      {showCrossCompare && policy && (
        <CrossPolicyComparePanel
          policyId={policy.id}
          policyTitle={`${policy.code} ${policy.title}`}
          onClose={() => setShowCrossCompare(false)}
        />
      )}

      {showAttachmentsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-lg">
            <div className="bg-navy-800 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Paperclip size={16} />
                {t('policyDetail.files.title')}
              </div>
              <button type="button" className="text-navy-200 hover:text-white p-1" onClick={() => setShowAttachmentsModal(false)} aria-label={t('policyDetail.files.close')}>
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {fileError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{fileError}</div>}
              {files.length === 0 ? (
                <p className="text-sm text-gray-500">{t('policyDetail.files.empty')}</p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-auto">
                  {files.map((file: any) => {
                    const removing = attachments.removingId === file.id;
                    return (
                      <li key={file.id} className="flex items-start justify-between gap-2 border border-gray-200 rounded px-3 py-2 text-sm">
                        <button
                          type="button"
                          onClick={() => void openPolicyFile(file)}
                          className="text-left text-navy-700 hover:underline break-all min-w-0"
                        >
                          {file.originalName}
                        </button>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* 파일로 받기 — 이름을 누르면 PDF·그림은 새 탭에서 열린다(도구 줄에 있던 파일별 내려받기를 여기로 옮겼다, T-215) */}
                          <button
                            type="button"
                            onClick={() => void openPolicyFile(file, 'download')}
                            className="text-gray-500 hover:text-navy-700 p-1"
                            aria-label={t('policyDetail.attachmentsDownload', { name: file.originalName })}
                            title={t('policyDetail.attachmentsDownloadShort')}
                          >
                            <Download size={14} aria-hidden />
                          </button>
                          <span className="text-xs text-gray-500">{formatSize(file.size)}</span>
                          {canEdit && (
                            <button
                              type="button"
                              // 되돌릴 수 없다. 어느 파일인지 이름으로 확인시킨다.
                              onClick={() => {
                                if (!window.confirm(t('policyDetail.files.confirmDelete', { name: file.originalName }))) return;
                                attachments.remove(file.id);
                              }}
                              disabled={attachments.deleteBusy}
                              className="text-gray-400 hover:text-red-600 disabled:opacity-40 p-1"
                              aria-label={t('policyDetail.files.deleteNamed', { name: file.originalName })}
                              title={t('policyDetail.files.delete')}
                            >
                              {removing ? <span className="text-xs">{t('policyDetail.files.deleting')}</span> : <Trash2 size={14} />}
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
                    disabled={attachments.uploadBusy}
                    className="btn-primary text-sm py-1.5 inline-flex items-center gap-1"
                  >
                    <Upload size={14} />
                    {t(attachments.uploadBusy ? 'policyDetail.files.uploading' : 'policyDetail.files.add')}
                  </button>
                  <button type="button" className="btn-secondary text-sm py-1.5" onClick={() => setShowAttachmentsModal(false)}>
                    {t('policyDetail.files.close')}
                  </button>
                </div>
              )}
              {!canEdit && (
                <button type="button" className="btn-secondary text-sm py-1.5 w-full" onClick={() => setShowAttachmentsModal(false)}>
                  {t('policyDetail.files.close')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {publishDraftsForm && publishDraftsForm.policyId === id && (
        <PublishDraftsDialog
          count={draftOnlyCount}
          form={publishDraftsForm}
          onChange={(next) => setPublishDraftsForm({ ...publishDraftsForm, ...next })}
          busy={publishBusy}
          error={publishDraftsMutation.isError ? publishFailedText(publishDraftsMutation.error) : null}
          onSubmit={submitPublishDrafts}
          onCancel={() => setPublishDraftsForm(null)}
        />
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
                <div className="w-20">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">의 (선택)</label>
                  <p className="text-[10px] text-gray-400 mb-1">제3조의2 → 2</p>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    value={newArticle.branchNumber ?? ''}
                    onChange={(e) =>
                      setNewArticle({
                        ...newArticle,
                        branchNumber: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
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
                      // 조 머리 유무는 지금 행으로(저장도 그렇게 나눈다, T-132 ⑦)
                      const arts = liveRowsOf(newArticle.chapterId);
                      let hint = titleFieldHint(newArticle);
                      if (
                        newArticle.clauseNumber != null &&
                        !chapterHasJoRoot(arts, newArticle.number, newArticle.branchNumber) &&
                        newArticle.title.trim()
                      ) {
                        hint += ` 입력한 제목은 ${formatArticleJo(newArticle.number, newArticle.branchNumber)} 제목으로 저장됩니다.`;
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
              {addArticleError && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  {addArticleError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // 조 머리 유무는 지금 행으로 본다(구조 변경 예정 동안 화면 번호는 오늘 자리, T-132 ⑦)
                    const payloads = buildArticleCreateRequests(newArticle, liveRowsOf(newArticle.chapterId));
                    void bodyWrites.addArticle({ chapterId: newArticle.chapterId, payloads, articleLabel: articleRowHeading(newArticle), token: addArticleToken });
                  }}
                  disabled={!canSubmitNewArticleForm(newArticle) || addArticleBusy}
                  className="btn-primary"
                >
                  {addArticleBusy ? t('versionDialog.busy') : t('bodyWrites.article.submit')}
                </button>
                <button type="button" onClick={closeAddArticle} className="btn-secondary">{t('versionDialog.cancel')}</button>
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
                {/* 분절 보기 머리와 같은 표기 — 항·목을 고쳐도 어느 조인지 보인다(`제2조(수당) · 항 1`) */}
                조문 편집 ·{' '}
                {segmentHeading
                  ? [segmentHeading.joLine, segmentHeading.subLine].filter(Boolean).join(' · ')
                  : articleDisplayLabel(selectedArticle)}
              </div>
              <button
                type="button"
                className="text-navy-100 hover:text-white"
                onClick={closeVersionEditor}
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
                    onClick={() => setVersionContent(String(liveSelectedArticle?.versions?.[0]?.content || '').trim())}
                  >
                    현행 본문 불러오기
                  </button>
                  {selectedDraftBase.kind === 'scheduled' && (
                    <button
                      type="button"
                      className="btn-secondary text-xs py-1"
                      onClick={() => setVersionContent(selectedDraftBase.content.trim())}
                    >
                      시행 예정 본문 불러오기 (v{selectedDraftBase.versionNum}, {selectedDraftBase.effectiveDate}부터)
                    </button>
                  )}
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
              {selectedDraftBase.kind === 'scheduled' && !editingDraftVersionId && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  시행 예정 본문(v{selectedDraftBase.versionNum} · {selectedDraftBase.effectiveDate}부터)을 바탕으로
                  엽니다 — 지금 시행 중인 본문과 다를 수 있습니다. 이 초안은 그 개정 위에 고치는 것이라, 승인할 때
                  시행일을 {selectedDraftBase.effectiveDate}이나 그 뒤로 정하세요.
                </p>
              )}
              <textarea
                className="input resize-none text-sm"
                rows={10}
                placeholder="조문 내용을 입력하세요..."
                value={versionContent}
                onChange={(e) => setVersionContent(e.target.value)}
              />
              {editorError && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                  {editorError}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    // 누를 때의 조문·초안을 실어 보낸다 — 새 초안이면 누를 때 있던 초안들을 함께(응답 없이 끝나면 새로 생긴 초안을 찾는다)
                    const article = liveSelectedArticle ?? selectedArticle;
                    const list = versions as { id: string; status?: string; versionNum?: number }[];
                    void versionActions.requestReview({
                      articleId: article.id,
                      articleLabel: articleRowHeading(article),
                      draftId: editingDraftVersionId,
                      draftNum: list.find((x) => x.id === editingDraftVersionId)?.versionNum,
                      content: versionContent,
                      changeNote: versionChangeNote.trim() || undefined,
                      token: editorToken,
                      userId: user?.id,
                    });
                  }}
                  disabled={!versionContent.trim() || versionLock}
                  title={versionLockTitle}
                  className="btn-primary"
                >
                  <Clock size={14} className="inline mr-1" />
                  {versionRun === `review:${selectedArticle.id}` ? t('versionDialog.busy') : t('versionDialog.requestReview')}
                </button>
                <button
                  type="button"
                  onClick={closeVersionEditor}
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

      {appendixDlg.target && canEdit && id && (
        <AppendixDialog
          mode={appendixDlg.target.mode}
          draft={appendixDraft}
          onDraft={setAppendixDraft}
          kindLabel={appendixKindLabel}
          busy={appendixRun === (appendixDlg.target.mode === 'edit' ? `appendix:${appendixDlg.target.id}` : 'appendix:new')}
          locked={appendixBusy}
          error={appendixDlg.error}
          onConfirm={() => {
            const target = appendixDlg.target;
            if (!target || !appendixDraft.title.trim()) return;
            void bodyWrites.saveAppendix({
              mode: target.mode,
              appendixId: target.mode === 'edit' ? target.id : undefined,
              draft: appendixDraft,
              kindLabel: appendixKindLabel[appendixDraft.kind],
              idsBefore: ((policy?.appendices ?? []) as { id: string }[]).map((a) => a.id),
              token: appendixDlg.token,
            });
          }}
          onCancel={appendixDlg.close}
        />
      )}

      {approveDlg.target && (
        <ApproveDialog
          note={approveNote}
          onNote={setApproveNote}
          date={approveEffectiveDate}
          onDate={setApproveEffectiveDate}
          minDate={approveDlgMin}
          tooEarly={approveTooEarly}
          today={serviceToday()}
          busy={versionRun === `approve:${approveDlg.target.id}`}
          locked={versionLock}
          error={approveDlg.error}
          onConfirm={() => {
            const note = approveNote.trim();
            if (!note || !approveDlg.target) return;
            void versionActions.approve({
              versionId: approveDlg.target.id,
              versionNum: approveDlg.target.versionNum,
              articleId: approveDlg.target.articleId,
              articleLabel: approveDlg.target.articleLabel,
              token: approveDlg.token,
              changeNote: note,
              effectiveDate: approveEffectiveDate || undefined,
            });
          }}
          onCancel={() => {
            approveDlg.close();
            setApproveNote('');
            setApproveEffectiveDate('');
          }}
        />
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
        <ActiveToggleDialog
          next={activeToggleTarget}
          title={policy.title}
          busy={toggleBusy}
          error={toggleActiveMutation.isError && toggleActiveMutation.variables?.routeId === id ? apiErrorMessage(toggleActiveMutation.error, t('policyDetail.status.toggleFailed')) : null}
          onConfirm={() => {
            if (!startRun('toggle', id!)) return;
            toggleActiveMutation.mutate({ ...infoTarget(), next: activeToggleTarget });
          }}
          onCancel={() => setActiveToggleTarget(null)}
        />
      )}

      {rejectDlg.target && (
        <RejectDialog
          reason={rejectReason}
          onReason={setRejectReason}
          busy={versionRun === `reject:${rejectDlg.target.id}`}
          locked={versionLock}
          error={rejectDlg.error}
          onConfirm={() => {
            const reason = rejectReason.trim();
            if (!reason || !rejectDlg.target) return;
            void versionActions.reject({ ...versionTargetArgs(rejectDlg.target), token: rejectDlg.token, reason });
          }}
          onCancel={() => {
            rejectDlg.close();
            setRejectReason('');
          }}
        />
      )}

      {bindingTarget && (
        <VariableBindingDialog
          version={bindingTarget}
          phase={bindablePhase.get(bindingTarget.id)}
          articleId={selectedArticle?.id ?? bindingTarget.articleId}
          canEdit={canEdit}
          onClose={() => setBindingTarget(null)}
        />
      )}

      {withdrawDlg.target && (
        <WithdrawDialog
          versionNum={withdrawDlg.target.versionNum}
          effectiveDate={withdrawDlg.target.effectiveDate}
          reason={withdrawReason}
          onReason={setWithdrawReason}
          busy={versionRun === `withdraw:${withdrawDlg.target.id}`}
          locked={versionLock}
          error={withdrawDlg.error}
          onConfirm={() => {
            const reason = withdrawReason.trim();
            if (!reason || !withdrawDlg.target) return;
            void versionActions.withdraw({ ...versionTargetArgs(withdrawDlg.target), token: withdrawDlg.token, reason });
          }}
          onCancel={withdrawDlg.close}
        />
      )}

      {archiveDlg.target && (
        <ArchiveDialog
          versionNum={archiveDlg.target.versionNum}
          date={archiveDate}
          onDate={setArchiveDate}
          today={serviceToday()}
          busy={versionRun === `archive:${archiveDlg.target.id}`}
          locked={versionLock}
          error={archiveDlg.error}
          onConfirm={() => {
            if (!archiveDlg.target) return;
            void versionActions.archive({ ...versionTargetArgs(archiveDlg.target), token: archiveDlg.token, repealedOn: archiveDate || undefined });
          }}
          onCancel={archiveDlg.close}
        />
      )}

      {reorderOpen && (
        <ArticleReorderPanel
          key={reorderSig}
          chapters={policy?.chapters}
          saving={reorder.saving}
          error={reorderError}
          {...reorderNotice({ note: reorderNote, signature: reorderSig, redrawn: reorder.redrawn, saving: reorder.saving }, t)}
          onCancel={() => setReorderOpen(false)}
          onSave={reorder.save}
        />
      )}
    </div>
  );
}

/**
 * 재파싱 묶음의 버전(T-110 ②) — 하나씩 검토 요청·승인·반려하지 않고 재파싱 검토 화면에서 묶음으로 처리한다.
 */
function ReparseBundleLink({ policyId, reviewId }: { policyId: string; reviewId: string }) {
  return (
    <Link
      to={`/policies/${policyId}/reparse/${reviewId}`}
      className="text-[11px] px-1.5 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 shrink-0"
      title="재파싱 묶음의 버전입니다 — 재파싱 검토 화면에서 묶음으로 검토 요청·승인·반려합니다"
      data-testid="reparse-bundle-link"
    >
      재파싱 묶음
    </Link>
  );
}
