// freellmapi 선언적 설정(FREEAPI_CONFIG_JSON)을 환경변수에서 만든다 — VEDA T-208, ADR-0028.
// 허용 제공사(Google·Groq)의 키와 관리자 계정만 넣는다. 결과는 표준 출력으로 시작 스크립트에 넘기고, 값을 로그에 찍지 않는다.
// 관리자 계정은 freellmapi 에 계정이 하나도 없을 때(첫 부팅)만 만들어진다 — 비밀번호를 바꾸려면 데이터 볼륨을 새로 만든다.

export const PROVIDERS = [
  ['google', 'FREELLMAPI_GOOGLE_KEY'],
  ['groq', 'FREELLMAPI_GROQ_KEY'],
];

export function buildConfig(env) {
  const keys = PROVIDERS.map(([platform, name]) => [platform, (env[name] || '').trim()])
    .filter(([, key]) => key)
    .map(([platform, key]) => ({ platform, key, label: 'veda' }));
  const config = { keys };
  const password = (env.FREELLMAPI_ADMIN_PASSWORD || '').trim();
  if (password) config.admin = { email: (env.FREELLMAPI_ADMIN_EMAIL || 'admin@veda.example').trim(), password };
  return config;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(buildConfig(process.env)));
}
