import { describe, it, expect } from 'vitest';
import {
  inspectSecrets,
  assertProductionSecrets,
} from '../apps/api/src/common/config/secrets-guard';

const GOOD = {
  JWT_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  MINIO_SECRET_KEY: 'strong-minio-secret-value',
  DATABASE_URL: 'postgresql://appuser:s3cure@postgres:5432/policy_manager',
} as NodeJS.ProcessEnv;

const DEFAULTS = {
  JWT_SECRET: 'your-super-secret-jwt-key-change-in-production',
  JWT_REFRESH_SECRET: 'your-super-secret-refresh-key-change-in-production',
  MINIO_SECRET_KEY: 'minioadmin123',
  DATABASE_URL: 'postgresql://postgres:postgres@postgres:5432/policy_manager',
} as NodeJS.ProcessEnv;

describe('inspectSecrets', () => {
  it('제대로 교체된 값은 통과한다', () => {
    expect(inspectSecrets(GOOD).errors).toEqual([]);
  });

  it('리포에 공개된 기본값 4종을 전부 잡는다', () => {
    const { errors } = inspectSecrets(DEFAULTS);
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).toContain('JWT_SECRET');
    expect(errors.join('\n')).toContain('MINIO_SECRET_KEY');
    expect(errors.join('\n')).toContain('DATABASE_URL');
  });

  it('짧은 JWT 키를 거른다', () => {
    const { errors } = inspectSecrets({ ...GOOD, JWT_SECRET: 'short' });
    expect(errors.join('\n')).toContain('너무 짧습니다');
  });

  it('두 JWT 키가 같으면 거른다', () => {
    const same = 'c'.repeat(48);
    const { errors } = inspectSecrets({ ...GOOD, JWT_SECRET: same, JWT_REFRESH_SECRET: same });
    expect(errors.join('\n')).toContain('같습니다');
  });

  it('비어 있는 시크릿을 거른다', () => {
    const { errors } = inspectSecrets({ ...GOOD, JWT_SECRET: '' });
    expect(errors.join('\n')).toContain('비어 있습니다');
  });

  it('운영에서 평문 http PUBLIC_URL은 경고한다 (기동은 막지 않음)', () => {
    const { errors, warnings } = inspectSecrets({ ...GOOD, PUBLIC_URL: 'http://app.example.com' });
    expect(errors).toEqual([]);
    expect(warnings.join('\n')).toContain('https');
  });
});

describe('assertProductionSecrets', () => {
  it('운영에서 기본값이면 기동을 막는다', () => {
    expect(() => assertProductionSecrets({ ...DEFAULTS, NODE_ENV: 'production' })).toThrow(
      /운영 기동 중단/,
    );
  });

  it('개발에서는 경고만 하고 통과시킨다', () => {
    expect(() => assertProductionSecrets({ ...DEFAULTS, NODE_ENV: 'development' })).not.toThrow();
  });

  it('운영이라도 교체된 값이면 통과한다', () => {
    expect(() => assertProductionSecrets({ ...GOOD, NODE_ENV: 'production' })).not.toThrow();
  });

  it('ALLOW_DEFAULT_SECRETS로 우회할 수 있다 (브레이크글래스)', () => {
    expect(() =>
      assertProductionSecrets({ ...DEFAULTS, NODE_ENV: 'production', ALLOW_DEFAULT_SECRETS: '1' }),
    ).not.toThrow();
  });
});
