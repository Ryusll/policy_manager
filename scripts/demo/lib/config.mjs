// 시연 데이터 채우기(T-216) — 실행 인자와 환경변수. 서버 주소·계정은 기본값을 두지 않고, 값은 출력하지 않는다.

export const ENV = {
  url: 'VEDA_DEMO_URL',
  tenant: 'VEDA_DEMO_TENANT',
  email: 'VEDA_DEMO_EMAIL',
  password: 'VEDA_DEMO_PASSWORD',
};

export const USAGE = `사용법: node scripts/demo/seed-demo.mjs [--plan] [--reset]
  --plan   무엇을 할지 보이기만 하고 쓰지 않는다(먼저 이것부터)
  --reset  이 스크립트가 넣은 시연 규정을 지우고 다시 넣는다(시연에서 후보를 처리한 뒤 다시 채우기)
환경변수(기본값 없음, 값은 출력하지 않는다):
  ${ENV.url}       서버 주소(https://<도메인> — 뒤에 /api 를 붙인다. 이 컴퓨터 안의 서버만 http)
  ${ENV.tenant}    고객사 구분자(로그인 화면의 회사 칸)
  ${ENV.email}     고객사 관리자 이메일
  ${ENV.password}  비밀번호 — 비우면 터미널에서 숨김 입력`;

/** @returns {{ opts: { plan: boolean, reset: boolean, help: boolean } } | { error: string }} */
export function parseArgs(argv) {
  const opts = { plan: false, reset: false, help: false };
  for (const a of argv) {
    if (a === '--plan') opts.plan = true;
    else if (a === '--reset') opts.reset = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else return { error: `알 수 없는 인자: ${a}` };
  }
  return { opts };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 서버 주소 → API 기준 주소(…/api). 비밀번호를 싣고 가므로 https 만 받는다(이 컴퓨터 안의 서버는 http 도) */
export function apiBase(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { error: `${ENV.url} 이 주소 꼴이 아닙니다.` };
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) {
    return { error: `${ENV.url} 은 https 주소여야 합니다(이 컴퓨터 안의 서버만 http).` };
  }
  // 주소에 계정을 넣으면(https://이름:비밀번호@…) 오류 글에 주소째 찍힐 수 있다 — 받지 않는다
  if (u.username || u.password) return { error: `${ENV.url} 에 계정 정보를 넣지 마세요 — 계정은 ${ENV.email}·${ENV.password} 로 넘깁니다.` };
  u.search = '';
  u.hash = '';
  const path = u.pathname.replace(/\/+$/, '');
  u.pathname = path.endsWith('/api') ? path : `${path}/api`;
  return { base: u.toString().replace(/\/+$/, '') };
}

/** @returns {{ config: { base, tenant, email, password } } | { error: string }} — password 는 비어 있을 수 있다(숨김 입력) */
export function readConfig(env) {
  const val = (k) => String(env[ENV[k]] ?? '').trim();
  const missing = ['url', 'tenant', 'email'].filter((k) => !val(k)).map((k) => ENV[k]);
  if (missing.length) return { error: `환경변수가 없습니다: ${missing.join(', ')}` };
  const base = apiBase(val('url'));
  if (base.error) return { error: base.error };
  return { config: { base: base.base, tenant: val('tenant'), email: val('email'), password: String(env[ENV.password] ?? '') } };
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const EOT = String.fromCharCode(4);
const ETX = String.fromCharCode(3);
const DEL = String.fromCharCode(127);
const BS = String.fromCharCode(8);

/** 비밀번호 숨김 입력 — 터미널이 아니면 null(그때는 환경변수로만 받는다) */
export function promptHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return Promise.resolve(null);
  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  let value = '';
  return new Promise((resolve) => {
    const finish = (result) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write(LF);
      resolve(result);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === CR || ch === LF || ch === EOT) return finish(value);
        if (ch === ETX) return finish(null);
        if (ch === DEL || ch === BS) value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}
