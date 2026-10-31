#!/usr/bin/env node
/**
 * 로컬 `.env`에 없는 시크릿만 임의 값으로 채운다.
 *
 * compose는 `NODE_ENV=production`으로 API를 띄우고, API는 기본 시크릿을 발견하면
 * 기동을 거부한다(`secrets-guard.ts`). 그래서 로컬에서도 실제 값이 필요한데,
 * 매번 openssl을 네 번 돌리게 하면 결국 기본값을 쓰게 된다. 이 스크립트가 그 간극을 메운다.
 *
 * - 이미 있는 키는 건드리지 않는다(운영 값 덮어쓰기 방지)
 * - 생성한 값은 화면에 찍지 않는다(터미널 로그·화면 공유로 새는 것을 막기 위해)
 *
 * 사용: npm run secrets:init
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

/** 키 → 바이트 수 (base64라 실제 길이는 약 1.37배) */
const SECRETS = {
  JWT_SECRET: 48,
  JWT_REFRESH_SECRET: 48,
  POSTGRES_PASSWORD: 24,
  MINIO_SECRET_KEY: 24,
};

/** 시크릿은 아니지만 위 값과 짝이 맞아야 하는 항목 */
const COMPANIONS = {
  POSTGRES_USER: 'policy_app',
  POSTGRES_DB: 'policy_manager',
  MINIO_ACCESS_KEY: 'policy_minio',
};

function hasKey(text, key) {
  return new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(text);
}

const existing = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
if (!existing && existsSync(resolve(root, '.env.example'))) {
  copyFileSync(resolve(root, '.env.example'), envPath);
  console.log('.env 가 없어 .env.example 을 복사했습니다.');
}

let text = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
const added = [];
const kept = [];

const lines = [];
for (const [key, fallback] of Object.entries(COMPANIONS)) {
  if (hasKey(text, key)) kept.push(key);
  else {
    lines.push(`${key}=${fallback}`);
    added.push(key);
  }
}
for (const [key, bytes] of Object.entries(SECRETS)) {
  if (hasKey(text, key)) kept.push(key);
  else {
    // base64에서 URL·셸에서 성가신 문자를 걸러낸다(compose 치환·psql 접속 문자열에 그대로 들어간다)
    const value = randomBytes(bytes).toString('base64').replace(/[+/=]/g, '').slice(0, bytes * 1.3);
    lines.push(`${key}=${value}`);
    added.push(key);
  }
}

if (lines.length === 0) {
  console.log(`이미 모든 시크릿이 채워져 있습니다 (${kept.length}건). 변경하지 않았습니다.`);
  process.exit(0);
}

if (text && !text.endsWith('\n')) text += '\n';
text += `\n# --- npm run secrets:init 이 생성 (${new Date().toISOString().slice(0, 10)}) ---\n`;
text += lines.join('\n') + '\n';
writeFileSync(envPath, text, 'utf-8');

console.log(`.env 에 ${added.length}건을 추가했습니다: ${added.join(', ')}`);
if (kept.length) console.log(`기존 값 유지 (${kept.length}건): ${kept.join(', ')}`);
console.log('값은 화면에 표시하지 않습니다. .env 는 .gitignore 대상입니다.');
console.log('\n주의: DB·MinIO 시크릿은 첫 기동 때 볼륨에 굳습니다.');
console.log('이미 띄운 적 있는 환경이면 `docker compose down -v` 로 볼륨을 비우고 다시 올리세요(로컬 한정).');
