import { defineConfig } from 'vitest/config';

/**
 * 워크스페이스 공용 테스트 설정.
 *
 * 현재는 DB·브라우저 없이 도는 순수 로직만 대상으로 한다(조·항·목 구조 계산, 날짜 처리,
 * 시크릿 가드 등). DB가 필요한 플로우 테스트(로그인·규정 CRUD·버전 승인)는 컨테이너를
 * 띄워야 해서 별도 과제로 둔다 — 작업관리대장 T-30 참고.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
