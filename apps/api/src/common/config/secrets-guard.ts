/**
 * 개발용 기본 시크릿이 운영에 그대로 올라가는 것을 기동 시점에 차단한다.
 *
 * `docker-compose.yml`은 로컬에서 바로 뜨도록 기본값을 갖고 있고, 그 값들은 리포에
 * 그대로 적혀 있어 공개된 것과 같다. 운영에서 이 값이 쓰이면 JWT 위조·DB 접근이
 * 가능하므로, `NODE_ENV=production`에서는 기본값을 발견하는 즉시 기동을 실패시킨다.
 * (경고 로그만 남기면 아무도 안 본다.)
 */

/** 리포에 공개돼 있는 기본값들 — 운영에서 발견되면 곧바로 사고다 */
const KNOWN_DEFAULTS: { env: string; bad: string[]; label: string }[] = [
  {
    env: 'JWT_SECRET',
    bad: ['your-super-secret-jwt-key-change-in-production'],
    label: 'JWT 서명 키',
  },
  {
    env: 'JWT_REFRESH_SECRET',
    bad: ['your-super-secret-refresh-key-change-in-production'],
    label: 'JWT 갱신 키',
  },
  {
    env: 'MINIO_SECRET_KEY',
    bad: ['minioadmin123'],
    label: 'MinIO 시크릿 키',
  },
];

/** JWT 키는 길이도 본다. 짧은 키는 무차별 대입에 약하다. */
const MIN_JWT_SECRET_LENGTH = 32;

export type SecretsGuardResult = { errors: string[]; warnings: string[] };

export function inspectSecrets(env: NodeJS.ProcessEnv = process.env): SecretsGuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of KNOWN_DEFAULTS) {
    const value = String(env[rule.env] ?? '');
    if (!value) {
      errors.push(`${rule.env}(${rule.label})가 비어 있습니다.`);
      continue;
    }
    if (rule.bad.includes(value)) {
      errors.push(`${rule.env}(${rule.label})가 리포에 공개된 기본값 그대로입니다.`);
    }
  }

  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = String(env[key] ?? '');
    if (value && value.length < MIN_JWT_SECRET_LENGTH) {
      errors.push(`${key}가 너무 짧습니다(${value.length}자, 최소 ${MIN_JWT_SECRET_LENGTH}자).`);
    }
  }

  if (String(env.JWT_SECRET ?? '') === String(env.JWT_REFRESH_SECRET ?? '') && env.JWT_SECRET) {
    errors.push('JWT_SECRET과 JWT_REFRESH_SECRET이 같습니다. 서로 다른 값을 쓰세요.');
  }

  const dbUrl = String(env.DATABASE_URL ?? '');
  if (/:\/\/postgres:postgres@/.test(dbUrl)) {
    errors.push('DATABASE_URL이 기본 계정(postgres:postgres)을 쓰고 있습니다.');
  }

  const publicUrl = String(env.PUBLIC_URL ?? '');
  if (publicUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(publicUrl)) {
    warnings.push(`PUBLIC_URL이 평문 http입니다(${publicUrl}). 운영에서는 https를 쓰세요.`);
  }

  return { errors, warnings };
}

/**
 * 기동 시 호출. 운영에서 기본 시크릿이 남아 있으면 예외를 던져 부팅을 중단한다.
 * 운영이 아니면 경고만 남기고 진행한다(로컬 개발 경험을 해치지 않기 위해).
 */
export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const isProduction = env.NODE_ENV === 'production';
  const { errors, warnings } = inspectSecrets(env);

  for (const warning of warnings) {
    console.warn(`[secrets] 경고: ${warning}`);
  }

  if (errors.length === 0) return;

  // 브레이크글래스: 장애 중 기동만 되살려야 할 때. 막아두면 가드를 주석 처리하는 쪽으로 흐른다.
  if (isProduction && (env.ALLOW_DEFAULT_SECRETS === '1' || env.ALLOW_DEFAULT_SECRETS === 'true')) {
    console.error(
      `[secrets] ALLOW_DEFAULT_SECRETS로 기본 시크릿 검사를 건너뜁니다 (${errors.length}건). ` +
        '이 기동은 사고 대응 대상입니다:\n' +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
    return;
  }

  if (!isProduction) {
    console.warn(
      `[secrets] 개발 기본값 사용 중 (${errors.length}건). 운영 배포 전 반드시 교체하세요:\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
    return;
  }

  throw new Error(
    '운영 기동 중단: 개발용 기본 시크릿이 감지되었습니다.\n' +
      errors.map((e) => `  - ${e}`).join('\n') +
      '\n교체 절차는 docs/Deliverables/16_Runbook_배포롤백/Runbook_배포롤백.md 의 "시크릿 교체" 절을 보세요.\n' +
      '기동만 급히 되살려야 한다면 ALLOW_DEFAULT_SECRETS=1 로 우회할 수 있으나, 그 즉시 사고 대응 대상입니다.',
  );
}
