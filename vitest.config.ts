import { defineConfig } from 'vitest/config';

/**
 * 워크스페이스 공용 테스트 설정.
 *
 * DB·브라우저 없이 도는 순수 로직만 대상으로 한다(조·항·목 구조 계산, 날짜 처리,
 * 시크릿 가드 등). DB·API가 실제로 떠야 하는 플로우 테스트는
 * `vitest.integration.config.ts` 로 분리했다 — `npm run test:int`.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // `.int.test.ts` 도 `*.test.ts` 에 걸린다. 빼지 않으면 단위 테스트를 돌릴 때마다
    // 컨테이너가 떠 있어야 해서, 결국 아무도 안 돌리게 된다.
    exclude: ['tests/integration/**'],
    environment: 'node',
    reporters: 'default',
  },
});
