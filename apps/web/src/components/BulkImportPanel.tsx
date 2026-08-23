import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle, FileJson, Upload } from 'lucide-react';
import { adminApi, type ImportIssue, type ImportValidateResult } from '../api/admin';

/**
 * 규정 일괄 가져오기 (T-13).
 *
 * `POST /admin/import/policies` 는 있었지만 화면이 없어 관리자가 직접 요청을 만들어야 했다.
 *
 * 넣기 전에 **사전 검사를 반드시 거치게** 했다. 저장은 한 트랜잭션이라 하나만 걸려도
 * 전부 무산되는데, 그때 오류 한 줄만 보이면 고치고 다시 올리기를 반복하게 된다.
 */

const SAMPLE = `{
  "policies": [
    {
      "code": "HR-001",
      "title": "인사규정",
      "description": "임직원 인사에 관한 사항",
      "chapters": [
        {
          "number": 1,
          "title": "총칙",
          "articles": [
            { "number": 1, "title": "목적", "content": "이 규정은 …", "publish": true },
            { "number": 2, "title": "적용범위", "content": "이 규정은 …" }
          ]
        }
      ]
    }
  ]
}`;

function IssueList({ issues }: { issues: ImportIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1 max-h-64 overflow-y-auto">
      {issues.map((issue, i) => (
        <li
          key={i}
          className={clsx(
            'text-xs rounded px-2 py-1.5 border',
            issue.level === 'error'
              ? 'text-red-800 bg-red-50 border-red-200'
              : 'text-amber-900 bg-amber-50 border-amber-200',
          )}
        >
          <span className="font-medium">{issue.level === 'error' ? '오류' : '주의'}</span>
          {issue.policyIndex !== null && (
            <span className="text-gray-600">
              {' '}
              · {issue.policyIndex + 1}번째{issue.code ? ` (${issue.code})` : ''}
            </span>
          )}
          <span> — {issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

export default function BulkImportPanel({ onImported }: { onImported?: () => void }) {
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<ImportValidateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ importedPolicies: number } | null>(null);
  const [serverError, setServerError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /** 검사 결과는 본문이 바뀌는 순간 무효다 — 남겨 두면 옛 결과를 보고 저장하게 된다 */
  const onTextChange = (value: string) => {
    setText(value);
    setResult(null);
    setParseError('');
    setDone(null);
    setServerError('');
  };

  const parsed = (): { policies: unknown[] } | null => {
    try {
      const obj = JSON.parse(text);
      const policies = Array.isArray(obj) ? obj : obj?.policies;
      if (!Array.isArray(policies)) {
        setParseError('최상위에 `policies` 배열이 있어야 합니다.');
        return null;
      }
      return { policies };
    } catch (e: any) {
      setParseError(`JSON 을 읽지 못했습니다: ${e?.message ?? e}`);
      return null;
    }
  };

  const validate = async () => {
    setParseError('');
    setServerError('');
    const body = parsed();
    if (!body) return;
    setBusy(true);
    try {
      setResult(await adminApi.validateImport(body as any));
    } catch (e: any) {
      setServerError(e?.response?.data?.message || '사전 검사에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    const body = parsed();
    if (!body) return;
    setBusy(true);
    setServerError('');
    try {
      const res = await adminApi.importPolicies(body as any);
      setDone({ importedPolicies: res.importedPolicies });
      setResult(null);
      setText('');
      onImported?.();
    } catch (e: any) {
      const data = e?.response?.data;
      setServerError(data?.message || '가져오기에 실패했습니다.');
      if (Array.isArray(data?.issues)) {
        setResult({ issues: data.issues, canImport: false, summary: { policies: 0, chapters: 0, articles: 0 } });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-600 space-y-1">
        <p>
          규정·장·조를 담은 JSON 을 한 번에 등록합니다. <strong>관리자 전용</strong>이며, 저장은 한 번에
          이뤄집니다 — 하나라도 문제가 있으면 아무것도 들어가지 않습니다.
        </p>
        <p className="text-gray-500">
          조 번호는 장을 가로질러 이어 매깁니다(제1장 제1·2조 → 제2장 제3조). <code>publish: true</code> 면
          첫 버전이 바로 게시본이 됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => onTextChange(String(reader.result ?? ''));
            reader.onerror = () => setParseError('파일을 읽지 못했습니다.');
            reader.readAsText(file);
          }}
        />
        <button type="button" className="btn-secondary text-sm" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> JSON 파일 열기
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={() => onTextChange(SAMPLE)}>
          <FileJson size={14} /> 예시 채우기
        </button>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1" htmlFor="bulk-import-json">
          JSON
        </label>
        <textarea
          id="bulk-import-json"
          className="input font-mono text-xs resize-y w-full"
          rows={14}
          spellCheck={false}
          placeholder='{"policies": [ … ]}'
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />
      </div>

      {parseError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{parseError}</p>
      )}
      {serverError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{serverError}</p>
      )}

      {result && (
        <div className="space-y-2">
          <div
            className={clsx(
              'text-xs rounded px-2.5 py-2 border flex items-start gap-2',
              result.canImport
                ? 'text-emerald-900 bg-emerald-50 border-emerald-200'
                : 'text-red-800 bg-red-50 border-red-200',
            )}
          >
            {result.canImport ? (
              <CheckCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            )}
            <span>
              규정 {result.summary.policies}건 · 장 {result.summary.chapters}개 · 조 {result.summary.articles}개.{' '}
              {result.canImport ? '가져올 수 있습니다.' : '오류를 먼저 고쳐야 합니다.'}
            </span>
          </div>
          <IssueList issues={result.issues} />
        </div>
      )}

      {done && (
        <p className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
          규정 {done.importedPolicies}건을 가져왔습니다. 규정 목록에서 확인하세요.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-200">
        <button
          type="button"
          className="btn-secondary text-sm mt-3"
          onClick={validate}
          disabled={!text.trim() || busy}
        >
          {busy ? '확인 중…' : '사전 검사'}
        </button>
        <button
          type="button"
          className="btn-primary text-sm mt-3"
          onClick={doImport}
          /* 검사를 통과해야만 저장할 수 있다 — 실패를 트랜잭션 롤백으로 배우게 하지 않는다 */
          disabled={!result?.canImport || busy}
        >
          {busy ? '가져오는 중…' : '가져오기'}
        </button>
      </div>
    </div>
  );
}
