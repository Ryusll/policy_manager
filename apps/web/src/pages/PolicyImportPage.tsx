/**
 * 규정 가져오기 (T-12 PDF · T-55 법제처) — 원문 확보 → 조항 트리 미리보기·수정 → 규정 커밋.
 *
 * 원문 소스는 둘이다: PDF 업로드와 법제처 OPEN API. 둘 다 서버에서 같은 파싱 세션
 * (`RegulationParseSession`)을 만들기 때문에, 2·3단계(미리보기·수정·커밋)는 완전히 같은
 * 코드를 탄다. 소스가 늘어도 갈라지는 곳은 1단계뿐이다.
 *
 * 규정 목록의 "기존 규정 가져오기"는 브라우저에서 텍스트를 뽑아 클라이언트가 파싱하는 경로다
 * (TXT·DOCX·붙여넣기에 적합). 이 화면은 서버의 `regulation-parse` 모듈을 쓴다.
 * pdfplumber/PyMuPDF가 글꼴 크기·굵기까지 보고 조항 계층을 잡아주므로 PDF는 이쪽이 정확하다.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Upload, FileText, Trash2, ChevronRight, RotateCcw, Check, Scale, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import {
  regulationParseApi,
  flattenParseTree,
  replaceParseNode,
  removeParseNode,
  type ParseSession,
  type ParseTreeNode,
} from '../api/regulationParse';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { EmptyState } from '../components/ui/EmptyState';
import { toast } from '../stores/toastStore';
import { LawGoKrSearchPanel } from '../components/LawGoKrSearchPanel';
import type { LawGoKrSessionMeta } from '../api/lawgokr';

const MAX_PDF_BYTES = 30 * 1024 * 1024; // 서버 FileInterceptor 제한과 동일

type Step = 'upload' | 'review' | 'done';
type Source = 'pdf' | 'lawgokr';

export default function PolicyImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<Source>('pdf');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roots, setRoots] = useState<ParseTreeNode[]>([]);
  const [dirty, setDirty] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', title: '', description: '' });
  const [createdPolicyId, setCreatedPolicyId] = useState<string | null>(null);

  // 서버 추출이 오래 걸릴 수 있어 status가 processing인 동안만 폴링한다
  const { data: session, isLoading: isSessionLoading } = useQuery<ParseSession>({
    queryKey: ['regulation-parse', sessionId],
    queryFn: () => regulationParseApi.get(sessionId!),
    enabled: !!sessionId,
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' || query.state.data?.status === 'pending' ? 1500 : false,
  });

  // 서버 트리를 처음 받았을 때만 로컬 편집본에 싣는다(편집 중 폴링이 덮어쓰지 않도록)
  useEffect(() => {
    if (!session?.parseTree?.roots || dirty) return;
    setRoots(session.parseTree.roots);
  }, [session?.parseTree, dirty]);

  useEffect(() => {
    if (!session) return;
    if (!form.title && session.fileName) {
      setForm((f) => ({ ...f, title: session.fileName.replace(/\.pdf$/i, '').trim() }));
    }
  }, [session, form.title]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => regulationParseApi.upload(file),
    onSuccess: (created) => {
      setSessionId(created.id);
      setRoots(created.parseTree?.roots || []);
      setDirty(false);
      setUploadError('');
    },
    onError: (err: any) => {
      setUploadError(err?.response?.data?.message?.toString() || '업로드에 실패했습니다.');
    },
  });

  const saveTreeMutation = useMutation({
    mutationFn: () => regulationParseApi.updateTree(sessionId!, roots),
    onSuccess: () => {
      setDirty(false);
      toast('조항 트리를 저장했습니다.', 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message?.toString() || '트리 저장에 실패했습니다.', 'error');
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      // 편집분이 남아 있으면 커밋 전에 먼저 저장한다(서버는 저장된 트리로 규정을 만든다)
      if (dirty) await regulationParseApi.updateTree(sessionId!, roots);
      return regulationParseApi.commit(sessionId!, {
        code: form.code.trim(),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
      });
    },
    onSuccess: (result) => {
      setDirty(false);
      setCreatedPolicyId(result.policyId);
      toast(`규정을 만들었습니다. 조문 ${result.articleCount}건.`, 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message?.toString() || '규정 생성에 실패했습니다.', 'error');
    },
  });

  const flat = useMemo(() => flattenParseTree(roots), [roots]);
  // 법제처 세션이면 서지사항이 extractMeta 에 실려 온다(출처를 되짚을 때 필요하다)
  const lawMeta: LawGoKrSessionMeta | null =
    session?.extractMeta?.source === 'lawgokr' ? (session.extractMeta as LawGoKrSessionMeta) : null;
  const step: Step = createdPolicyId ? 'done' : sessionId ? 'review' : 'upload';
  const status = session?.status ?? 'pending';
  const isBusy = status === 'pending' || status === 'processing';
  const canCommit =
    !!form.code.trim() && !!form.title.trim() && flat.length > 0 && status === 'ready';

  const pickFile = (file: File) => {
    setUploadError('');
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setUploadError('PDF 파일만 업로드할 수 있습니다. TXT·DOCX는 규정 목록의 "기존 규정 가져오기"를 이용하세요.');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setUploadError('30MB 이하 PDF만 업로드할 수 있습니다.');
      return;
    }
    uploadMutation.mutate(file);
  };

  const resetAll = () => {
    // source는 일부러 되돌리지 않는다 — 같은 소스로 연달아 가져오는 편이 흔하다
    setSessionId(null);
    setRoots([]);
    setDirty(false);
    setUploadError('');
    setEditingId(null);
    setCreatedPolicyId(null);
    setForm({ code: '', title: '', description: '' });
  };

  return (
    <div className="page-shell space-y-4">
      <PageHeader
        title="규정 가져오기"
        description="PDF를 올리거나 법제처에서 법령을 찾아오면, 서버가 조항 계층을 추출합니다. 미리보기에서 고친 뒤 규정으로 등록하세요."
        actions={
          sessionId ? (
            <button type="button" className="btn-secondary text-sm" onClick={resetAll}>
              <RotateCcw size={14} /> 새로 시작
            </button>
          ) : undefined
        }
      />

      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ['upload', '1. 원문 가져오기'],
            ['review', '2. 조항 미리보기·수정'],
            ['done', '3. 규정 등록'],
          ] as const
        ).map(([key, label], idx) => (
          <li key={key} className="flex items-center gap-2">
            {idx > 0 && <ChevronRight size={13} className="text-gray-300" aria-hidden />}
            <span
              className={clsx(
                'px-2.5 py-1 rounded border',
                step === key
                  ? 'bg-navy-700 text-white border-navy-700 font-medium'
                  : 'bg-white text-gray-500 border-gray-300',
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <section className="bg-white border border-gray-300 shadow-sm p-5 space-y-4">
          <div className="flex gap-1 border-b border-gray-200 -mx-1 px-1">
            {(
              [
                ['pdf', 'PDF 업로드', FileText],
                ['lawgokr', '법제처에서 가져오기', Scale],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSource(key)}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
                  source === key
                    ? 'border-navy-700 text-navy-800 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          {source === 'lawgokr' && (
            <LawGoKrSearchPanel
              onSessionCreated={(created) => {
                setSessionId(created.id);
                setRoots(created.parseTree?.roots || []);
                setDirty(false);
                setUploadError('');
              }}
            />
          )}

          {source === 'pdf' && (
          <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickFile(file);
              e.target.value = '';
            }}
          />
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-navy-400 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) pickFile(file);
            }}
          >
            <FileText size={36} className="mx-auto text-gray-300 mb-3" strokeWidth={1.25} />
            <p className="text-sm text-gray-700 mb-1">PDF를 끌어다 놓거나 파일을 선택하세요.</p>
            <p className="text-xs text-gray-500 mb-4">최대 30MB · PDF만 지원</p>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              <Upload size={15} />
              {uploadMutation.isPending ? '업로드 중…' : '파일 선택'}
            </button>
          </div>
          {uploadError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{uploadError}</p>
          )}
          <p className="text-[11px] text-gray-500">
            TXT·DOCX·본문 붙여넣기는 규정 목록의 &quot;기존 규정 가져오기&quot;를 이용하세요. PDF는 서버가 글꼴
            정보까지 보고 조·항 계층을 잡아 이 경로가 더 정확합니다.
          </p>
          </div>
          )}
        </section>
      )}

      {step === 'review' && (
        <>
          <section className="bg-white border border-gray-300 shadow-sm p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{session?.fileName}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  상태: {status}
                  {session?.extractMeta?.engine ? ` · 추출 엔진: ${session.extractMeta.engine}` : ''}
                  {lawMeta ? ' · 출처: 법제처' : ''}
                  {` · 조항 ${flat.length}건`}
                </p>
                {lawMeta && (
                  <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                    {[lawMeta.lawType, lawMeta.revisionType].filter(Boolean).join(' · ')}
                    {lawMeta.promulgationDate ? ` · 공포 ${lawMeta.promulgationDate}` : ''}
                    {lawMeta.effectiveDate ? ` · 시행 ${lawMeta.effectiveDate}` : ''}
                    {lawMeta.sourceUrl && (
                      <>
                        {' · '}
                        <a
                          href={lawMeta.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-navy-700 underline inline-flex items-center gap-0.5"
                        >
                          원문 <ExternalLink size={10} />
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
              {dirty && (
                <button
                  type="button"
                  className="btn-secondary text-xs py-1.5"
                  onClick={() => saveTreeMutation.mutate()}
                  disabled={saveTreeMutation.isPending}
                >
                  {saveTreeMutation.isPending ? '저장 중…' : '수정분 저장'}
                </button>
              )}
            </div>
            {status === 'failed' && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                추출에 실패했습니다: {session?.errorMessage || '원인 불명'}
              </p>
            )}
          </section>

          {isBusy || isSessionLoading ? (
            <LoadingBlock label="PDF에서 조항을 추출하는 중입니다…" />
          ) : flat.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="추출된 조항이 없습니다."
              description="스캔 이미지 PDF이거나 조항 번호 형식이 특이할 수 있습니다. 규정 목록의 텍스트 붙여넣기 경로를 이용해 보세요."
            />
          ) : (
            <section className="bg-white border border-gray-300 shadow-sm">
              <header className="px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-700">
                조항 트리 — 제목·본문을 고치거나 잘못 잡힌 항목을 삭제할 수 있습니다
              </header>
              <ul className="divide-y divide-gray-100 max-h-[52vh] overflow-y-auto">
                {flat.map((node) => (
                  <ParseNodeRow
                    key={node.id}
                    node={node}
                    isEditing={editingId === node.id}
                    onEdit={() => setEditingId(node.id)}
                    onCancel={() => setEditingId(null)}
                    onChange={(patch) => {
                      setRoots((prev) => replaceParseNode(prev, node.id, patch));
                      setDirty(true);
                    }}
                    onRemove={() => {
                      setRoots((prev) => removeParseNode(prev, node.id));
                      setDirty(true);
                      if (editingId === node.id) setEditingId(null);
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="bg-white border border-gray-300 shadow-sm p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">규정으로 등록</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="import-code">
                  규정 코드 <span className="text-red-500">*</span>
                </label>
                <input
                  id="import-code"
                  className="input"
                  placeholder="예) SEC-001"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="import-title">
                  규정 제목 <span className="text-red-500">*</span>
                </label>
                <input
                  id="import-title"
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="import-desc">
                  설명
                </label>
                <textarea
                  id="import-desc"
                  className="input min-h-[4rem]"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={!canCommit || commitMutation.isPending}
                onClick={() => commitMutation.mutate()}
              >
                <Check size={15} />
                {commitMutation.isPending ? '등록 중…' : `조항 ${flat.length}건으로 규정 만들기`}
              </button>
              {!canCommit && status === 'ready' && (
                <span className="text-[11px] text-gray-500">코드와 제목을 입력하세요.</span>
              )}
            </div>
          </section>
        </>
      )}

      {step === 'done' && (
        <section className="bg-white border border-gray-300 shadow-sm p-6 text-center space-y-3">
          <Check size={32} className="mx-auto text-emerald-600" />
          <p className="text-sm text-gray-800">규정을 등록했습니다.</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => navigate(`/policies/${createdPolicyId}`)}
            >
              등록된 규정 열기
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={resetAll}>
              다른 PDF 가져오기
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ParseNodeRow({
  node,
  isEditing,
  onEdit,
  onCancel,
  onChange,
  onRemove,
}: {
  node: ParseTreeNode;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onChange: (patch: Partial<ParseTreeNode>) => void;
  onRemove: () => void;
}) {
  const indent = Math.min(Math.max(Number(node.depth) || 0, 0), 5);
  return (
    <li className="px-4 py-2.5" style={{ paddingLeft: `${16 + indent * 18}px` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  className="input text-xs py-1 w-32"
                  value={node.articleNumber}
                  onChange={(e) => onChange({ articleNumber: e.target.value })}
                  aria-label="조항 번호"
                />
                <input
                  className="input text-xs py-1 flex-1 min-w-[10rem]"
                  value={node.articleTitle}
                  onChange={(e) => onChange({ articleTitle: e.target.value })}
                  aria-label="조항 제목"
                />
              </div>
              <textarea
                className="input text-xs py-1 min-h-[5rem]"
                value={node.content}
                onChange={(e) => onChange({ content: e.target.value })}
                aria-label="조항 본문"
              />
              <button type="button" className="btn-secondary text-[11px] py-1" onClick={onCancel}>
                편집 닫기
              </button>
            </div>
          ) : (
            <button type="button" className="text-left w-full" onClick={onEdit}>
              <span className="text-xs font-semibold text-navy-800">{node.articleNumber}</span>
              {node.articleTitle ? (
                <span className="text-xs text-gray-900 ml-1.5">{node.articleTitle}</span>
              ) : null}
              {node.pageNumber ? (
                <span className="text-[10px] text-gray-400 ml-1.5">p.{node.pageNumber}</span>
              ) : null}
              {node.content ? (
                <p className="text-[11px] text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">{node.content}</p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1">(본문 없음)</p>
              )}
            </button>
          )}
        </div>
        <button
          type="button"
          className="p-1 text-gray-400 hover:text-red-600 shrink-0"
          onClick={onRemove}
          aria-label={`${node.articleNumber} 삭제`}
          title="이 조항과 하위 항목 삭제"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
