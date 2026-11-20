import { useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../../api/policies';
import { apiErrorMessage } from '../../lib/apiError';
import { dialogErrorTarget, isRunning, openDialogFor, resultTarget, useOpenDialog, useRuns, type ShownPolicy } from '../../lib/policyResult';
import { useLatest } from '../../lib/useLatest';

type Report = (startedId: string, label: string, message: string, kind: 'success' | 'error', flashMs?: number) => void;
type FileTarget = { policyId: string; label: string };

/**
 * 규정 상세의 첨부 올리기·지우기(T-215 12·13차). 규정마다 화면을 새로 그리므로(PolicyDetailView key):
 * - 진행은 규정별 화면 밖 저장소(useRuns 'upload'·'deleteFile') — 옮겼다 돌아와도 끝나기 전에는 다시 누를 수 없다(같은 파일을 두 번 올리지
 *   않게). 지우는 파일 id 도 저장소에 둬 다시 그린 화면도 그 줄에 '삭제 중'을 보인다
 * - 실패는 시작한 규정의 첨부 창이 열려 있으면 창 안 — 시작한 화면이 내려갔으면 같은 규정을 다시 그린 화면의 열린 첨부 창(도구 줄은 창
 *   뒤에 가린다) — 아니면 결과 알림(그 규정을 그리는 화면의 도구 줄, 없으면 규정 이름 붙은 알림)
 * - 파일 목록은 시작한 규정으로 다시 받는다
 */
export function useAttachmentActions(o: {
  id: string | undefined;
  label: string;
  modalOpen: boolean;
  shown: Readonly<ShownPolicy>;
  report: Report;
  setError: (message: string) => void;
  t: (key: string) => string;
}) {
  const qc = useQueryClient();
  const { running, start, end, targetOf } = useRuns();
  const modalOf = useLatest(o.modalOpen ? o.id : null);
  useOpenDialog('attachments', o.id, o.modalOpen, o.setError);
  const { shown, report, setError, t } = o;
  const failed = (v: FileTarget, err: unknown, fallbackKey: string) => {
    const message = apiErrorMessage(err, t(fallbackKey));
    if (dialogErrorTarget(v.policyId, shown, modalOf.current) === 'dialog') return setError(message);
    const elsewhere = openDialogFor('attachments', v.policyId);
    if (elsewhere) elsewhere(message);
    else report(v.policyId, v.label, message, 'error');
  };
  // 목록을 다시 받은 뒤에 진행을 푼다(onSettled 는 onSuccess 가 돌려준 약속을 기다린다) — 지운 줄이 다시 받기 전까지 풀린 휴지통으로
  // 남거나 새 파일이 보이기 전에 추가 버튼이 풀리지 않게(14차 #5)
  const done = (v: FileTarget) => {
    if (resultTarget(v.policyId, shown) === 'toolbar') setError('');
    return qc.invalidateQueries({ queryKey: ['files', v.policyId] });
  };
  const uploadMutation = useMutation({
    mutationFn: (v: FileTarget & { file: File }) => filesApi.upload(v.policyId, v.file),
    onSuccess: (_r, v) => done(v),
    onError: (err, v) => failed(v, err, 'policyDetail.files.uploadFailed'),
    onSettled: (_r, _e, v) => end('upload', v.policyId),
  });
  const deleteMutation = useMutation({
    mutationFn: (v: FileTarget & { fileId: string }) => filesApi.delete(v.policyId, v.fileId),
    onSuccess: (_r, v) => done(v),
    onError: (err, v) => failed(v, err, 'policyDetail.files.deleteFailed'),
    onSettled: (_r, _e, v) => end('deleteFile', v.policyId),
  });
  const deleteBusy = isRunning(running, 'deleteFile', o.id);
  return {
    uploadBusy: isRunning(running, 'upload', o.id),
    deleteBusy,
    /** 지우는 중인 파일(저장소의 보낸 값 — 다시 그린 화면도 안다) */
    removingId: deleteBusy ? targetOf('deleteFile', o.id) : undefined,
    upload: (file: File) => {
      if (o.id && start('upload', o.id)) uploadMutation.mutate({ policyId: o.id, label: o.label, file });
    },
    remove: (fileId: string) => {
      if (o.id && start('deleteFile', o.id, fileId)) deleteMutation.mutate({ policyId: o.id, label: o.label, fileId });
    },
  };
}
