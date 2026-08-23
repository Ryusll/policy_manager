/**
 * 일괄 가져오기 사전 검사 (T-13).
 *
 * 지금까지 이 API 는 화면 없이 있었고, 문제를 만나면 **첫 번째에서 트랜잭션째 멈췄다**.
 * 규정 20건을 넣다가 17번째 코드가 겹치면 아무것도 안 들어가고 오류 한 줄만 돌아온다.
 * 무엇을 고쳐야 하는지 알려면 고치고 다시 올리기를 반복해야 한다.
 *
 * 그래서 넣기 전에 **전부 훑어 문제를 모아** 돌려준다. 저장은 여전히 한 트랜잭션이다 —
 * 절반만 들어간 규정집은 아무것도 안 들어간 것보다 나쁘다.
 */

export type ImportIssueLevel = 'error' | 'warning';

export type ImportIssue = {
  level: ImportIssueLevel;
  /** 몇 번째 규정인지(0부터). 전체에 걸린 문제는 null */
  policyIndex: number | null;
  code: string | null;
  message: string;
};

export type ImportPolicyShape = {
  code?: string;
  title?: string;
  chapters?: { number?: number; title?: string; articles?: { number?: number; title?: string; content?: string }[] }[];
};

export type ValidateInput = {
  policies: ImportPolicyShape[];
  /** 이미 이 테넌트에 있는 규정 코드 */
  existingCodes: string[];
  /** 현재 규정 수 */
  currentCount: number;
  /** 플랜 상한 */
  maxPolicies: number;
};

export type ValidateResult = {
  issues: ImportIssue[];
  /** error 가 하나도 없어야 넣을 수 있다 */
  canImport: boolean;
  summary: { policies: number; chapters: number; articles: number };
};

const MAX_CODE = 80;
const MAX_TITLE = 500;

export function validateImport(input: ValidateInput): ValidateResult {
  const issues: ImportIssue[] = [];
  const policies = input.policies ?? [];
  const existing = new Set(input.existingCodes.map((c) => c.trim()));
  const seen = new Map<string, number>();

  let chapters = 0;
  let articles = 0;

  if (policies.length === 0) {
    issues.push({ level: 'error', policyIndex: null, code: null, message: '가져올 규정이 없습니다.' });
  }

  policies.forEach((p, idx) => {
    const code = String(p.code ?? '').trim();
    const title = String(p.title ?? '').trim();

    if (!code) {
      issues.push({ level: 'error', policyIndex: idx, code: null, message: '규정 코드가 비어 있습니다.' });
    } else if (code.length > MAX_CODE) {
      issues.push({ level: 'error', policyIndex: idx, code, message: `규정 코드가 ${MAX_CODE}자를 넘습니다.` });
    } else if (existing.has(code)) {
      issues.push({ level: 'error', policyIndex: idx, code, message: '이미 있는 규정 코드입니다.' });
    }

    if (code) {
      const first = seen.get(code);
      if (first !== undefined) {
        issues.push({
          level: 'error',
          policyIndex: idx,
          code,
          message: `파일 안에서 코드가 겹칩니다(${first + 1}번째와 중복).`,
        });
      } else {
        seen.set(code, idx);
      }
    }

    if (!title) {
      issues.push({ level: 'error', policyIndex: idx, code: code || null, message: '규정 제목이 비어 있습니다.' });
    } else if (title.length > MAX_TITLE) {
      issues.push({ level: 'error', policyIndex: idx, code, message: `규정 제목이 ${MAX_TITLE}자를 넘습니다.` });
    }

    const chs = p.chapters ?? [];
    if (chs.length === 0) {
      // 막지는 않는다 — 껍데기만 만들고 나중에 채우는 쓰임이 있다
      issues.push({
        level: 'warning',
        policyIndex: idx,
        code: code || null,
        message: '장이 없습니다. 규정만 만들어집니다.',
      });
    }

    chapters += chs.length;
    const joNumbers: number[] = [];

    chs.forEach((ch, chIdx) => {
      if (!Number.isInteger(ch.number) || (ch.number as number) < 1) {
        issues.push({
          level: 'error',
          policyIndex: idx,
          code: code || null,
          message: `${chIdx + 1}번째 장의 번호가 1 이상의 정수가 아닙니다.`,
        });
      }
      if (!String(ch.title ?? '').trim()) {
        issues.push({
          level: 'error',
          policyIndex: idx,
          code: code || null,
          message: `${chIdx + 1}번째 장의 제목이 비어 있습니다.`,
        });
      }
      const ars = ch.articles ?? [];
      articles += ars.length;
      ars.forEach((ar, arIdx) => {
        if (!Number.isInteger(ar.number) || (ar.number as number) < 1) {
          issues.push({
            level: 'error',
            policyIndex: idx,
            code: code || null,
            message: `${chIdx + 1}장 ${arIdx + 1}번째 조의 번호가 1 이상의 정수가 아닙니다.`,
          });
        } else {
          joNumbers.push(ar.number as number);
        }
        if (!String(ar.content ?? '').trim()) {
          issues.push({
            level: 'warning',
            policyIndex: idx,
            code: code || null,
            message: `제${ar.number}조의 본문이 비어 있습니다.`,
          });
        }
      });
    });

    // 조 번호는 장을 가로질러 이어진다(제1장 제1·2조 → 제2장 제3조).
    // 겹치거나 건너뛰면 목차에서 조문을 특정할 수 없다 — 막지는 않고 알린다.
    const dup = joNumbers.filter((n, i) => joNumbers.indexOf(n) !== i);
    if (dup.length) {
      issues.push({
        level: 'warning',
        policyIndex: idx,
        code: code || null,
        message: `조 번호가 겹칩니다: ${[...new Set(dup)].sort((a, b) => a - b).join(', ')}`,
      });
    }
    const sorted = [...new Set(joNumbers)].sort((a, b) => a - b);
    const gaps = sorted.filter((n, i) => i > 0 && n !== sorted[i - 1] + 1);
    if (gaps.length) {
      issues.push({
        level: 'warning',
        policyIndex: idx,
        code: code || null,
        message: `조 번호가 이어지지 않습니다(${gaps.join(', ')} 앞에서 끊김).`,
      });
    }
  });

  /**
   * 플랜 상한. 규정을 하나씩 만들 때는 막히는데 **일괄 가져오기는 통과했다** —
   * Starter(5건) 테넌트가 한 번에 100건을 넣을 수 있었다.
   */
  const newCount = input.currentCount + policies.length;
  if (newCount > input.maxPolicies) {
    issues.push({
      level: 'error',
      policyIndex: null,
      code: null,
      message: `현재 요금제의 규정 상한(${input.maxPolicies}건)을 넘습니다. 지금 ${input.currentCount}건 + 가져올 ${policies.length}건.`,
    });
  }

  return {
    issues,
    canImport: !issues.some((i) => i.level === 'error'),
    summary: { policies: policies.length, chapters, articles },
  };
}
