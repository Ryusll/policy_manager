import { useState, useEffect, useRef, useMemo } from 'react';
import { useI18n } from '../i18n/useI18n';
import {
  useBrandStore,
  DEFAULT_BRAND_MARK,
  DEFAULT_LOGO_WIDTH,
  DEFAULT_LOGO_HEIGHT,
  displayBrandMark,
  MAX_LOGO_BYTES,
  MAX_LOGO_DATA_URL_LEN,
  LOGO_SIZE_MIN,
  LOGO_SIZE_MAX,
} from '../stores/brandStore';
import { useThemeStore } from '../stores/themeStore';
import { PRESETS, type ThemePresetId } from '../theme/presets';
import { AppBrandLockup } from '../components/AppBrandLockup';
import { clsx } from 'clsx';
import { useAuthStore } from '../stores/authStore';
import {
  canCustomizeBranding,
  canInviteUsers,
  canManagePolicyTemplates,
  canUseAdvancedTemplateEditor,
} from '../lib/planFeatures';
import { usersApi } from '../api/users';
import { notificationGroupsApi, type NotificationGroup } from '../api/notificationGroups';
import { templatesApi, type PolicyTemplate, type TemplateRevision } from '../api/templates';
import { policiesApi } from '../api/policies';
import TemplateEditor from '../components/policy-template/TemplateEditor';
import TemplateRenderer from '../components/policy-template/TemplateRenderer';
import { buildTemplateTokenData } from '../components/policy-template/templateTokens';
import { buildFullViewGroups } from '../lib/fullViewGroups';
import PlanModal from '../components/PlanModal';
import { FavoritesPanel } from '../components/FavoritesPanel';

const PRESET_IDS: ThemePresetId[] = ['forest', 'ocean', 'slate', 'wine'];

/** 미리보기 대상 규정이 없을 때 쓰는 샘플 (조 루트 + 항 구조를 함께 보여준다) */
const SAMPLE_PREVIEW_CHAPTERS = [
  {
    id: 'preview-ch-1',
    number: 1,
    title: '총칙',
    articles: [
      {
        id: 'preview-art-1',
        number: 1,
        clauseNumber: null,
        itemNumber: null,
        title: '목적',
        versions: [{ content: '이 규정은 회사 운영의 공정성과 효율성을 높이기 위한 기준을 정한다.' }],
      },
      {
        id: 'preview-art-1-1',
        number: 1,
        clauseNumber: 1,
        itemNumber: null,
        title: '',
        versions: [{ content: '이 규정에서 정하지 아니한 사항은 관계 법령과 사규에 따른다.' }],
      },
    ],
  },
];

