import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/** tsconfig 로 타입을 읽을 수 있는 파일 — 각각 가장 가까운 tsconfig.json 에 붙는다 */
const TYPE_AWARE = ['apps/api/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'tests/**/*.ts'];

/**
 * eslint-plugin-react-hooks v7 의 `recommended` 에는 React Compiler 검사가 섞여 있다.
 * 이 프로젝트는 React Compiler 를 쓰지 않으므로, 아래 네 룰이 지적하는 건 "지금 버그"가
 * 아니라 "컴파일러를 켜려면 고쳐야 할 목록"이다 — 대부분 localStorage 값을 마운트 때
 * state 로 옮기는 패턴이고, 에러로 두면 PolicyDetailPage(4,900줄)를 통째로 재구성해야
 * lint 가 통과한다. 게다가 이 룰들의 메시지는 여러 줄이라 켜 두면 출력 정렬이 무너져
 * 다른 지적까지 안 읽히게 된다. 컴파일러 도입을 결정하면 되살릴 것(기술부채 #11).
 *
 * 같은 플러그인의 나머지(rules-of-hooks·set-state-in-render·refs·error-boundaries 등)는
 * 컴파일러와 무관한 진짜 버그 룰이므로 recommended 강도를 그대로 둔다.
 */
const REACT_COMPILER_MIGRATION_RULES = {
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/immutability': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/api/dist-seed/**',
      'apps/web/dist/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/prisma/migrations/**',
      // pdfjs-dist 가 배포한 워커 번들 — 우리가 쓰는 코드가 아니다
      'apps/web/public/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // ── 타입 정보를 쓰는 룰 ─────────────────────────────────────────
  {
    files: TYPE_AWARE,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // no-unsafe-* 는 `any` 가 흘러다니는 자리를 전부 짚는다. 이 코드베이스는
      // API 응답·DTO 경계를 `any` 로 받고 있어서 켜면 수백 건이 나오고,
      // 그 소음이 정작 잡고 싶은 것(await 누락)을 덮는다. `any` 자체는
      // 아래에서 경고로 남겨 부채로 세어 둔다.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // 템플릿 문자열에 숫자·불리언을 넣는 건 이 코드베이스에서 의도된 표현이다.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      // `String(x)` 의 x 가 `unknown` 인 곳은 전부 외부 입력(쿼리스트링·DTO·JSON)을
      // 문자열로 눕히는 경계다. 결과는 곧바로 정규식이나 parseInt 로 검증하므로
      // '[object Object]' 가 되더라도 그냥 걸러진다 — 여기서 막으면 경계마다
      // 타입 분기를 심게 되고, 그 분기가 오히려 동작을 바꾼다.
      // (ignoredTypeNames 를 주면 기본값을 대체하므로 Error·RegExp 등을 다시 적는다)
      '@typescript-eslint/no-base-to-string': [
        'error',
        { ignoredTypeNames: ['Error', 'RegExp', 'URL', 'URLSearchParams', 'unknown'] },
      ],
      // 이 설정의 핵심 룰. 다만 TanStack Query 의 캐시 무효화는 설계상
      // 기다리지 않는 호출이다 — 반환된 프라미스는 재조회가 끝나는 시점을
      // 알려줄 뿐이고 실패는 쿼리 상태로 들어간다. 여기까지 잡으면 코드베이스의
      // `onSuccess` 마다 `void` 를 붙이게 되고, 그 습관이 진짜 누락을 덮는다.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: '@tanstack/query-core', name: 'invalidateQueries' },
            { from: 'package', package: '@tanstack/query-core', name: 'removeQueries' },
            { from: 'package', package: '@tanstack/query-core', name: 'cancelQueries' },
          ],
        },
      ],
    },
  },

  // ── 공용 룰 조정 ────────────────────────────────────────────────
  {
    rules: {
      // `_` 로 시작하는 이름은 "안 쓰는 걸 알고 남겨둔 것"으로 본다.
      // catch 변수도 마찬가지 — `catch (_e)` 를 굳이 지우게 만들 이유가 없다.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // `any` 는 경고까지만. 외부 라이브러리 경계에서 불가피한 곳이 있고,
      // 에러로 두면 그 순간 `eslint-disable` 주석만 늘어난다.
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // ── API (NestJS) ───────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // NestJS 모듈·DTO 는 멤버 없는 클래스가 정상이다.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      // apps/api 는 `strictNullChecks: false` 라 이 룰이 `x!` 를 전부 "불필요"로
      // 본다 — null 이 애초에 타입에 없기 때문이다. 그대로 지우면 strict 로
      // 올리는 날 다시 붙여야 하고, 그때는 어디에 필요했는지 알 수 없다.
      // strictNullChecks 를 켜면 같이 켤 것(기술부채 #10).
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },

  // ── WEB (React) ────────────────────────────────────────────────
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...REACT_COMPILER_MIGRATION_RULES,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `onClick={async () => …}` 은 React 의 관용 표현이라 attributes 검사는 끈다.
      // 인자·프로퍼티 자리(예: `Array.prototype.filter(async …)`)는 계속 잡는다.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // ── 테스트 ──────────────────────────────────────────────────────
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // 응답 본문은 any 다. 테스트에서까지 타입을 세우면 배보다 배꼽이 커진다.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── tsconfig 밖의 설정 파일·스크립트 ──────────────────────────────
  {
    files: ['**/*.{js,mjs,cjs}', '*.ts', 'apps/*/*.ts', 'apps/api/prisma/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
  },
);
