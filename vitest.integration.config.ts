import { defineConfig } from 'vitest/config';

/**
 * DB·API가 실제로 떠 있어야 도는 통합 테스트 (T-30 잔여분).
 *
 * `npm test`(단위)와 분리한 이유: 단위 테스트는 컨테이너 없이 몇 초 안에 끝나야
 * 개발 중에 계속 돌린다. 여기에 섞으면 둘 다 안 돌리게 된다.
 *
 * 실행: `docker compose up -d` 후 `npm run test:int`
 * 대상 주소는 `API_BASE_URL`로 바꿀 수 있다(기본 http://localhost:3001/api).
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    environment: 'node',
    reporters: 'default',
    // 로그인·규정 생성이 오가므로 기본 5초로는 부족하다
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // 테넌트를 공유하지 않도록 파일 단위로 순차 실행한다
    fileParallelism: false,
  },
});
