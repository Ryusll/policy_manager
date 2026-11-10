// freellmapi 부팅 정책 — VEDA T-208, ADR-0028. 컨테이너 안에서 node 사용자로 돈다(freellm-run.sh).
// 서버가 뜨면 관리 API 로
//  1) 허용 제공사이면서 키를 넣은 곳(Google·Groq) 밖의 키를 모두 끈다 — 키 없이 쓰는 제공사(AI Horde 등)로 새지 않게
//  2) 같은 모델을 여러 제공사가 줄 때 그 모델 안에서만 넘어가게(unify) 한다 — 다른(약한) 모델로 바뀌지 않게
//  3) 끈 뒤 키 목록을 다시 읽어 허용 밖 제공사가 하나도 켜져 있지 않은지 확인한다 — 남아 있으면 실패(통합 키를 쓰지 않는다)
//  4) 통합 키를 공유 볼륨에 쓴다 — api 가 AI_QA_API_KEY_FILE 로 읽는다
// --recheck: 10분마다 다시 돈다(freellm-run.sh). 바뀐 것이 없으면 조용히 끝낸다. 키·비밀번호·통합 키 값은 출력하지 않는다.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROVIDERS } from './freellm-config.mjs';

const BASE = `http://127.0.0.1:${process.env.PORT || 3001}`;
const OUT = process.env.FREELLMAPI_KEY_OUT || '/veda-shared/unified-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RECHECK = process.argv.includes('--recheck');

/** 켜진 키의 제공사 목록 — 응답이 배열이든 { keys: [] } 든 */
export function enabledPlatforms(listed) {
  const rows = Array.isArray(listed) ? listed : (listed?.keys ?? []);
  return [...new Set(rows.filter((k) => k && k.enabled !== false && k.enabled !== 0).map((k) => k.platform))];
}

/** 허용 목록(FREELLMAPI_ALLOWED_PLATFORMS) 가운데 키를 넣은 제공사만 켠다 */
export function keepPlatforms(env) {
  const allowed = (env.FREELLMAPI_ALLOWED_PLATFORMS || 'google,groq')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const provided = PROVIDERS.filter(([, name]) => (env[name] || '').trim()).map(([platform]) => platform);
  return allowed.filter((p) => provided.includes(p));
}

async function waitReady() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return;
    } catch {
      // 아직 뜨는 중 — 2초 뒤 다시 본다(3분 넘으면 아래에서 실패로 알린다)
    }
    await sleep(2000);
  }
  throw new Error('freellmapi 가 3분 안에 뜨지 않음');
}

async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  await waitReady();
  const password = (process.env.FREELLMAPI_ADMIN_PASSWORD || '').trim();
  if (!password) throw new Error('FREELLMAPI_ADMIN_PASSWORD 가 비어 있음');
  const email = (process.env.FREELLMAPI_ADMIN_EMAIL || 'admin@veda.example').trim();
  const { token } = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!token) throw new Error('관리자 로그인 응답에 세션이 없음');

  const keep = keepPlatforms(process.env);
  const enabled = enabledPlatforms(await call('/api/keys', { token }));
  for (const platform of enabled.filter((p) => !keep.includes(p))) {
    await call(`/api/keys/platform/${encodeURIComponent(platform)}`, { token, method: 'PATCH', body: { enabled: false } });
    console.log(`freellm-init: ${platform} 키를 껐다(허용 제공사 밖)`);
  }
  // 정말 꺼졌는지 다시 읽어 본다 — 하나라도 남으면 통합 키를 쓰지 않는다(고지 밖으로 새지 않게)
  const still = enabledPlatforms(await call('/api/keys', { token })).filter((p) => !keep.includes(p));
  if (still.length) throw new Error(`허용 밖 제공사 키가 아직 켜져 있음: ${still.join(',')}`);
  await call('/api/settings/unify', { token, method: 'PUT', body: { enabled: true } });

  const { apiKey } = (await call('/api/settings/api-key', { token })) ?? {};
  if (!apiKey) throw new Error('통합 키를 받지 못함');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(`${OUT}.tmp`, apiKey, { mode: 0o600 });
  renameSync(`${OUT}.tmp`, OUT);
  if (!RECHECK) console.log(`freellm-init: 켠 제공사 ${keep.join(',') || '없음(키를 넣지 않음)'} · 통합 키를 공유 볼륨에 씀`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`freellm-init: 실패 — ${e.message}`);
    process.exit(1);
  });
}
