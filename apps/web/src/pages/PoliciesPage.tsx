import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { policiesApi } from '../api/policies';
import { Plus, FileText, FileUp, Trash2, Search, ChevronDown } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { PolicyHierarchyPanel } from '../components/PolicyHierarchyPanel';
import { FavoriteButton } from '../components/FavoriteButton';
import { INDEX_KEYS, compareKo, countByIndexKey, indexKeyOf } from '../lib/hangulIndex';
import { EmptyState } from '../components/ui/EmptyState';
import { toast } from '../stores/toastStore';
import { useI18n } from '../i18n/useI18n';
import { type ParseProfile, type ParsedPolicyDraft } from '../lib/policyImportParser';
import { parsePolicyTextWithSplitMode, type ImportSplitMode } from '../lib/policyImportSplitModes';
import { defaultImportRefineOptions, refineImportRawText, type ImportRefineOptions } from '../lib/policyImportRefine';
import {
  countInferredHierarchy,
  expandChaptersWithHierarchy,
  renumberChapters,
  type HierarchyArticleRow,
} from '../lib/policyImportHierarchy';
import { extractPolicyText } from '../lib/policyTextExtract';
import { useAuthStore } from '../stores/authStore';
import { ArticleBodyInline } from '../components/ArticleBodyInline';

function getPolicyMeta(policy: any) {
  const meta = policy?.metadata && typeof policy.metadata === 'object' ? policy.metadata : {};
  const department = typeof meta.department === 'string' ? meta.department.trim() : '';
  const category = typeof meta.category === 'string' ? meta.category.trim() : '';
  return { department, category };
}

