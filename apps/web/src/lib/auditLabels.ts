/**
 * 감사 로그 표시 이름 (T-11).
 *
 * 액션 이름(`version.approve`)을 그대로 보여 주면 감사 담당자가 읽을 수 없다.
 * 이름이 `분류.동작` 으로 갈라져 있어서 **묶음 단위 필터**도 여기서 함께 정의한다.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'policy.create': '규정 생성',
  'policy.update': '규정 수정',
  'policy.delete': '규정 삭제',
  'policy.articles.reorder': '조 순서 재정렬',
  'policy.file.upload': '첨부파일 추가',
  'policy.file.delete': '첨부파일 삭제',
  'policy.export.pdf': '규정 PDF 내보내기',
  'policy.export.hwpx': '규정 HWPX 내보내기',
  'policy.revision_reason.create': '제·개정 이유 추가',
  'policy.revision_reason.update': '제·개정 이유 수정',
  'policy.revision_reason.delete': '제·개정 이유 삭제',
  'chapter.create': '장 추가',
  'section.create': '절 추가',
  'version.create': '조문 버전 작성',
  'version.update': '조문 버전 수정',
  'version.submit_review': '검토 요청',
  'version.approve': '시행 승인',
  'version.reject': '검토 반려',
  'version.archive': '게시본 폐지',
  'template.create': '템플릿 생성',
  'template.update': '템플릿 수정',
  'template.delete': '템플릿 삭제',
  'template.clone': '템플릿 복제',
  'template.setDefault': '기본 템플릿 지정',
  'template.restore': '템플릿 이력 복원',
  'branding.update': '회사 브랜딩 변경',
  'user.invited': '사용자 초대',
  'admin.import_policies': '규정 일괄 가져오기',
  'revision.notify_sent': '개정 알림 발송',
  'tenant.plan_changed': '요금제 변경',
  'platform_admin.tenant_plan.update': '[플랫폼] 테넌트 요금제 변경',
  'platform_admin.user_role.update': '[플랫폼] 사용자 역할 변경',
  'platform_admin.platform_role.update': '[플랫폼] 플랫폼 역할 변경',
};

/** 이름을 모르면 원문을 그대로 보여 준다 — 빈칸보다 낫다 */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** 필터 묶음. 값 끝의 `.` 이 서버에서 접두어 일치로 해석된다 */
export const AUDIT_GROUPS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'policy.', label: '규정' },
  { value: 'version.', label: '조문 버전' },
  { value: 'template.', label: '템플릿' },
  { value: 'chapter.', label: '장' },
  { value: 'section.', label: '절' },
  { value: 'user.', label: '사용자' },
  { value: 'branding.', label: '브랜딩' },
  { value: 'admin.', label: '관리자 작업' },
  { value: 'revision.', label: '개정 알림' },
  { value: 'tenant.', label: '요금제' },
  { value: 'platform_admin.', label: '플랫폼 관리' },
];

/**
 * 되돌릴 수 없는 동작인지. 목록에서 눈에 띄게 하려고 쓴다 —
 * 감사 화면을 여는 이유의 대부분이 "무엇이 사라졌나"를 찾는 것이다.
 */
export function isDestructiveAction(action: string): boolean {
  return /\.delete$/.test(action) || action === 'version.archive';
}

/** 액션이 어떤 묶음에 드는지 (목록 그룹핑용) */
export function auditGroupOf(action: string): string {
  const idx = action.indexOf('.');
  return idx === -1 ? action : action.slice(0, idx + 1);
}