function tripletToCss(t: string) {
  return `rgb(${t.replace(/\s+/g, ' ').split(' ').join(',')})`;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const customizationEnabled = canCustomizeBranding(user?.plan);
  const inviteEnabledByPlan = canInviteUsers(user?.plan);
  const canManageTemplatesByPlan = canManagePolicyTemplates(user?.plan);
  const advancedTemplateEnabled = canUseAdvancedTemplateEditor(user?.plan);
  const canManageTeam = isAdmin && inviteEnabledByPlan;
  const [activeTab, setActiveTab] = useState<'ui' | 'favorites' | 'team' | 'templates'>('ui');
  const [invite, setInvite] = useState({ email: '', password: '', name: '', role: 'editor' as 'admin' | 'editor' | 'viewer' });
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [notifyGroups, setNotifyGroups] = useState<NotificationGroup[]>([]);
  const [tenantUsers, setTenantUsers] = useState<{ id: string; name: string; email: string; role: string }[]>([]);
  const [groupDraft, setGroupDraft] = useState({ name: '', userIds: [] as string[] });
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupMsg, setGroupMsg] = useState('');
  const [groupLoading, setGroupLoading] = useState(false);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([]);
  const [templateRevisions, setTemplateRevisions] = useState<TemplateRevision[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateMsg, setTemplateMsg] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [previewPolicies, setPreviewPolicies] = useState<any[]>([]);
  const [previewPolicyId, setPreviewPolicyId] = useState('');
  const [previewPolicy, setPreviewPolicy] = useState<any>(null);
  const [showTemplatePreviewModal, setShowTemplatePreviewModal] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<any>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>('');
  const [revisionQuery, setRevisionQuery] = useState('');
  const [revisionActionFilter, setRevisionActionFilter] = useState('all');
  const [revisionFromDate, setRevisionFromDate] = useState('');
  const [revisionToDate, setRevisionToDate] = useState('');
  const [revisionVisibleCount, setRevisionVisibleCount] = useState(10);
  const [revisionSortOrder, setRevisionSortOrder] = useState<'desc' | 'asc'>('desc');
  const [semanticChangedOnly, setSemanticChangedOnly] = useState(true);
  const [templatePreviewScale, setTemplatePreviewScale] = useState(100);
  const [templateDraft, setTemplateDraft] = useState({
    name: '',
    description: '',
    html:
      '<div class="tmpl-shell">' +
      '<div class="tmpl-logo-area">{{logo}}</div>' +
      '<header class="tmpl-doc-head">' +
      '<h1 class="tmpl-doc-title">{{policy.title}}</h1>' +
      '<p class="tmpl-doc-meta">{{tenant.name}} · {{policy.code}} · 개정일 {{revisionDate}} · 시행일 {{effectiveDate}}</p>' +
      '</header>' +
      '<main class="tmpl-doc-main">{{content}}</main>' +
      '</div>',
    css:
      '.tmpl-shell{position:relative;font-family:"Noto Sans KR",system-ui,sans-serif;line-height:1.65;color:#111827;padding:8mm 10mm;box-sizing:border-box;}' +
      '.tmpl-logo-area{position:absolute;top:6mm;right:10mm;max-width:42mm;text-align:right;}' +
      '.tmpl-doc-head{padding-right:44mm;padding-bottom:4mm;border-bottom:2px solid #145a42;margin-bottom:6mm;}' +
      '.tmpl-doc-title{margin:0;font-size:22px;font-weight:800;letter-spacing:-0.02em;}' +
      '.tmpl-doc-meta{margin:6px 0 0;font-size:12px;color:#4b5563;}' +
      '.tmpl-chapter{margin-top:10mm;}' +
      '.tmpl-chapters > .tmpl-chapter ~ .tmpl-chapter{page-break-before:always;break-before:page;}' +
      '.tmpl-chapter-title{margin:0 0 6px;font-size:16px;font-weight:700;color:#145a42;}' +
      '.tmpl-article-block{margin-top:5mm;padding-left:2mm;border-left:3px solid #e5e7eb;}' +
      '.tmpl-article-label{font-size:12px;font-weight:700;color:#6b7280;margin-bottom:2mm;}' +
      '.tmpl-article-body{white-space:pre-wrap;font-size:13px;}' +
      '@media print{@page{size:A4;margin:12mm;}.tmpl-shell{padding:0;border:1px solid #145a42;min-height:0;}}',
    isActive: true,
  });
  const [basicTemplateDraft, setBasicTemplateDraft] = useState({
    showHeader: true,
    showMeta: true,
    showFooter: false,
    footerText: '',
    showArticleTitle: true,
    showDate: false,
    showRevisionDate: true,
    showEffectiveDate: true,
    showLogo: true,
    logoMaxHeight: 48,
    showApprovalLine: false,
    approvalLabel: '결재',
    useA4Print: true,
    chapterPageBreak: false,
    showPageNumber: false,
  });
  const mode = useThemeStore((s) => s.mode);
  const presetId = useThemeStore((s) => s.presetId);
  const customPrimaryHex = useThemeStore((s) => s.customPrimaryHex);
  const customAccentHex = useThemeStore((s) => s.customAccentHex);
  const setPresetMode = useThemeStore((s) => s.setPresetMode);
  const setCustomMode = useThemeStore((s) => s.setCustomMode);
  const resetTheme = useThemeStore((s) => s.resetTheme);

  const [cPri, setCPri] = useState(customPrimaryHex);
  const [cAcc, setCAcc] = useState(customAccentHex);

  useEffect(() => {
    setCPri(customPrimaryHex);
    setCAcc(customAccentHex);
  }, [customPrimaryHex, customAccentHex]);

  const saveBrandToServer = useBrandStore((s) => s.saveToServer);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const [brandSaving, setBrandSaving] = useState(false);
  /**
   * 브랜딩은 T-57에서 서버 저장으로 바뀌면서 **회사 전체에 반영**된다.
   * localStorage 시절에는 각자 자기 브라우저만 바뀌어 아무나 만져도 그만이었다.
   */
  const brandEditable = customizationEnabled && isAdmin;

  type BrandDraft = {
    mark: string;
    logo: string | null;
    w: number;
    h: number;
  };

  const readBrandDraftFromStore = (): BrandDraft => {
    const s = useBrandStore.getState();
    return {
      mark: s.brandMark,
      logo: s.brandLogoDataUrl,
      w: s.brandLogoWidth ?? DEFAULT_LOGO_WIDTH,
      h: s.brandLogoHeight ?? DEFAULT_LOGO_HEIGHT,
    };
  };

  const [brandDraft, setBrandDraft] = useState<BrandDraft>(() => readBrandDraftFromStore());
  const [logoError, setLogoError] = useState('');
  const [brandMsg, setBrandMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const templateImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab !== 'ui') return;
    setBrandDraft(readBrandDraftFromStore());
    // `brandLoaded` 를 넣은 이유: 서버 응답이 화면을 연 뒤에 오면 초안이 캐시 값에 머문다
  }, [activeTab, brandLoaded]);

  const loadNotifyTeams = async () => {
    if (!isAdmin) return;
    try {
      const [groups, users] = await Promise.all([
        notificationGroupsApi.list(),
        usersApi.list(),
      ]);
      setNotifyGroups(groups);
      setTenantUsers(users);
    } catch {
      setNotifyGroups([]);
      setTenantUsers([]);
    }
  };

  useEffect(() => {
    if (activeTab !== 'team' || !isAdmin) return;
    void loadNotifyTeams();
  }, [activeTab, isAdmin]);

  const previewText = displayBrandMark(brandDraft.mark);

  const clampLogoDim = (n: number) =>
    Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(Number.isFinite(n) ? n : DEFAULT_LOGO_WIDTH)));

  const onPickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!brandEditable) {
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    setLogoError('');
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t('settings.logoTooLarge'));
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result;
      if (typeof data === 'string') {
        if (data.length > MAX_LOGO_DATA_URL_LEN) {
          setLogoError(t('settings.logoTooLarge'));
          return;
        }
        setBrandDraft((prev) => ({ ...prev, logo: data }));
        setBrandMsg('미리보기에 반영했습니다. 저장을 눌러 헤더·인쇄에 적용합니다.');
      }
    };
    reader.onerror = () => setLogoError(t('settings.logoTooLarge'));
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const loadTemplates = async () => {
    setTemplateLoading(true);
    try {
      const rows = await templatesApi.list();
      setTemplates(rows);
      if (!selectedTemplateId && rows[0]) {
        setSelectedTemplateId(rows[0].id);
      }
    } catch (e: any) {
      // catch 가 없던 자리다(T-32 lint 로 발견). 목록을 못 받으면 스피너만 멎고
      // 화면은 "템플릿 없음"처럼 보여서, 실패인지 정말 비어 있는지 알 수 없었다.
      setTemplates([]);
      setTemplateMsg(e?.response?.data?.message || '템플릿 목록을 불러오지 못했습니다.');
    } finally {
      setTemplateLoading(false);
    }
  };

  const loadTemplateRevisions = async (templateId: string) => {
    try {
      const rows = await templatesApi.revisions(templateId);
      setTemplateRevisions(rows);
    } catch {
      setTemplateRevisions([]);
    }
  };

  useEffect(() => {
    if (activeTab !== 'templates') return;
    if (!canManageTemplatesByPlan) return;
    void loadTemplates();
  }, [activeTab, canManageTemplatesByPlan]);

  useEffect(() => {
    if (!selectedTemplateId) return;
    const selected = templates.find((t) => t.id === selectedTemplateId);
    if (!selected) return;
    setTemplateDraft({
      name: selected.name,
      description: selected.description || '',
      html: typeof selected.layoutJson?.rawHtml === 'string' ? String(selected.layoutJson.rawHtml) : '',
      css: selected.cssText || '',
      isActive: selected.isActive,
    });
    const cfg = (selected.layoutJson?.basicConfig || {}) as any;
    setBasicTemplateDraft({
      showHeader: cfg.showHeader ?? true,
      showMeta: cfg.showMeta ?? true,
      showFooter: cfg.showFooter ?? false,
      footerText: cfg.footerText ?? '',
      showArticleTitle: cfg.showArticleTitle ?? true,
      showDate: cfg.showDate ?? false,
      showRevisionDate: cfg.showRevisionDate ?? cfg.showDate ?? true,
      showEffectiveDate: cfg.showEffectiveDate ?? false,
      showLogo: cfg.showLogo ?? true,
      logoMaxHeight: cfg.logoMaxHeight ?? 48,
      showApprovalLine: cfg.showApprovalLine ?? false,
      approvalLabel: cfg.approvalLabel ?? '결재',
      useA4Print: cfg.useA4Print ?? true,
      chapterPageBreak: cfg.chapterPageBreak ?? false,
      showPageNumber: cfg.showPageNumber ?? false,
    });
    void loadTemplateRevisions(selectedTemplateId);
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (activeTab !== 'templates' || !canManageTemplatesByPlan) return;
    void (async () => {
      try {
        const list = await policiesApi.list();
        setPreviewPolicies(Array.isArray(list) ? list : []);
        if (!previewPolicyId && list?.[0]?.id) setPreviewPolicyId(list[0].id);
      } catch {
        setPreviewPolicies([]);
        setPreviewPolicyId('');
      }
    })();
  }, [activeTab, canManageTemplatesByPlan, previewPolicyId]);

  useEffect(() => {
    if (!previewPolicyId) {
      setPreviewPolicy(null);
      return;
    }
    void (async () => {
      try {
        const full = await policiesApi.get(previewPolicyId);
        setPreviewPolicy(full);
      } catch {
        setPreviewPolicy(null);
      }
    })();
  }, [previewPolicyId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  // 미리보기 토큰 데이터도 실제 렌더와 동일한 빌더를 사용한다.
  // (예전에는 revisionDate·effectiveDate를 넘기지 않아 미리보기에서만 빈칸으로 보였다)
  const templatePreviewTokenData = useMemo(
    () =>
      buildTemplateTokenData({
        tenantName: user?.tenantName || '샘플회사',
        policyTitle: previewPolicy?.title || templateDraft.name || '규정 미리보기',
        policyCode: previewPolicy?.code || 'TMP-001',
        revisionDate: previewPolicy?.revisionDate,
        effectiveDate: previewPolicy?.effectiveDate,
      }),
    [
      user?.tenantName,
      previewPolicy?.title,
      previewPolicy?.code,
      previewPolicy?.revisionDate,
      previewPolicy?.effectiveDate,
      templateDraft.name,
    ],
  );

  // 미리보기도 전문 보기와 같은 그룹 구조를 써야 조·항·목 들여쓰기가 실제 출력과 일치한다.
  const templatePreviewGroups = useMemo(
    () => buildFullViewGroups(previewPolicy?.chapters?.length ? previewPolicy.chapters : SAMPLE_PREVIEW_CHAPTERS),
    [previewPolicy],
  );

  const renderRevisionDiff = (rev: TemplateRevision) => {
    const before = rev.details?.before || null;
    const after = rev.details?.after || rev.details?.snapshot || null;
    if (!before && !after) return null;
    const changed: string[] = [];
    const fields = ['name', 'description', 'isDefault', 'isActive', 'layoutJson', 'cssText'];
    for (const field of fields) {
      const b = JSON.stringify(before?.[field] ?? null);
      const a = JSON.stringify(after?.[field] ?? null);
      if (b !== a) changed.push(field);
    }
    if (!changed.length) return <span className="text-gray-500">변경 없음</span>;
    const fieldLabel: Record<string, string> = {
      name: '템플릿 이름',
      description: '설명',
      isDefault: '기본 템플릿 여부',
      isActive: '사용 상태',
      layoutJson: '레이아웃 구성',
      cssText: '스타일(CSS)',
    };
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {changed.map((f) => (
          <span key={f} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
            {fieldLabel[f] || f}
          </span>
        ))}
      </div>
    );
  };

  const actionLabelMap: Record<string, string> = {
    'template.create': '템플릿 생성',
    'template.update': '템플릿 수정',
    'template.clone': '템플릿 복제',
    'template.setDefault': '기본 템플릿 지정',
    'template.delete': '템플릿 삭제',
    'template.restore': '이력 복원',
  };
  const fieldLabelMap: Record<string, string> = {
    name: '템플릿 이름',
    description: '설명',
    isDefault: '기본 템플릿 여부',
    isActive: '사용 상태',
    layoutJson: '레이아웃 구성',
    cssText: '스타일(CSS)',
  };

  const selectedRevision = useMemo(
    () => templateRevisions.find((r) => r.id === selectedRevisionId) || null,
    [templateRevisions, selectedRevisionId],
  );

  const filteredRevisions = useMemo(() => {
    const q = revisionQuery.trim().toLowerCase();
    const base = templateRevisions.filter((rev) => {
      if (revisionActionFilter !== 'all' && rev.action !== revisionActionFilter) return false;
      const ts = new Date(rev.createdAt).getTime();
      if (revisionFromDate) {
        const fromTs = new Date(`${revisionFromDate}T00:00:00`).getTime();
        if (ts < fromTs) return false;
      }
      if (revisionToDate) {
        const toTs = new Date(`${revisionToDate}T23:59:59`).getTime();
        if (ts > toTs) return false;
      }
      if (!q) return true;
      const userText = `${rev.user?.name || ''} ${rev.user?.email || ''}`.toLowerCase();
      const actionText = String(rev.action || '').toLowerCase();
      return userText.includes(q) || actionText.includes(q);
    });
    return [...base].sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return revisionSortOrder === 'desc' ? bt - at : at - bt;
    });
  }, [templateRevisions, revisionQuery, revisionActionFilter, revisionFromDate, revisionToDate, revisionSortOrder]);

  const visibleRevisions = useMemo(
    () => filteredRevisions.slice(0, revisionVisibleCount),
    [filteredRevisions, revisionVisibleCount],
  );

  const saveSelectedTemplate = async () => {
    if (!selectedTemplateId) return;
    setTemplateMsg('');
    setTemplateSaving(true);
    try {
      await templatesApi.update(selectedTemplateId, {
        name: templateDraft.name.trim(),
        description: templateDraft.description.trim(),
        isActive: templateDraft.isActive,
        layoutJson: advancedTemplateEnabled
          ? { mode: 'html', rawHtml: templateDraft.html }
          : { mode: 'basic', basicConfig: basicTemplateDraft },
        cssText: advancedTemplateEnabled ? templateDraft.css : '',
      });
      await loadTemplates();
      setTemplateMsg('템플릿을 저장했습니다.');
    } catch (e: any) {
      setTemplateMsg(e?.response?.data?.message || '템플릿 저장 실패');
    } finally {
      setTemplateSaving(false);
    }
  };

  const renderDiffJson = (value: any, counterpart: any, side: 'before' | 'after') => {
    const lhs = JSON.stringify(value ?? null, null, 2)?.split('\n') || [];
    const rhs = JSON.stringify(counterpart ?? null, null, 2)?.split('\n') || [];
    const counterpartSet = new Set(side === 'before' ? rhs : lhs);
    const lines = side === 'before' ? lhs : rhs;
    return (
      <code className="block text-[11px] leading-5">
        {lines.map((line, idx) => {
          const changed = !counterpartSet.has(line);
          return (
            <div
              key={`${side}-${idx}-${line}`}
              className={changed ? (side === 'before' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800') : ''}
            >
              {line}
            </div>
          );
        })}
      </code>
    );
  };

  const renderSemanticDiff = (rev: TemplateRevision) => {
    const before = rev.details?.before || rev.details?.snapshot || {};
    const after = rev.details?.after || rev.details?.snapshot || {};
    const keys = ['name', 'description', 'isDefault', 'isActive', 'layoutJson', 'cssText'] as const;
    const changed = keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
    if (!changed.length) return <span className="text-gray-500">의미 있는 변경 없음</span>;
    const keyPriority: Record<string, number> = {
      layoutJson: 1,
      cssText: 2,
      name: 3,
      description: 4,
      isDefault: 5,
      isActive: 6,
    };
    const visibleKeys = (semanticChangedOnly ? changed : keys).slice().sort((a, b) => (keyPriority[a] || 99) - (keyPriority[b] || 99));
    const summarize = (key: string, value: any) => {
      if (key === 'cssText') {
        const text = String(value ?? '');
        return `스타일 길이 ${text.length}자`;
      }
      if (key === 'layoutJson') {
        const mode = value?.mode ? String(value.mode) : 'unknown';
        const keysCount = value && typeof value === 'object' ? Object.keys(value).length : 0;
        const modeLabel = mode === 'basic' ? '기본 양식' : mode === 'html' ? '고급(HTML)' : mode;
        return `레이아웃(${modeLabel}, 항목 ${keysCount}개)`;
      }
      return JSON.stringify(value ?? null);
    };
    return (
      <div className="space-y-1">
        {visibleKeys.map((k) => (
          <div key={k} className="text-[11px] text-gray-700">
            <span className="font-semibold text-navy-700">{fieldLabelMap[k] || k}</span>
            <span className="text-gray-500">: </span>
            <span className="text-red-700">{summarize(k, before?.[k] ?? null)}</span>
            <span className="text-gray-400"> → </span>
            <span className="text-green-700">{summarize(k, after?.[k] ?? null)}</span>
          </div>
        ))}
      </div>
    );
  };

  const getRevisionChangedCount = (rev: TemplateRevision) => {
    const before = rev.details?.before || rev.details?.snapshot || {};
    const after = rev.details?.after || rev.details?.snapshot || {};
    const keys = ['name', 'description', 'isDefault', 'isActive', 'layoutJson', 'cssText'] as const;
    return keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)).length;
  };

  const getRevisionImpact = (rev: TemplateRevision) => {
    const before = rev.details?.before || rev.details?.snapshot || {};
    const after = rev.details?.after || rev.details?.snapshot || {};
    const changedLayout = JSON.stringify(before?.layoutJson ?? null) !== JSON.stringify(after?.layoutJson ?? null);
    const changedCss = JSON.stringify(before?.cssText ?? null) !== JSON.stringify(after?.cssText ?? null);
    const changedMeta =
      JSON.stringify(before?.name ?? null) !== JSON.stringify(after?.name ?? null) ||
      JSON.stringify(before?.isDefault ?? null) !== JSON.stringify(after?.isDefault ?? null);
    if (changedLayout || changedCss) return { label: '중요', className: 'bg-red-50 border-red-200 text-red-700' };
    if (changedMeta) return { label: '보통', className: 'bg-amber-50 border-amber-200 text-amber-700' };
    return { label: '경미', className: 'bg-gray-50 border-gray-200 text-gray-700' };
  };

  const countObjectKeyChanges = (beforeObj: any, afterObj: any) => {
    const beforeKeys = beforeObj && typeof beforeObj === 'object' ? Object.keys(beforeObj) : [];
    const afterKeys = afterObj && typeof afterObj === 'object' ? Object.keys(afterObj) : [];
    const allKeys = new Set([...beforeKeys, ...afterKeys]);
    let changed = 0;
    allKeys.forEach((k) => {
      if (JSON.stringify(beforeObj?.[k] ?? null) !== JSON.stringify(afterObj?.[k] ?? null)) changed += 1;
    });
    return changed;
  };

  const settingsTabs = [
    { id: 'ui' as const, label: t('settings.tabUi') },
    { id: 'favorites' as const, label: '즐겨찾기' },
    { id: 'team' as const, label: t('settings.tabInvite'), disabled: !canManageTeam },
    { id: 'templates' as const, label: t('settings.tabTemplates'), disabled: !isAdmin || !canManageTemplatesByPlan },
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">{t('settings.title')}</h1>
          <p className="page-header__desc">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              className={clsx(
                'settings-nav__btn',
                activeTab === tab.id ? 'settings-nav__btn--active' : 'settings-nav__btn--idle',
                tab.disabled && 'opacity-50 cursor-not-allowed',
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className={clsx('flex-1 min-w-0 space-y-6', activeTab === 'templates' ? 'max-w-none' : 'max-w-3xl')}>
      {activeTab === 'favorites' && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">즐겨찾기</h2>
          <p className="text-xs text-gray-500 mb-3">
            규정 목록·조문 화면의 별로 담아둔 항목입니다. 조문은 조 번호 기준 링크라
            규정을 다시 가져와도 살아 있습니다.
          </p>
          <FavoritesPanel />
        </div>
      )}

      {activeTab === 'ui' && (
        <>
      {/* 테마 */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 mb-1">{t('settings.themeTitle')}</h2>
          <p className="text-xs text-gray-500">{t('settings.themeHint')}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">{t('settings.themePresetLabel')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRESET_IDS.map((id) => {
              const pal = PRESETS[id];
              const active = mode === 'preset' && presetId === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!customizationEnabled}
                  onClick={() => setPresetMode(id)}
                  className={clsx(
                    'rounded border-2 p-2 text-left transition-colors',
                    active ? 'border-gold-500 ring-1 ring-gold-400' : 'border-gray-200 hover:border-gray-300',
                    !customizationEnabled && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <div
                    className="h-8 w-full rounded mb-1 flex overflow-hidden border border-black/10"
                    style={{ background: tripletToCss(pal.navy['900']) }}
                  >
                    <div className="flex-1" />
                    <div className="w-2" style={{ background: tripletToCss(pal.gold['500']) }} />
                  </div>
                  <span className="text-xs font-medium text-gray-800">{t(`settings.themePreset.${id}`)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <p className="text-xs font-medium text-gray-600 mb-2">{t('settings.themeCustomLabel')}</p>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">{t('settings.themePrimary')}</label>
              <input
                type="color"
                value={cPri.match(/^#/) ? cPri : `#${cPri}`}
                onChange={(e) => setCPri(e.target.value)}
                disabled={!customizationEnabled}
                className="h-10 w-16 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{t('settings.themeAccent')}</label>
              <input
                type="color"
                value={cAcc.match(/^#/) ? cAcc : `#${cAcc}`}
                onChange={(e) => setCAcc(e.target.value)}
                disabled={!customizationEnabled}
                className="h-10 w-16 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
              />
            </div>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => setCustomMode(cPri, cAcc)}
              disabled={!customizationEnabled}
            >
              {t('settings.themeApplyCustom')}
            </button>
          </div>
          {mode === 'custom' && <p className="text-xs text-navy-600 mt-2">{t('settings.themeCustomActive')}</p>}
        </div>

        <div className="pt-2 border-t border-gray-200">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => resetTheme()}
            disabled={!customizationEnabled}
          >
            {t('settings.themeReset')}
          </button>
        </div>
        {!customizationEnabled && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {t('settings.lockedStarter')}
          </p>
        )}
      </div>

      {/* 브랜드 */}
      <div className="bg-white border border-gray-300 shadow-sm p-5 space-y-5">
        <h2 className="text-sm font-semibold text-gray-800">{t('settings.brandSectionTitle')}</h2>

        {customizationEnabled && !isAdmin && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            브랜딩은 <strong>회사 전체</strong>에 적용되는 설정이라 관리자만 바꿀 수 있습니다. 현재 적용된 값은 아래에서 확인할 수 있습니다.
          </p>
        )}

        <div>
          <h3 className="text-xs font-medium text-gray-700 mb-2">{t('settings.logoTitle')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings.logoHint')}</p>
          <p className="text-xs text-navy-700 bg-navy-50 border border-navy-200 rounded px-2 py-1.5 mb-3">
            로고·크기·텍스트 배지는 아래에서만 미리보기로 바뀝니다. <strong>저장</strong>을 눌러야 헤더·규정 인쇄 양식 등에 반영되며, <strong>회사 구성원 모두</strong>의 화면에 적용됩니다.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo} />
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => fileRef.current?.click()}
              disabled={!brandEditable}
            >
              {t('settings.logoUpload')}
            </button>
            {brandDraft.logo && (
              <button
                type="button"
                className="text-sm text-red-600 hover:underline disabled:text-gray-400 disabled:no-underline"
                onClick={() => {
                  setBrandDraft((prev) => ({ ...prev, logo: null }));
                  setBrandMsg('미리보기에서 로고를 뺐습니다. 저장하면 적용됩니다.');
                }}
                disabled={!brandEditable}
              >
                {t('settings.logoRemove')}
              </button>
            )}
          </div>
          {logoError && <p className="text-xs text-red-600 mt-2">{logoError}</p>}

          <p className="text-xs text-gray-500 mt-4 mb-2">
            {t('settings.logoSizeHint', { min: LOGO_SIZE_MIN, max: LOGO_SIZE_MAX })}
          </p>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs text-gray-600 mb-1">{t('settings.logoWidth')}</label>
              <input
                type="number"
                min={LOGO_SIZE_MIN}
                max={LOGO_SIZE_MAX}
                value={brandDraft.w}
                onChange={(e) =>
                  setBrandDraft((prev) => ({
                    ...prev,
                    w: clampLogoDim(+e.target.value),
                    h: prev.h,
                  }))
                }
                disabled={!brandEditable}
                className="input w-24"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{t('settings.logoHeight')}</label>
              <input
                type="number"
                min={LOGO_SIZE_MIN}
                max={LOGO_SIZE_MAX}
                value={brandDraft.h}
                onChange={(e) =>
                  setBrandDraft((prev) => ({
                    ...prev,
                    w: prev.w,
                    h: clampLogoDim(+e.target.value),
                  }))
                }
                disabled={!brandEditable}
                className="input w-24"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-start gap-4">
            <div>
              <span className="text-xs text-gray-500 block mb-2">{t('settings.previewHeader')}</span>
              <div className="rounded border border-gray-200 bg-navy-900 px-3 py-2 inline-flex items-center">
                <AppBrandLockup variant="app" preview={brandDraft} />
              </div>
            </div>
            <div>
              <span className="text-xs text-gray-500 block mb-2">{t('settings.previewLogin')}</span>
              <div className="rounded border border-gray-200 bg-navy-900 px-3 py-2 inline-flex items-center">
                <AppBrandLockup variant="login" preview={brandDraft} />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <h3 className="text-xs font-medium text-gray-700 mb-2">{t('settings.textBadgeTitle')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings.brandMarkHint')}</p>
          <div className="flex flex-wrap items-end gap-4">
            <input
              type="text"
              maxLength={2}
              value={brandDraft.mark}
              onChange={(e) => setBrandDraft((prev) => ({ ...prev, mark: e.target.value }))}
              disabled={!brandEditable}
              className="input w-32 font-medium"
              placeholder={DEFAULT_BRAND_MARK}
              aria-label={t('settings.brandMark')}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('settings.preview')}</span>
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-gold-500 px-0.5 text-sm font-bold leading-tight text-white">
                {previewText}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-200 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={async () => {
              setLogoError('');
              setBrandSaving(true);
              try {
                await saveBrandToServer({
                  brandMark: brandDraft.mark,
                  brandLogoDataUrl: brandDraft.logo,
                  brandLogoWidth: brandDraft.w,
                  brandLogoHeight: brandDraft.h,
                });
                setBrandDraft(readBrandDraftFromStore());
                setBrandMsg('브랜드 설정을 저장했습니다. 회사 구성원 모두의 화면·인쇄에 반영됩니다.');
              } catch (e: any) {
                setBrandMsg('');
                setLogoError(
                  e?.response?.data?.message || '브랜드 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
                );
              } finally {
                setBrandSaving(false);
              }
            }}
            disabled={!brandEditable || brandSaving}
          >
            {brandSaving ? '저장 중…' : t('settings.save')}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              setBrandDraft(readBrandDraftFromStore());
              setLogoError('');
              setBrandMsg('저장된 설정으로 되돌렸습니다.');
            }}
            disabled={!brandEditable}
          >
            변경 취소
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              setBrandDraft({
                mark: DEFAULT_BRAND_MARK,
                logo: null,
                w: DEFAULT_LOGO_WIDTH,
                h: DEFAULT_LOGO_HEIGHT,
              });
              setLogoError('');
              setBrandMsg('미리보기를 기본값으로 바꿨습니다. 저장하면 반영됩니다.');
            }}
            disabled={!brandEditable}
          >
            미리보기 기본값
          </button>
        </div>
        {brandMsg && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            {brandMsg}
          </p>
        )}
      </div>
        </>
      )}

      {activeTab === 'team' && canManageTeam && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">{t('settings.teamTitle')}</h2>
            <p className="text-xs text-gray-500 mt-1">{t('settings.teamHint')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">{t('settings.inviteName')}</label>
              <input
                type="text"
                className="input"
                value={invite.name}
                onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{t('settings.inviteEmail')}</label>
              <input
                type="email"
                className="input"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{t('settings.invitePassword')}</label>
              <input
                type="password"
                className="input"
                minLength={6}
                value={invite.password}
                onChange={(e) => setInvite({ ...invite, password: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">{t('settings.inviteRole')}</label>
              <select
                className="input"
                value={invite.role}
                onChange={(e) =>
                  setInvite({ ...invite, role: e.target.value as 'admin' | 'editor' | 'viewer' })
                }
              >
                <option value="viewer">{t('role.viewer')}</option>
                <option value="editor">{t('role.editor')}</option>
                <option value="admin">{t('role.admin')}</option>
              </select>
            </div>
          </div>
          {inviteMsg && (
            <p className="text-xs text-navy-700 bg-navy-50 border border-navy-100 rounded px-2 py-1">{inviteMsg}</p>
          )}
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={inviteLoading || !invite.email.trim() || !invite.password || !invite.name.trim()}
            onClick={async () => {
              setInviteMsg('');
              setInviteLoading(true);
              try {
                await usersApi.create({
                  email: invite.email.trim(),
                  password: invite.password,
                  name: invite.name.trim(),
                  role: invite.role,
                });
                setInviteMsg(t('settings.inviteSuccess'));
                setInvite({ email: '', password: '', name: '', role: 'editor' });
              } catch (e: any) {
                setInviteMsg(e?.response?.data?.message || t('settings.inviteError'));
              } finally {
                setInviteLoading(false);
              }
            }}
          >
            {inviteLoading ? t('settings.inviteSubmitting') : t('settings.inviteSubmit')}
          </button>
        </div>
      )}

      {activeTab === 'team' && isAdmin && (
        <div className="card p-5 space-y-4">
          {!canManageTeam && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
              Starter 플랜에서는 팀원 초대는 제한되지만, 개정 알림 수신 팀은 아래에서 설정할 수 있습니다.
            </p>
          )}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">개정 알림 수신 팀</h3>
              <p className="text-xs text-gray-500 mt-1">
                예: 정보보안팀, 인사팀 등. 규정별로 이 팀을 지정하면 시행 승인 시 팀원에게 알림이 갑니다.
              </p>
            </div>
            {notifyGroups.map((g) => (
              <div key={g.id} className="border border-gray-200 rounded p-3 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800">{g.name}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                      onClick={() => {
                        setEditingGroupId(g.id);
                        setGroupDraft({
                          name: g.name,
                          userIds: g.members.map((m) => m.id),
                        });
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 border border-red-200 text-red-700 rounded hover:bg-red-50"
                      onClick={async () => {
                        if (!window.confirm(`「${g.name}」 팀을 삭제할까요?`)) return;
                        await notificationGroupsApi.remove(g.id);
                        await loadNotifyTeams();
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <p className="text-gray-500">
                  {g.members.length
                    ? g.members.map((m) => `${m.name} (${m.email})`).join(', ')
                    : '구성원 없음'}
                </p>
              </div>
            ))}
            <div className="border border-dashed border-gray-300 rounded p-3 space-y-2 bg-gray-50/80">
              <p className="text-xs font-medium text-gray-700">
                {editingGroupId ? '팀 수정' : '새 알림 팀'}
              </p>
              <input
                className="input text-sm"
                placeholder="팀 이름 (예: 정보보안팀)"
                value={groupDraft.name}
                onChange={(e) => setGroupDraft((p) => ({ ...p, name: e.target.value }))}
              />
              <div className="max-h-36 overflow-y-auto space-y-1 border border-gray-200 rounded p-2 bg-white">
                {tenantUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={groupDraft.userIds.includes(u.id)}
                      onChange={(e) => {
                        setGroupDraft((p) => ({
                          ...p,
                          userIds: e.target.checked
                            ? [...p.userIds, u.id]
                            : p.userIds.filter((id) => id !== u.id),
                        }));
                      }}
                    />
                    <span>
                      {u.name} <span className="text-gray-400">{u.email}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs py-1.5"
                  disabled={groupLoading || !groupDraft.name.trim()}
                  onClick={async () => {
                    setGroupMsg('');
                    setGroupLoading(true);
                    try {
                      if (editingGroupId) {
                        await notificationGroupsApi.update(editingGroupId, {
                          name: groupDraft.name.trim(),
                          userIds: groupDraft.userIds,
                        });
                      } else {
                        await notificationGroupsApi.create({
                          name: groupDraft.name.trim(),
                          userIds: groupDraft.userIds,
                        });
                      }
                      setGroupDraft({ name: '', userIds: [] });
                      setEditingGroupId(null);
                      setGroupMsg('저장했습니다.');
                      await loadNotifyTeams();
                    } catch (e: any) {
                      setGroupMsg(e?.response?.data?.message || '저장에 실패했습니다.');
                    } finally {
                      setGroupLoading(false);
                    }
                  }}
                >
                  {groupLoading ? '저장 중…' : editingGroupId ? '팀 수정 저장' : '팀 추가'}
                </button>
                {editingGroupId && (
                  <button
                    type="button"
                    className="text-xs text-gray-600 underline"
                    onClick={() => {
                      setEditingGroupId(null);
                      setGroupDraft({ name: '', userIds: [] });
                    }}
                  >
                    취소
                  </button>
                )}
              </div>
              {groupMsg && <p className="text-xs text-navy-700">{groupMsg}</p>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'team' && !isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800">
          {t('settings.teamAdminOnly')}
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">회사 양식 관리</h2>
              <p className="text-xs text-gray-500 mt-1">회사별 여러 양식을 만들고 규정별로 적용할 수 있습니다.</p>
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={loadTemplates} disabled={templateLoading}>
              새로고침
            </button>
          </div>
          {!canManageTemplatesByPlan && (
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
              <div className="flex items-center justify-between gap-3">
                <span>회사 템플릿 기능은 Pro 이상에서 사용할 수 있습니다.</span>
                <button
                  type="button"
                  className="px-2 py-1 rounded border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => setShowPlanModal(true)}
                >
                  플랜 비교
                </button>
              </div>
            </div>
          )}
          {!isAdmin && (
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
              템플릿 수정 권한은 관리자에게만 있습니다.
            </div>
          )}
          {templateMsg && (
            <div className="text-xs text-navy-700 bg-navy-50 border border-navy-200 rounded px-2 py-1">{templateMsg}</div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <aside className="border border-gray-200 rounded p-3 space-y-2 lg:col-span-3">
              <div className="text-xs font-semibold text-gray-600">템플릿 목록</div>
              <div className="space-y-1 max-h-80 overflow-auto">
                {templates.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => setSelectedTemplateId(row.id)}
                    className={clsx(
                      'w-full text-left rounded border px-2 py-1.5 text-xs',
                      selectedTemplateId === row.id ? 'border-navy-400 bg-navy-50' : 'border-gray-200 hover:bg-gray-50',
                    )}
                  >
                    <div className="font-semibold text-gray-800">{row.name}</div>
                    <div className="text-gray-500 flex items-center gap-1 mt-0.5">
                      {row.isDefault && <span className="text-green-700">기본</span>}
                      {!row.isActive && <span className="text-red-600">비활성</span>}
                    </div>
                  </button>
                ))}
                {templates.length === 0 && (
                  <p className="text-xs text-gray-500 py-4 text-center">등록된 템플릿이 없습니다.</p>
                )}
              </div>
              {isAdmin && canManageTemplatesByPlan && (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="btn-primary text-xs w-full"
                    onClick={async () => {
                      setTemplateMsg('');
                      try {
                        const created = await templatesApi.create({
                          name: `새 양식 ${templates.length + 1}`,
                          layoutJson: advancedTemplateEnabled
                            ? { mode: 'html', rawHtml: templateDraft.html }
                            : { mode: 'basic', basicConfig: basicTemplateDraft },
                          cssText: advancedTemplateEnabled ? templateDraft.css : '',
                          isActive: true,
                        });
                        await loadTemplates();
                        setSelectedTemplateId(created.id);
                        setTemplateMsg('새 템플릿을 만들었습니다.');
                      } catch (e: any) {
                        setTemplateMsg(e?.response?.data?.message || '템플릿 생성에 실패했습니다.');
                      }
                    }}
                  >
                    새 템플릿 생성
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs w-full"
                    onClick={() => {
                      if (!selectedTemplate) return;
                      const payload = JSON.stringify(
                        {
                          schemaVersion: 1,
                          exportedAt: new Date().toISOString(),
                          name: selectedTemplate.name,
                          description: selectedTemplate.description,
                          layoutJson: selectedTemplate.layoutJson,
                          cssText: selectedTemplate.cssText,
                          isActive: selectedTemplate.isActive,
                        },
                        null,
                        2,
                      );
                      const blob = new Blob([payload], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${selectedTemplate.name || 'template'}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    disabled={!selectedTemplate}
                  >
                    템플릿 내보내기(JSON)
                  </button>
                  <input
                    ref={templateImportRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      try {
                        const text = await file.text();
                        const parsed = JSON.parse(text);
                        if (parsed.schemaVersion !== 1) {
                          throw new Error('지원하지 않는 템플릿 파일 버전입니다.');
                        }
                        if (!parsed || typeof parsed !== 'object' || !parsed.layoutJson || typeof parsed.layoutJson !== 'object') {
                          throw new Error('템플릿 파일 형식이 올바르지 않습니다.');
                        }
                        if (parsed.cssText !== undefined && typeof parsed.cssText !== 'string') {
                          throw new Error('cssText 형식이 올바르지 않습니다.');
                        }
                        if (!parsed.name || typeof parsed.name !== 'string') {
                          throw new Error('템플릿 이름이 필요합니다.');
                        }
                        const baseName = String(parsed.name).trim();
                        let nextName = baseName || `가져온 양식 ${templates.length + 1}`;
                        const existing = new Set(templates.map((t) => t.name.trim()));
                        if (existing.has(nextName)) {
                          let n = 2;
                          while (existing.has(`${baseName} (${n})`)) n += 1;
                          nextName = `${baseName} (${n})`;
                        }
                        await templatesApi.create({
                          name: nextName,
                          description: parsed.description || '',
                          layoutJson: parsed.layoutJson || {},
                          cssText: parsed.cssText || '',
                          isActive: parsed.isActive !== false,
                        });
                        await loadTemplates();
                        setTemplateMsg('템플릿을 가져왔습니다.');
                      } catch (err: any) {
                        setTemplateMsg(err?.response?.data?.message || '가져오기 실패: JSON 형식을 확인해 주세요.');
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs w-full"
                    onClick={() => templateImportRef.current?.click()}
                  >
                    템플릿 가져오기(JSON)
                  </button>
                </div>
              )}
            </aside>
            <section className="lg:col-span-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">이름</label>
                  <input
                    className="input"
                    value={templateDraft.name}
                    onChange={(e) => setTemplateDraft((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">설명</label>
                  <input
                    className="input"
                    value={templateDraft.description}
                    onChange={(e) => setTemplateDraft((prev) => ({ ...prev, description: e.target.value }))}
                    disabled={!isAdmin}
                  />
                </div>
              </div>
              {isAdmin && canManageTemplatesByPlan && (
                <div className="sticky top-2 z-10 rounded border border-gray-200 bg-white/95 backdrop-blur px-3 py-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-600">
                    {selectedTemplateId ? '변경 후 저장을 눌러 반영하세요.' : '왼쪽에서 템플릿을 선택하면 저장할 수 있습니다.'}
                  </p>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={!selectedTemplateId || templateSaving}
                    onClick={saveSelectedTemplate}
                  >
                    {templateSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              )}
              {advancedTemplateEnabled ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="btn-secondary text-[11px] py-1"
                      onClick={() =>
                        setTemplateDraft((prev) => ({
                          ...prev,
                          html:
                            prev.html +
                            '<table class="tmpl-table"><thead><tr><th>구분</th><th>내용</th></tr></thead><tbody><tr><td>항목</td><td>세부 내용</td></tr></tbody></table>',
                          css: prev.css + '.tmpl-table{width:100%;border-collapse:collapse;margin:10px 0;}.tmpl-table th,.tmpl-table td{border:1px solid #cbd5e1;padding:6px;}',
                        }))
                      }
                    >
                      표 블록 추가
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-[11px] py-1"
                      onClick={() =>
                        setTemplateDraft((prev) => ({
                          ...prev,
                          html:
                            prev.html +
                            '<div class="tmpl-approval"><div>작성</div><div>검토</div><div>승인</div></div>',
                          css: prev.css + '.tmpl-approval{margin-top:16px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}.tmpl-approval>div{border:1px solid #94a3b8;min-height:56px;padding:6px;}',
                        }))
                      }
                    >
                      결재라인 블록 추가
                    </button>
                  </div>
                  <TemplateEditor
                    html={templateDraft.html}
                    css={templateDraft.css}
                    onHtmlChange={(v) => setTemplateDraft((prev) => ({ ...prev, html: v }))}
                    onCssChange={(v) => setTemplateDraft((prev) => ({ ...prev, css: v }))}
                    sampleData={{
                      tenant: { name: user?.tenantName || '샘플회사' },
                      policy: { title: '취업규칙', code: 'HR-001' },
                      today: new Date().toLocaleDateString('ko-KR'),
                      content: '제1조 (목적) 이 규정은 회사 운영의 기준을 정한다.',
                    }}
                  />
                </div>
              ) : (
                <div className="border border-gray-200 rounded p-4 bg-gray-50 space-y-3">
                  <p className="text-sm text-gray-700 font-medium">Pro 기본 템플릿 빌더</p>
                  <p className="text-xs text-gray-500">Enterprise로 업그레이드하면 HTML/CSS 자유 편집도 사용할 수 있습니다.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={basicTemplateDraft.showHeader} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showHeader: e.target.checked }))} />
                      상단 제목 표시
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={basicTemplateDraft.showMeta} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showMeta: e.target.checked }))} />
                      코드/메타 표시
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={basicTemplateDraft.showRevisionDate} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showRevisionDate: e.target.checked }))} />
                      개정일 표시
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={basicTemplateDraft.showEffectiveDate} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showEffectiveDate: e.target.checked }))} />
                      시행일 표시
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={basicTemplateDraft.showArticleTitle} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showArticleTitle: e.target.checked }))} />
                      조문 제목 표시
                    </label>
                    <label className="inline-flex items-center gap-2 sm:col-span-2">
                      <input type="checkbox" checked={basicTemplateDraft.showFooter} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showFooter: e.target.checked }))} />
                      하단 푸터 표시
                    </label>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">로고 최대 높이(px)</label>
                      <input
                        type="number"
                        className="input"
                        min={24}
                        max={120}
                        value={basicTemplateDraft.logoMaxHeight}
                        onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, logoMaxHeight: Number(e.target.value || 48) }))}
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 sm:col-span-2">
                      <input type="checkbox" checked={basicTemplateDraft.showLogo} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showLogo: e.target.checked }))} />
                      회사 로고 표시 (설정의 로고 사용)
                    </label>
                    <label className="inline-flex items-center gap-2 sm:col-span-2">
                      <input type="checkbox" checked={basicTemplateDraft.showApprovalLine} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showApprovalLine: e.target.checked }))} />
                      결재 라인 표시
                    </label>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">결재 라인 라벨</label>
                      <input
                        className="input"
                        value={basicTemplateDraft.approvalLabel}
                        onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, approvalLabel: e.target.value }))}
                        placeholder="결재"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 sm:col-span-2">
                      <input type="checkbox" checked={basicTemplateDraft.useA4Print} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, useA4Print: e.target.checked }))} />
                      인쇄 시 A4 여백 규칙 적용
                    </label>
                    <label className="inline-flex items-center gap-2 sm:col-span-2">
                      <input type="checkbox" checked={basicTemplateDraft.chapterPageBreak} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, chapterPageBreak: e.target.checked }))} />
                      장 단위 페이지 나누기 (인쇄)
                    </label>
                    <label className="inline-flex items-center gap-2 sm:col-span-2">
                      <input type="checkbox" checked={basicTemplateDraft.showPageNumber} onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, showPageNumber: e.target.checked }))} />
                      페이지 번호 표시 (인쇄)
                    </label>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">푸터 문구</label>
                      <input
                        className="input"
                        value={basicTemplateDraft.footerText}
                        onChange={(e) => setBasicTemplateDraft((prev) => ({ ...prev, footerText: e.target.value }))}
                        placeholder="예: 본 문서는 회사 표준 양식에 따라 출력되었습니다."
                      />
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {isAdmin && canManageTemplatesByPlan && selectedTemplateId && (
                  <>
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      onClick={saveSelectedTemplate}
                      disabled={templateSaving}
                    >
                      {templateSaving ? '저장 중...' : '저장'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={async () => {
                        try {
                          await templatesApi.setDefault(selectedTemplateId);
                          await loadTemplates();
                          setTemplateMsg('기본 템플릿으로 지정했습니다.');
                        } catch (e: any) {
                          setTemplateMsg(e?.response?.data?.message || '기본 지정 실패');
                        }
                      }}
                    >
                      기본 지정
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={async () => {
                        try {
                          await templatesApi.clone(selectedTemplateId);
                          await loadTemplates();
                          setTemplateMsg('복제했습니다.');
                        } catch (e: any) {
                          setTemplateMsg(e?.response?.data?.message || '복제 실패');
                        }
                      }}
                    >
                      복제
                    </button>
                    <button
                      type="button"
                      className="text-sm text-red-700 border border-red-300 rounded px-3 py-1.5 hover:bg-red-50"
                      onClick={async () => {
                        if (!confirm('이 템플릿을 삭제할까요?')) return;
                        try {
                          await templatesApi.delete(selectedTemplateId);
                          setSelectedTemplateId('');
                          await loadTemplates();
                          setTemplateMsg('삭제했습니다.');
                        } catch (e: any) {
                          setTemplateMsg(e?.response?.data?.message || '삭제 실패');
                        }
                      }}
                    >
                      삭제
                    </button>
                  </>
                )}
              </div>
              <div className="border border-gray-200 rounded bg-white">
                <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700">템플릿 변경 이력</div>
                <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    className="input text-xs sm:col-span-2"
                    placeholder="이력 검색 (액션/사용자)"
                    value={revisionQuery}
                    onChange={(e) => setRevisionQuery(e.target.value)}
                  />
                  <select
                    className="input text-xs"
                    value={revisionActionFilter}
                    onChange={(e) => setRevisionActionFilter(e.target.value)}
                  >
                    <option value="all">전체 액션</option>
                    <option value="template.create">생성</option>
                    <option value="template.update">수정</option>
                    <option value="template.clone">복제</option>
                    <option value="template.setDefault">기본 지정</option>
                    <option value="template.delete">삭제</option>
                  </select>
                  <input
                    type="date"
                    className="input text-xs"
                    value={revisionFromDate}
                    onChange={(e) => setRevisionFromDate(e.target.value)}
                  />
                  <input
                    type="date"
                    className="input text-xs"
                    value={revisionToDate}
                    onChange={(e) => setRevisionToDate(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setRevisionQuery('');
                      setRevisionActionFilter('all');
                      setRevisionFromDate('');
                      setRevisionToDate('');
                      setRevisionVisibleCount(10);
                      setRevisionSortOrder('desc');
                    }}
                  >
                    필터 초기화
                  </button>
                  <select
                    className="input text-xs"
                    value={revisionSortOrder}
                    onChange={(e) => setRevisionSortOrder(e.target.value as 'desc' | 'asc')}
                  >
                    <option value="desc">최신순</option>
                    <option value="asc">오래된순</option>
                  </select>
                  <label className="inline-flex items-center gap-2 text-xs px-2">
                    <input
                      type="checkbox"
                      checked={semanticChangedOnly}
                      onChange={(e) => setSemanticChangedOnly(e.target.checked)}
                    />
                    변경 필드만 보기
                  </label>
                </div>
                <div className="p-3 space-y-2 max-h-56 overflow-auto">
                  {visibleRevisions.length === 0 && (
                    <p className="text-xs text-gray-500">이력이 없습니다.</p>
                  )}
                  {visibleRevisions.map((rev) => (
                    <div key={rev.id} className="border border-gray-100 rounded p-2 text-xs">
                      {(() => {
                        const before = rev.details?.before || rev.details?.snapshot || {};
                        const after = rev.details?.after || rev.details?.snapshot || {};
                        const impact = getRevisionImpact(rev);
                        const layoutChangedKeys = countObjectKeyChanges(before?.layoutJson, after?.layoutJson);
                        const cssChanged = JSON.stringify(before?.cssText ?? null) !== JSON.stringify(after?.cssText ?? null);
                        return (
                          <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                          {actionLabelMap[rev.action] || rev.action}
                          <span className="px-1.5 py-0.5 rounded bg-navy-50 border border-navy-200 text-navy-700 text-[10px]">
                            {getRevisionChangedCount(rev)}개 변경
                          </span>
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${impact.className}`}>
                            {impact.label}
                          </span>
                          {layoutChangedKeys > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[10px]">
                              레이아웃 {layoutChangedKeys}
                            </span>
                          )}
                          {cssChanged && (
                            <span className="px-1.5 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-700 text-[10px]">
                              스타일 변경
                            </span>
                          )}
                        </span>
                        <span className="text-gray-500">{new Date(rev.createdAt).toLocaleString('ko-KR')}</span>
                      </div>
                      <div className="text-gray-500 mt-1">{rev.user?.name || rev.user?.email || 'system'}</div>
                      {renderRevisionDiff(rev)}
                      <button
                        type="button"
                        className="mt-2 text-xs text-gray-600 hover:text-navy-700 hover:underline mr-3"
                        onClick={() => setSelectedRevisionId((prev) => (prev === rev.id ? '' : rev.id))}
                      >
                        {selectedRevisionId === rev.id ? '상세 닫기' : '상세 보기'}
                      </button>
                      {isAdmin && selectedTemplateId && (rev.details?.after || rev.details?.snapshot) && (
                        <button
                          type="button"
                          className="mt-2 text-xs text-navy-700 hover:underline"
                          onClick={() => setRestoreCandidate(rev)}
                        >
                          이 버전으로 복원
                        </button>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {filteredRevisions.length > visibleRevisions.length && (
                    <button
                      type="button"
                      className="btn-secondary text-xs w-full"
                      onClick={() => setRevisionVisibleCount((n) => n + 10)}
                    >
                      이력 더보기 (+10)
                    </button>
                  )}
                </div>
                {selectedRevision && (
                  <div className="border-t border-gray-200 p-3 bg-gray-50">
                    <div className="text-xs font-semibold text-gray-700 mb-2">이력 상세 JSON</div>
                    <div className="border border-gray-200 rounded bg-white p-2 mb-2">
                      <div className="text-[11px] font-semibold text-gray-700 mb-1">Semantic diff</div>
                      {renderSemanticDiff(selectedRevision)}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                      <div className="border border-gray-200 rounded bg-white">
                        <div className="px-2 py-1 border-b border-gray-100 text-[11px] font-semibold text-gray-600">Before</div>
                        <pre className="p-2 overflow-auto max-h-56 whitespace-pre-wrap break-all">
{renderDiffJson(
  selectedRevision.details?.before || selectedRevision.details?.snapshot || null,
  selectedRevision.details?.after || selectedRevision.details?.snapshot || null,
  'before',
)}
                        </pre>
                      </div>
                      <div className="border border-gray-200 rounded bg-white">
                        <div className="px-2 py-1 border-b border-gray-100 text-[11px] font-semibold text-gray-600">After</div>
                        <pre className="p-2 overflow-auto max-h-56 whitespace-pre-wrap break-all">
{renderDiffJson(
  selectedRevision.details?.after || selectedRevision.details?.snapshot || null,
  selectedRevision.details?.before || selectedRevision.details?.snapshot || null,
  'after',
)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
            <aside className="lg:col-span-4 space-y-3 lg:sticky lg:top-3">
              <div className="border border-gray-200 rounded bg-white p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-700">미리보기 대상 규정</div>
                <select
                  className="input text-sm"
                  value={previewPolicyId}
                  onChange={(e) => setPreviewPolicyId(e.target.value)}
                >
                  <option value="">샘플 규정</option>
                  {previewPolicies.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.title}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500">
                  실제 규정 데이터로 템플릿 렌더 결과를 검증할 수 있습니다.
                </div>
              </div>
              <div className="border border-gray-200 rounded bg-white">
                <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between gap-2">
                  <span>실시간 미리보기</span>
                  <button
                    type="button"
                    className="btn-secondary text-[11px] py-1 px-2"
                    onClick={() => setShowTemplatePreviewModal(true)}
                  >
                    전체보기
                  </button>
                </div>
                <div className="px-3 py-2 border-b border-gray-100">
                  <label className="text-[11px] text-gray-600 inline-flex items-center gap-1.5">
                    인쇄배율
                    <input
                      type="range"
                      min={70}
                      max={130}
                      value={templatePreviewScale}
                      onChange={(e) => setTemplatePreviewScale(Number(e.target.value))}
                    />
                    {templatePreviewScale}%
                  </label>
                </div>
                <div className="p-3 min-h-[420px] max-h-[80vh] overflow-auto">
                  <div
                    className="mx-auto bg-white shadow-sm border border-gray-100 p-2"
                    style={{
                      width: '210mm',
                      minHeight: '297mm',
                      transform: `scale(${templatePreviewScale / 100})`,
                      transformOrigin: 'top center',
                    }}
                  >
                    <TemplateRenderer
                      template={
                        advancedTemplateEnabled
                          ? { layoutJson: { mode: 'html', rawHtml: templateDraft.html }, cssText: templateDraft.css }
                          : { layoutJson: { mode: 'basic', basicConfig: basicTemplateDraft }, cssText: '' }
                      }
                      data={templatePreviewTokenData}
                      fullViewGroups={templatePreviewGroups}
                    />
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">{t('settings.appNameNote')}</p>
      {showPlanModal && <PlanModal onClose={() => setShowPlanModal(false)} />}
      {showTemplatePreviewModal && (
        <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[60] p-4">
          <div className="bg-white w-full max-w-6xl h-[90vh] border border-gray-300 shadow-2xl flex flex-col">
            <div className="bg-navy-900 text-white px-4 py-2.5 text-sm font-medium flex items-center justify-between">
              <span>템플릿 미리보기 전체화면</span>
              <button
                type="button"
                className="btn-secondary text-xs py-1 px-2"
                onClick={() => setShowTemplatePreviewModal(false)}
              >
                닫기
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <TemplateRenderer
                template={
                  advancedTemplateEnabled
                    ? { layoutJson: { mode: 'html', rawHtml: templateDraft.html }, cssText: templateDraft.css }
                    : { layoutJson: { mode: 'basic', basicConfig: basicTemplateDraft }, cssText: '' }
                }
                data={templatePreviewTokenData}
                fullViewGroups={templatePreviewGroups}
              />
            </div>
          </div>
        </div>
      )}
      {restoreCandidate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white w-full max-w-lg border border-gray-300 shadow-2xl">
            <div className="bg-navy-900 text-white px-5 py-3 font-medium text-sm">템플릿 이력 복원 확인</div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{actionLabelMap[restoreCandidate.action] || restoreCandidate.action}</span> 시점으로 템플릿을 복원할까요?
              </p>
              <p className="text-xs text-gray-500">
                {new Date(restoreCandidate.createdAt).toLocaleString('ko-KR')} · {restoreCandidate.user?.name || restoreCandidate.user?.email || 'system'}
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
                현재 템플릿 내용이 덮어써집니다. 필요하면 먼저 JSON으로 내보내세요.
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary text-sm" onClick={() => setRestoreCandidate(null)}>
                  취소
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={async () => {
                    if (!selectedTemplateId) {
                      setRestoreCandidate(null);
                      return;
                    }
                    try {
                      // 스냅샷은 서버가 이력에서 직접 읽는다 (T-58). 화면이 보내면
                      // 복원 기록에 적힌 시점과 실제로 들어간 내용이 어긋날 수 있다.
                      await templatesApi.restore(selectedTemplateId, restoreCandidate.id);
                      await loadTemplates();
                      await loadTemplateRevisions(selectedTemplateId);
                      setTemplateMsg('선택한 이력으로 복원했습니다.');
                    } catch (e: any) {
                      setTemplateMsg(e?.response?.data?.message || '이력 복원 실패');
                    } finally {
                      setRestoreCandidate(null);
                    }
                  }}
                >
                  복원 실행
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
