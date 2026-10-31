import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import { resolve } from 'path';

/**
 * ESLint 설정이 실제로 동작하는지 (T-32).
 *
 * 이 프로젝트에는 오랫동안 `npm run lint` 스크립트만 있고 설정 파일이 없었다.
 * 명령은 성공한 것처럼 끝나는데 아무 룰도 돌지 않아서, 아무도 그 사실을
 * 눈치채지 못했다. 그 상태로 되돌아가는 걸 막는 것이 이 테스트의 목적이다.
 *
 * 그래서 "설정 파일이 존재한다"가 아니라 **룰이 실제로 지적을 만든다**를 본다.
 */

const ROOT = resolve(__dirname, '..');

describe('ESLint 설정 (T-32)', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({ cwd: ROOT });
  });

  // 실제로 없는 파일이라 타입 정보를 붙일 수 없다. 타입 룰이 걸리지 않는
  // 리포 루트 경로로 검사해 문법 기반 룰만 확인한다.
  const probe = (code: string) =>
    eslint.lintText(code, { filePath: resolve(ROOT, '__lint_probe__.ts') });

  it('룰이 실제로 돈다 — 잘못된 코드에 지적이 나온다', async () => {
    const [result] = await probe('const unused = 1;\nexport const ok = 2;\n');
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
    expect(result.messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-unused-vars');
  });

  it('`_` 로 시작하는 이름은 안 쓴다고 지적하지 않는다', async () => {
    const [result] = await probe('export function f(_unused: number): number {\n  return 1;\n}\n');
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
    expect(result.messages.map((m) => m.ruleId)).not.toContain(
      '@typescript-eslint/no-unused-vars',
    );
  });

  /**
   * await 누락은 타입체크도 테스트도 통과한다. 이 설정을 둔 가장 큰 이유라
   * 룰 강도와 타입 정보 연결을 함께 확인한다 — 둘 중 하나만 빠져도 조용히 꺼진다.
   */
  describe('타입 정보를 쓰는 룰', () => {
    const typeAware = [
      'apps/api/src/policies/policies.service.ts',
      'apps/web/src/pages/SettingsPage.tsx',
      'tests/integration/helpers.ts',
    ];

    it.each(typeAware)('%s 에 타입 정보가 연결돼 있다', async (file) => {
      const config = await eslint.calculateConfigForFile(resolve(ROOT, file));
      expect(config.languageOptions?.parserOptions?.projectService).toBe(true);
    });

    it.each(typeAware)('%s 에서 no-floating-promises 가 에러다', async (file) => {
      const config = await eslint.calculateConfigForFile(resolve(ROOT, file));
      // calculateConfigForFile 은 강도를 숫자로 정규화해서 돌려준다(2 = error)
      const level = config.rules?.['@typescript-eslint/no-floating-promises'];
      expect(Array.isArray(level) ? level[0] : level).toBe(2);
    });
  });

  /** 벤더 번들을 같이 보면 지적이 700건 넘게 쏟아져 진짜 지적이 묻힌다 */
  it('pdfjs 워커 번들은 검사 대상이 아니다', async () => {
    expect(await eslint.isPathIgnored(resolve(ROOT, 'apps/web/public/pdf.worker.mjs'))).toBe(true);
  });

  /** 설정 파일 밖(빌드 산출물)까지 훑으면 느려지고 지적도 의미가 없다 */
  it('빌드 산출물은 검사 대상이 아니다', async () => {
    expect(await eslint.isPathIgnored(resolve(ROOT, 'apps/web/dist/index.js'))).toBe(true);
    expect(await eslint.isPathIgnored(resolve(ROOT, 'apps/api/dist/main.js'))).toBe(true);
  });
});