export default function PoliciesPage() {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [view, setView] = useState<'list' | 'tree'>('list');
  /** 가나다 색인 (T-77). null 이면 전체 */
  const [indexKey, setIndexKey] = useState<string | null>(null);
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  const [showImportAdvanced, setShowImportAdvanced] = useState(false);
  const [createMode, setCreateMode] = useState<'manual' | 'import'>('manual');
  const [form, setForm] = useState({
    code: '',
    title: '',
    description: '',
    department: '',
    category: '',
  });
  const [importRawText, setImportRawText] = useState('');
  const [parseProfile, setParseProfile] = useState<ParseProfile>('mixed');
  const [parsedDraft, setParsedDraft] = useState<ParsedPolicyDraft>({ chapters: [] });
  const [importExtracting, setImportExtracting] = useState(false);
  const [importError, setImportError] = useState('');
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [selectedDepartment, setSelectedDepartment] = useState(searchParams.get('department') || 'all');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all');
  /** 시행 상태 필터 (T-15). 비활성 규정을 지우지 않고 일하는 목록에서만 빼려면 필요하다 */
  const [selectedStatus, setSelectedStatus] = useState(searchParams.get('status') || 'all');
  const [activeIssueTarget, setActiveIssueTarget] = useState<string>('');
  const [cleanupOptions, setCleanupOptions] = useState({
    renumber: true,
    trimEmptyArticles: true,
    inferHierarchy: true,
  });
  const [importSplitMode, setImportSplitMode] = useState<ImportSplitMode>('auto');
  const [importDelimiter, setImportDelimiter] = useState('');
  const [importRefineOptions, setImportRefineOptions] = useState<ImportRefineOptions>(() => defaultImportRefineOptions());
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chapterRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const articleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['policies'],
    queryFn: policiesApi.list,
  });

  const { data: importLogs = [] } = useQuery({
    queryKey: ['policy-import-logs'],
    queryFn: policiesApi.listImportLogs,
  });

  const buildRawFallbackDraft = (rawText?: string): ParsedPolicyDraft => {
    const text = String(rawText || '').trim();
    if (!text) return { chapters: [] };
    return {
      chapters: [
        {
          number: 1,
          title: '원문',
          auto: true,
          articles: [{ number: 1, title: '본문', content: text }],
        },
      ],
    };
  };

  const createMutation = useMutation({
    mutationFn: async ({
      mode,
      payload,
      rawText,
      splitMode,
      splitDelimiter,
    }: {
      mode: 'manual' | 'import';
      payload: {
        code: string;
        title: string;
        description?: string;
        department?: string;
        category?: string;
      };
      rawText?: string;
      splitMode?: ImportSplitMode;
      splitDelimiter?: string;
    }) => {
      const policy = await policiesApi.create(payload);
      if (mode !== 'import') return policy;

      const parsed = parsePolicyTextWithSplitMode(
        rawText || '',
        splitMode ?? 'auto',
        splitDelimiter ?? '',
        parseProfile,
      );
      let chaptersToCreate = parsedDraft.chapters.length ? parsedDraft.chapters : parsed.chapters;
      if (!chaptersToCreate.length) {
        chaptersToCreate = buildRawFallbackDraft(rawText).chapters;
      }
      if (cleanupOptions.trimEmptyArticles) {
        chaptersToCreate = chaptersToCreate
          .map((chapter) => ({
            ...chapter,
            articles: chapter.articles.filter((a) => (a.title || '').trim() || (a.content || '').trim()),
          }))
          .filter((chapter) => chapter.articles.length > 0);
      }
      // 빈 조를 걷어낸 뒤에 번호를 매겨야 1, 2, 4… 처럼 구멍이 남지 않는다
      if (cleanupOptions.renumber) {
        chaptersToCreate = renumberChapters(chaptersToCreate);
      }
      // 항(①②…)·목(1. 2. …) 자동 추론: 조 번호를 유지하므로 renumber 이후에 적용해야 한다
      const chaptersForCreate: { number: number; title?: string; articles: HierarchyArticleRow[] }[] =
        cleanupOptions.inferHierarchy ? expandChaptersWithHierarchy(chaptersToCreate) : chaptersToCreate;

      for (const chapter of chaptersForCreate) {
        // 원문에 장 표기가 없어 파서가 만든 장(auto)은 숨김 장으로 등록한다.
        // 없는 "제1장 총칙"을 임의로 만들어 붙이지 않기 위함 (SRS POLICY-6)
        const isAutoChapter = (chapter as { auto?: boolean }).auto === true;
        const createdChapter = await policiesApi.createChapter(policy.id, {
          number: chapter.number,
          title: isAutoChapter ? '' : chapter.title || '본문',
          suppressHeader: isAutoChapter,
        });
        for (const article of chapter.articles) {
          const isJoRoot = article.clauseNumber == null && article.itemNumber == null;
          await policiesApi.createArticle(policy.id, createdChapter.id, {
            number: article.number,
            // 항·목 행은 제목 없이 본문만 등록한다(조 제목과 중복 방지)
            title: isJoRoot ? article.title || '조문' : '',
            content: article.content || '',
            ...(article.clauseNumber != null ? { clauseNumber: article.clauseNumber } : {}),
            ...(article.itemNumber != null ? { itemNumber: article.itemNumber } : {}),
          });
        }
      }
      await policiesApi.createImportLog({
        policyId: policy.id,
        sourceName: mode === 'import' ? 'manual-import' : 'manual',
        parseProfile,
        chapterCount: chaptersToCreate.length,
        articleCount: chaptersToCreate.reduce((acc, chapter) => acc + chapter.articles.length, 0),
        cleanupOptions,
        status: 'success',
      });
      return policy;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] });
      toast(t('policies.createSuccess'), 'success');
      setShowCreate(false);
      setCreateMode('manual');
      setForm({ code: '', title: '', description: '', department: '', category: '' });
      setImportRawText('');
      setParsedDraft({ chapters: [] });
      setImportError('');
      setCleanupOptions({ renumber: true, trimEmptyArticles: true, inferHierarchy: true });
      setImportSplitMode('auto');
      setImportDelimiter('');
      setImportRefineOptions(defaultImportRefineOptions());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: policiesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  /**
   * 시행중 ↔ 비활성 (T-15). 목록에서는 확인 없이 바로 바꾼다 —
   * 되돌리기가 같은 버튼 한 번이고, 삭제와 달리 잃는 것이 없다.
   * 무엇이 바뀌고 무엇이 안 바뀌는지에 대한 설명은 규정 상세의 확인 창에 있다.
   */
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      policiesApi.update(id, { isActive: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  });

  const updateChapterField = (chapterIdx: number, field: 'number' | 'title', value: string) => {
    setParsedDraft((prev) => {
      const chapters = [...prev.chapters];
      const target = { ...chapters[chapterIdx] };
      if (field === 'number') target.number = Math.max(1, Number(value || 1));
      else target.title = value;
      chapters[chapterIdx] = target;
      return { chapters };
    });
  };

  const updateArticleField = (
    chapterIdx: number,
    articleIdx: number,
    field: 'number' | 'title' | 'content',
    value: string,
  ) => {
    setParsedDraft((prev) => {
      const chapters = [...prev.chapters];
      const chapter = { ...chapters[chapterIdx] };
      const articles = [...chapter.articles];
      const article = { ...articles[articleIdx] };
      if (field === 'number') article.number = Math.max(1, Number(value || 1));
      else if (field === 'title') article.title = value;
      else article.content = value;
      articles[articleIdx] = article;
      chapter.articles = articles;
      chapters[chapterIdx] = chapter;
      return { chapters };
    });
  };

  const removeChapter = (chapterIdx: number) => {
    setParsedDraft((prev) => ({ chapters: prev.chapters.filter((_, i) => i !== chapterIdx) }));
  };

  const removeArticle = (chapterIdx: number, articleIdx: number) => {
    setParsedDraft((prev) => {
      const chapters = [...prev.chapters];
      const chapter = { ...chapters[chapterIdx] };
      chapter.articles = chapter.articles.filter((_, i) => i !== articleIdx);
      chapters[chapterIdx] = chapter;
      return { chapters: chapters.filter((c) => c.articles.length > 0) };
    });
  };

  const addChapter = () => {
    setParsedDraft((prev) => {
      const nextNo = prev.chapters.reduce((max, c) => Math.max(max, c.number), 0) + 1;
      return {
        chapters: [
          ...prev.chapters,
          { number: nextNo, title: '새 장', articles: [{ number: 1, title: '새 조문', content: '' }] },
        ],
      };
    });
  };

  const addArticle = (chapterIdx: number) => {
    setParsedDraft((prev) => {
      const chapters = [...prev.chapters];
      const chapter = { ...chapters[chapterIdx] };
      const nextNo = chapter.articles.reduce((max, a) => Math.max(max, a.number), 0) + 1;
      chapter.articles = [...chapter.articles, { number: nextNo, title: '새 조문', content: '' }];
      chapters[chapterIdx] = chapter;
      return { chapters };
    });
  };

  const adoptRawAsSingleArticle = () => {
    setParsedDraft(buildRawFallbackDraft(importRawText));
  };

  const applyImportRefine = () => {
    setImportRawText(refineImportRawText(importRawText, importRefineOptions));
  };

  const wrapImportSelectionBold = () => {
    const ta = importTextareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = importRawText;
    if (start >= end) return;
    const sel = val.slice(start, end);
    const next = `${val.slice(0, start)}**${sel}**${val.slice(end)}`;
    setImportRawText(next);
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(start + 2, end + 2);
    });
  };

  const departmentOptions = useMemo(() => {
    const values = new Set<string>();
    for (const policy of policies) {
      const { department } = getPolicyMeta(policy);
      if (department) values.add(department);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [policies]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>();
    for (const policy of policies) {
      const { category } = getPolicyMeta(policy);
      if (category) values.add(category);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [policies]);

  // 색인 칸의 건수는 색인 자체를 빼고 센다(다른 칸이 0으로 보이면 안 된다)
  const indexCounts = countByIndexKey(policies as any[], (p: any) => p.title);
  const filtered = policies.filter((p: any) => {
    const { department, category } = getPolicyMeta(p);
    const q = search.trim().toLowerCase();
    const matchedSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      department.toLowerCase().includes(q) ||
      category.toLowerCase().includes(q);
    const matchedDepartment = selectedDepartment === 'all' || department === selectedDepartment;
    const matchedCategory = selectedCategory === 'all' || category === selectedCategory;
    const matchedIndex = !indexKey || indexKeyOf(p.title) === indexKey;
    const matchedStatus =
      selectedStatus === 'all' ||
      (selectedStatus === 'active' ? p.isActive !== false : p.isActive === false);
    return matchedSearch && matchedDepartment && matchedCategory && matchedIndex && matchedStatus;
  });

  // 색인으로 훑을 때는 사전처럼 가나다 순이어야 읽힌다. 평소에는 기존 순서를 유지한다.
  const visible = indexKey
    ? [...filtered].sort((a: any, b: any) => compareKo(a.title, b.title))
    : filtered;

  useEffect(() => {
    const key = `policy-import-profile:${user?.tenantId || 'default'}`;
    const saved = localStorage.getItem(key) as ParseProfile | null;
    if (saved === 'mixed' || saved === 'korean' || saved === 'english') {
      setParseProfile(saved);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    const key = `policy-import-profile:${user?.tenantId || 'default'}`;
    localStorage.setItem(key, parseProfile);
  }, [parseProfile, user?.tenantId]);

  useEffect(() => {
    const key = `policy-import-split:${user?.tenantId || 'default'}`;
    const saved = localStorage.getItem(key) as ImportSplitMode | null;
    if (
      saved === 'auto' ||
      saved === 'blank_block' ||
      saved === 'line_each' ||
      saved === 'delimiter' ||
      saved === 'markdown'
    ) {
      setImportSplitMode(saved);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    const key = `policy-import-split:${user?.tenantId || 'default'}`;
    localStorage.setItem(key, importSplitMode);
  }, [importSplitMode, user?.tenantId]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set('q', search.trim());
    if (selectedDepartment !== 'all') next.set('department', selectedDepartment);
    if (selectedCategory !== 'all') next.set('category', selectedCategory);
    if (selectedStatus !== 'all') next.set('status', selectedStatus);
    setSearchParams(next, { replace: true });
  }, [search, selectedDepartment, selectedCategory, selectedStatus, setSearchParams]);

  useEffect(() => {
    setParsedDraft(parsePolicyTextWithSplitMode(importRawText, importSplitMode, importDelimiter, parseProfile));
  }, [importRawText, importSplitMode, importDelimiter, parseProfile]);

  const parsedArticleCount = parsedDraft.chapters.reduce((acc, chapter) => acc + chapter.articles.length, 0);
  // 미리보기: 항·목 자동 인식으로 몇 개가 만들어질지 미리 보여준다
  const inferredHierarchyCounts = useMemo(
    () => countInferredHierarchy(parsedDraft.chapters),
    [parsedDraft.chapters],
  );
  const importFallbackBlob =
    parsedDraft.chapters.length === 1 &&
    parsedDraft.chapters[0].title === '원문' &&
    parsedDraft.chapters[0].articles.length === 1 &&
    parsedDraft.chapters[0].articles[0].title === '본문';
  const importValidation = useMemo(() => {
    type Issue = { key: string; message: string; chapterIdx?: number; articleIdx?: number };
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    if (importSplitMode === 'delimiter' && !importDelimiter.trim()) {
      errors.push({
        key: 'delimiter-empty',
        message: '구분자 모드에서는 구분 문자열을 입력해 주세요.',
      });
    }
    if (parsedDraft.chapters.length === 0) {
      if ((importRawText || '').trim()) {
        warnings.push({
          key: 'global-fallback-available',
          message: '자동 파싱 결과가 없어도 원문 전체 1개 조로 등록할 수 있습니다.',
        });
      } else {
        errors.push({ key: 'global-empty', message: '파싱된 장/조문이 없습니다. 원문 형식 또는 파싱 규칙을 확인해 주세요.' });
      }
      return { errors, warnings };
    }

    const chapterNoSeen = new Map<number, number>();
    parsedDraft.chapters.forEach((chapter, ci) => {
      if (!chapter.title.trim()) {
        errors.push({ key: `ch-title-${ci}`, message: `${ci + 1}번째 장의 제목이 비어 있습니다.`, chapterIdx: ci });
      }
      chapterNoSeen.set(chapter.number, (chapterNoSeen.get(chapter.number) || 0) + 1);
      if (!chapter.articles.length) {
        errors.push({ key: `ch-empty-${ci}`, message: `${chapter.number}장의 조문이 비어 있습니다.`, chapterIdx: ci });
      }

      const articleNoSeen = new Map<number, number>();
      chapter.articles.forEach((article, ai) => {
        if (!article.title.trim()) {
          warnings.push({
            key: `a-title-${ci}-${ai}`,
            message: `${chapter.number}장 ${ai + 1}번째 조문의 제목이 비어 있습니다.`,
            chapterIdx: ci,
            articleIdx: ai,
          });
        }
        if (!article.content.trim()) {
          warnings.push({
            key: `a-body-${ci}-${ai}`,
            message: `${chapter.number}장 제${article.number}조 본문이 비어 있습니다.`,
            chapterIdx: ci,
            articleIdx: ai,
          });
        }
        articleNoSeen.set(article.number, (articleNoSeen.get(article.number) || 0) + 1);
      });
      for (const [no, count] of articleNoSeen.entries()) {
        if (count > 1) {
          errors.push({
            key: `a-dup-${ci}-${no}`,
            message: `${chapter.number}장에 제${no}조가 ${count}개 중복되어 있습니다.`,
            chapterIdx: ci,
          });
        }
      }
    });

    for (const [no, count] of chapterNoSeen.entries()) {
      if (count > 1) errors.push({ key: `ch-dup-${no}`, message: `제${no}장이 ${count}개 중복되어 있습니다.` });
    }
    if (warnings.length > 12) {
      warnings.splice(12);
      warnings.push({ key: 'warning-truncated', message: '경고가 많아 일부만 표시했습니다. 장/조 제목과 본문 공란을 확인해 주세요.' });
    }
    return { errors, warnings };
  }, [importDelimiter, importRawText, importSplitMode, parsedDraft]);

  const jumpToIssueTarget = (chapterIdx?: number, articleIdx?: number) => {
    if (chapterIdx == null) return;
    const articleKey = articleIdx != null ? `${chapterIdx}-${articleIdx}` : '';
    const target = articleKey ? articleRefs.current[articleKey] : chapterRefs.current[String(chapterIdx)];
    if (!target) return;
    const key = articleKey || `chapter-${chapterIdx}`;
    setActiveIssueTarget(key);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setActiveIssueTarget(''), 1800);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title={t('policies.title')}
        description={t('policies.subtitle', { n: policies.length })}
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded border border-gray-300 overflow-hidden" role="tablist">
              {([['list', '목록'], ['tree', '체계도']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => setView(key)}
                  className={clsx(
                    'px-3 py-1.5 text-sm transition-colors',
                    view === key ? 'bg-navy-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* PDF는 서버 추출(조항 계층 인식)이 정확해 별도 화면으로 보낸다 */}
            <Link to="/policies/import" className="btn-secondary text-sm">
              <FileUp size={15} /> PDF 가져오기
            </Link>
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary text-sm">
              <Plus size={15} /> {t('policies.register')}
            </button>
          </div>
        }
      />

      <div className="card overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          <span>{t('policies.guideTitle')}</span>
          <span className="text-xs font-normal text-navy-600">{showGuide ? t('policies.guideToggleHide') : t('policies.guideToggleShow')}</span>
        </button>
        {showGuide && (
          <div className="px-4 pb-4 border-t border-gray-100 text-sm text-gray-600 space-y-2">
            <p>{t('policies.guideIntro')}</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>{t('policies.guideSearch')}</li>
              <li>{t('policies.guideRegister')}</li>
              <li>{t('policies.guideDetail')}</li>
              <li>{t('policies.guideDelete')}</li>
            </ul>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="card overflow-hidden">
          <div className="section-card__head">{t('policies.createTitle')}</div>
          <div className="p-5">
            <div className="mb-3 inline-flex rounded border border-gray-300 overflow-hidden text-xs">
              <button
                type="button"
                className={`px-3 py-1.5 ${createMode === 'manual' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600'}`}
                onClick={() => setCreateMode('manual')}
              >
                기본 등록
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 border-l border-gray-300 ${createMode === 'import' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600'}`}
                onClick={() => setCreateMode('import')}
              >
                기존 규정 가져오기
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('policies.code')} <span className="text-red-500">*</span>
                </label>
                <input
                  className="input"
                  placeholder={t('policies.placeholderCode')}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  {t('policies.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  className="input"
                  placeholder={t('policies.placeholderName')}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('policies.desc')}</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  placeholder={t('policies.placeholderDesc')}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">담당 부서</label>
                <input
                  className="input"
                  placeholder="예) 정보보안팀"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">규정 분류</label>
                <input
                  className="input"
                  placeholder="예) 정보보안"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </div>
              {createMode === 'import' && (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">원문 업로드/붙여넣기</label>
                  <div className="inline-flex rounded border border-gray-300 overflow-hidden text-[11px]">
                    <button
                      type="button"
                      className={`px-2.5 py-1 ${parseProfile === 'mixed' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600'}`}
                      onClick={() => setParseProfile('mixed')}
                    >
                      혼합형
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 border-l border-gray-300 ${parseProfile === 'korean' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600'}`}
                      onClick={() => setParseProfile('korean')}
                    >
                      한국형
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-1 border-l border-gray-300 ${parseProfile === 'english' ? 'bg-navy-700 text-white' : 'bg-white text-gray-600'}`}
                      onClick={() => setParseProfile('english')}
                    >
                      영문형
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setImportExtracting(true);
                        setImportError('');
                        try {
                          const text = await extractPolicyText(f);
                          setImportRawText(text);
                        } catch (err: any) {
                          setImportError(err?.message || '파일 텍스트 추출에 실패했습니다.');
                        } finally {
                          setImportExtracting(false);
                        }
                        e.target.value = '';
                      }}
                      className="text-xs"
                    />
                    <span className="text-[11px] text-gray-500">TXT / DOCX / PDF</span>
                  </div>
                  {importExtracting && <p className="text-[11px] text-gray-500">문서에서 텍스트 추출 중...</p>}
                  {importError && (
                    <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                      {importError}
                    </p>
                  )}
                  <textarea
                    ref={importTextareaRef}
                    className="input font-mono text-xs min-h-[180px]"
                    placeholder="기존 규정 전문을 붙여넣어 주세요. (Markdown 모드: # 장 제목, ## 조 제목)"
                    value={importRawText}
                    onChange={(e) => setImportRawText(e.target.value)}
                  />
                  <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
                    파싱 미리보기: 장 {parsedDraft.chapters.length}개 / 조문 {parsedArticleCount}개
                  </div>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-xs font-medium text-navy-800 py-2 px-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100"
                    onClick={() => setShowImportAdvanced((v) => !v)}
                    aria-expanded={showImportAdvanced}
                  >
                    {t('policies.importAdvanced')}
                    <ChevronDown size={14} className={clsx('transition-transform', showImportAdvanced && 'rotate-180')} />
                  </button>
                  {showImportAdvanced && (
                    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-gray-700">구분 모드</div>
                        <select
                          className="input text-xs w-full max-w-md"
                          value={importSplitMode}
                          onChange={(e) => setImportSplitMode(e.target.value as ImportSplitMode)}
                        >
                          <option value="auto">자동 (제N조·로마 장·십진 항 등 패턴)</option>
                          <option value="blank_block">빈 줄마다 새 조 (문단 단위)</option>
                          <option value="line_each">한 줄마다 새 조</option>
                          <option value="delimiter">구분자로 자르기</option>
                          <option value="markdown">Markdown (# 장 / ## 조)</option>
                        </select>
                        {importSplitMode === 'delimiter' && (
                          <input
                            className="input text-xs w-full max-w-md font-mono"
                            placeholder="예) --- 또는 ### 구분선"
                            value={importDelimiter}
                            onChange={(e) => setImportDelimiter(e.target.value)}
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-gray-700">원문 정제</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-700">
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={importRefineOptions.collapseSpaces}
                              onChange={(e) =>
                                setImportRefineOptions((p) => ({ ...p, collapseSpaces: e.target.checked }))
                              }
                            />
                            가로 공백 정리
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={importRefineOptions.trimLines}
                              onChange={(e) => setImportRefineOptions((p) => ({ ...p, trimLines: e.target.checked }))}
                            />
                            줄 끝 공백 제거
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={importRefineOptions.removeFormCoverLines}
                              onChange={(e) =>
                                setImportRefineOptions((p) => ({ ...p, removeFormCoverLines: e.target.checked }))
                              }
                            />
                            표지 머릿글 제거
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={importRefineOptions.unifyQuotes}
                              onChange={(e) => setImportRefineOptions((p) => ({ ...p, unifyQuotes: e.target.checked }))}
                            />
                            따옴표 통일
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="btn-secondary text-[11px] py-1 px-2" onClick={applyImportRefine}>
                            정제 적용
                          </button>
                          <button type="button" className="btn-secondary text-[11px] py-1 px-2" onClick={wrapImportSelectionBold}>
                            선택 구간 **굵게**
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-700">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={cleanupOptions.renumber}
                            onChange={(e) => setCleanupOptions((prev) => ({ ...prev, renumber: e.target.checked }))}
                          />
                          번호 자동 재정렬
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={cleanupOptions.trimEmptyArticles}
                            onChange={(e) => setCleanupOptions((prev) => ({ ...prev, trimEmptyArticles: e.target.checked }))}
                          />
                          빈 조문 자동 정리
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={cleanupOptions.inferHierarchy}
                            onChange={(e) => setCleanupOptions((prev) => ({ ...prev, inferHierarchy: e.target.checked }))}
                          />
                          항·목 자동 인식 (①②… / 1. 2. …)
                        </label>
                      </div>
                      {cleanupOptions.inferHierarchy && (
                        <p className="text-[11px] text-gray-500">
                          {inferredHierarchyCounts.clauses + inferredHierarchyCounts.items > 0
                            ? `현재 원문에서 항 ${inferredHierarchyCounts.clauses}개 · 목 ${inferredHierarchyCounts.items}개를 인식했습니다. 등록 시 조·항·목 구조로 저장됩니다.`
                            : '현재 원문에서는 항·목 패턴(①②… / 1. 2. …)이 감지되지 않았습니다. 조 단위로만 등록됩니다.'}
                        </p>
                      )}
                    </div>
                  )}
                  {(importValidation.errors.length > 0 || importValidation.warnings.length > 0) && (
                    <div className="border border-gray-200 rounded bg-white p-2.5 space-y-1.5">
                      <div className="text-xs font-semibold text-gray-700">등록 전 검증</div>
                      {importValidation.errors.length > 0 && (
                        <ul className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-1">
                          {importValidation.errors.map((issue) => (
                            <li key={issue.key}>
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => jumpToIssueTarget(issue.chapterIdx, issue.articleIdx)}
                              >
                                • {issue.message}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {importValidation.warnings.length > 0 && (
                        <ul className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 space-y-1">
                          {importValidation.warnings.map((issue) => (
                            <li key={issue.key}>
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => jumpToIssueTarget(issue.chapterIdx, issue.articleIdx)}
                              >
                                • {issue.message}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {importFallbackBlob && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      자동으로 장·조 구분에 실패해 원문 전체를 한 조에 담았습니다. 아래에서 장·조를 나누거나 제목을 수정한 뒤 등록하세요.
                    </p>
                  )}
                  {(parsedArticleCount > 0 || importRawText.trim().length > 0) && (
                    <div className="border border-gray-200 rounded bg-white">
                      <div className="px-2.5 py-2 border-b border-gray-100 text-xs font-semibold text-gray-700">
                        파싱 결과 검토/수정
                        <button type="button" className="ml-2 text-[11px] text-navy-700 hover:underline" onClick={addChapter}>
                          + 장 추가
                        </button>
                      </div>
                      {parsedArticleCount === 0 && importRawText.trim().length > 0 && (
                        <div className="px-2.5 py-2 text-[11px] text-gray-600 border-b border-gray-100">
                          인식된 장·조가 없습니다. 원문이 짧거나 형식이 특이한 경우입니다.{' '}
                          <button type="button" className="text-navy-700 hover:underline" onClick={addChapter}>
                            장·조 직접 추가
                          </button>
                          하거나{' '}
                          <button type="button" className="text-navy-700 hover:underline" onClick={adoptRawAsSingleArticle}>
                            원문 전체 1개 조로 넣기
                          </button>
                          로 바로 등록 가능합니다.
                        </div>
                      )}
                      <div className="max-h-[380px] overflow-auto p-2.5 space-y-2">
                        {parsedDraft.chapters.map((chapter, chapterIdx) => (
                          <div
                            key={`${chapterIdx}-${chapter.number}`}
                            ref={(el) => {
                              chapterRefs.current[String(chapterIdx)] = el;
                            }}
                            className={`border rounded p-2 space-y-2 transition-colors ${
                              activeIssueTarget === `chapter-${chapterIdx}`
                                ? 'border-amber-400 bg-amber-50'
                                : 'border-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                className="input w-20 text-xs"
                                min={1}
                                value={chapter.number}
                                onChange={(e) => updateChapterField(chapterIdx, 'number', e.target.value)}
                              />
                              <input
                                className="input flex-1 text-xs"
                                value={chapter.title}
                                onChange={(e) => updateChapterField(chapterIdx, 'title', e.target.value)}
                              />
                              <button
                                type="button"
                                className="text-[11px] text-red-600 hover:underline"
                                onClick={() => removeChapter(chapterIdx)}
                              >
                                장 삭제
                              </button>
                              <button
                                type="button"
                                className="text-[11px] text-navy-700 hover:underline"
                                onClick={() => addArticle(chapterIdx)}
                              >
                                + 조 추가
                              </button>
                            </div>
                            <div className="space-y-2 pl-1">
                              {chapter.articles.map((article, articleIdx) => (
                                <div
                                  key={`${articleIdx}-${article.number}`}
                                  ref={(el) => {
                                    articleRefs.current[`${chapterIdx}-${articleIdx}`] = el;
                                  }}
                                  className={`border rounded p-2 transition-colors ${
                                    activeIssueTarget === `${chapterIdx}-${articleIdx}`
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-gray-100 bg-gray-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <input
                                      type="number"
                                      className="input w-20 text-xs"
                                      min={1}
                                      value={article.number}
                                      onChange={(e) =>
                                        updateArticleField(chapterIdx, articleIdx, 'number', e.target.value)
                                      }
                                    />
                                    <input
                                      className="input flex-1 text-xs"
                                      value={article.title}
                                      onChange={(e) =>
                                        updateArticleField(chapterIdx, articleIdx, 'title', e.target.value)
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="text-[11px] text-red-600 hover:underline"
                                      onClick={() => removeArticle(chapterIdx, articleIdx)}
                                    >
                                      조 삭제
                                    </button>
                                  </div>
                                  <textarea
                                    className="input text-xs font-mono min-h-[84px]"
                                    value={article.content}
                                    onChange={(e) =>
                                      updateArticleField(chapterIdx, articleIdx, 'content', e.target.value)
                                    }
                                  />
                                  {/\*\*[\s\S]*?\*\*/.test(article.content) && (
                                    <div className="text-[10px] text-gray-500 border-t border-gray-100 pt-1 mt-1 space-y-0.5">
                                      <span className="text-gray-400">미리보기(굵게):</span>
                                      <div className="text-gray-800 leading-snug">
                                        <ArticleBodyInline text={article.content} />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {createMutation.error && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
                {(createMutation.error as any)?.response?.data?.message || t('policies.error')}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() =>
                  createMutation.mutate({
                    mode: createMode,
                    payload: form,
                    rawText: importRawText,
                    splitMode: importSplitMode,
                    splitDelimiter: importDelimiter,
                  })
                }
                disabled={
                  !form.code ||
                  !form.title ||
                  createMutation.isPending ||
                  (createMode === 'import' &&
                    (((importRawText || '').trim().length === 0 && parsedArticleCount === 0) ||
                      importValidation.errors.length > 0 ||
                      (importSplitMode === 'delimiter' && !importDelimiter.trim())))
                }
                className="btn-primary"
              >
                {createMutation.isPending
                  ? t('policies.registering')
                  : createMode === 'import'
                    ? '가져와서 등록'
                    : t('policies.registerBtn')}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
                {t('policies.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'tree' && <PolicyHierarchyPanel canEdit={canEdit} />}

      {view === 'list' && (
        <>
      <div className="card px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-gray-500 mr-1">가나다 색인</span>
          <button
            type="button"
            onClick={() => setIndexKey(null)}
            className={clsx(
              'px-2 py-1 text-xs rounded border',
              indexKey === null
                ? 'border-navy-600 bg-navy-700 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            전체
          </button>
          {INDEX_KEYS.map((key) => {
            const n = indexCounts[key] || 0;
            return (
              <button
                key={key}
                type="button"
                disabled={n === 0}
                onClick={() => setIndexKey(key === indexKey ? null : key)}
                title={n === 0 ? '해당 규정 없음' : `${n}건`}
                className={clsx(
                  'px-2 py-1 text-xs rounded border tabular-nums',
                  indexKey === key
                    ? 'border-navy-600 bg-navy-700 text-white'
                    : n === 0
                      ? 'border-gray-200 bg-white text-gray-300 cursor-not-allowed'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {key}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
        <Search size={15} className="text-gray-400 flex-shrink-0" />
        <input
          type="text"
          className="flex-1 text-sm outline-none"
          placeholder={t('policies.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input text-xs min-w-[8rem]"
          value={selectedDepartment}
          onChange={(e) => setSelectedDepartment(e.target.value)}
        >
          <option value="all">전체 부서</option>
          {departmentOptions.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </select>
        <select
          className="input text-xs min-w-[8rem]"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="all">전체 분류</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          className="input text-xs min-w-[7rem]"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          aria-label="시행 상태"
        >
          <option value="all">전체 상태</option>
          <option value="active">시행중</option>
          <option value="inactive">비활성</option>
        </select>
        {search && <span className="text-xs text-gray-500">{t('policies.countUnit', { n: visible.length })}</span>}
      </div>

      <div className="section-card">
        <table className="w-full gov-table">
          <thead>
            <tr>
              <th className="w-8 text-center">{t('policies.colNo')}</th>
              <th className="w-28">{t('policies.code')}</th>
              <th>{t('policies.name')}</th>
              <th className="w-24 text-center">{t('dashboard.status')}</th>
              <th className="w-24 text-center">{t('variables.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5}>
                  <LoadingBlock label={t('policies.loading')} />
                </td>
              </tr>
            )}
            {!isLoading && visible.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={FileText}
                    title={t('policies.emptyList')}
                    action={
                      <button type="button" className="btn-primary text-sm" onClick={() => setShowCreate(true)}>
                        <Plus size={14} /> {t('policies.register')}
                      </button>
                    }
                    compact
                  />
                </td>
              </tr>
            )}
            {!isLoading &&
              visible.map((policy: any, idx: number) => (
              <tr key={policy.id}>
                <td className="text-center text-xs text-gray-400">{idx + 1}</td>
                <td className="font-mono text-xs text-gray-500">{policy.code}</td>
                <td>
                  <span className="inline-flex items-center gap-1">
                    <FavoriteButton policyId={policy.id} label={policy.title} />
                    <Link to={'/policies/' + policy.id} className="text-navy-700 hover:underline font-medium text-sm">
                      {policy.title}
                    </Link>
                  </span>
                  {policy.description && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{policy.description}</div>
                  )}
                  {(() => {
                    const meta = getPolicyMeta(policy);
                    if (!meta.department && !meta.category) return null;
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {meta.department ? (
                          <span className="inline-flex rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                            부서: {meta.department}
                          </span>
                        ) : null}
                        {meta.category ? (
                          <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                            분류: {meta.category}
                          </span>
                        ) : null}
                      </div>
                    );
                  })()}
                </td>
                <td className="text-center">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => toggleActiveMutation.mutate({ id: policy.id, next: !policy.isActive })}
                      disabled={toggleActiveMutation.isPending}
                      title={policy.isActive ? '비활성으로 변경' : '시행중으로 변경'}
                      className={`text-xs px-2 py-0.5 rounded border inline-flex whitespace-nowrap transition-colors disabled:opacity-50 ${
                        policy.isActive
                          ? 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100'
                          : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'
                      }`}
                    >
                      {policy.isActive ? t('policies.status.active') : t('policies.status.inactive')}
                    </button>
                  ) : (
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        policy.isActive ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-gray-100 text-gray-500 border-gray-300'
                      } inline-flex whitespace-nowrap`}
                    >
                      {policy.isActive ? t('policies.status.active') : t('policies.status.inactive')}
                    </span>
                  )}
                </td>
                <td className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Link to={'/policies/' + policy.id} className="text-xs text-navy-600 hover:underline">
                      {t('policies.detailLink')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t('policies.deleteConfirm'))) deleteMutation.mutate(policy.id);
                      }}
                      className="text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card p-4">
        <div className="text-sm font-semibold text-gray-900 mb-2">가져오기 이력</div>
        {importLogs.length === 0 ? (
          <p className="text-xs text-gray-500">아직 가져오기 이력이 없습니다.</p>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-auto">
            {importLogs.map((log: any) => (
              <div key={log.id} className="border border-gray-200 rounded px-2 py-1.5 text-xs">
                <div className="font-medium text-gray-700">
                  {log.parseProfile || 'mixed'} · 장 {log.chapterCount} / 조 {log.articleCount}
                </div>
                <div className="text-gray-500">
                  {new Date(log.createdAt).toLocaleString()} · {log.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
