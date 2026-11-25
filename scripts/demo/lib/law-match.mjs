// 시연 데이터 채우기(T-216) — 법령 이름 맞추기, 인용 표기 → 조항 키, 변경이 연결 조항에 닿는가, 확정 때 후보가 생기는 창.
// 서버 규칙을 그대로 옮긴 것이다 — 닿는 판정은 apps/api/src/laws/law-node-key.ts·law-changes/law-link-reach.ts,
// 창은 apps/api/src/amendments/amendment-catchup-rules.ts(오늘 한국 날짜 − 30일, 그날 포함, 위쪽 끝 없음). 시험이 둘을 맞대 본다.

/** 법령 이름 비교용 — 띄어쓰기와 가운뎃점(·ㆍ・•‧)을 뺀다(법제처 표기는 'ㆍ' U+318D) */
export function normalizeLawName(name) {
  return String(name ?? '').replace(/[\s·ㆍ・•‧]/g, '');
}

const CITE_RE = /^제(\d+)조(?:의(\d+))?(?:제(\d+)항)?(?:제(\d+)호)?$/;

/**
 * 인용 표기 → 법령 조항 키(서버 nodeKey 꼴 `조/항/호`). '제60조' → '60//', '제60조제5항' → '60/5/', '제61조제1항제1호' → '61/1/1',
 * '제76조의2' → '76의2//'. 꼴이 다르면 null.
 */
export function citeNodeKey(label) {
  const m = CITE_RE.exec(String(label ?? '').trim());
  if (!m) return null;
  return `${m[1]}${m[2] ? `의${m[2]}` : ''}/${m[3] ?? ''}/${m[4] ?? ''}`;
}

/**
 * 변경(eventKey)이 연결 조항(linkKey)에 닿는가 — 바뀐 조항이 연결 조항이거나 그 아래 조항이면 닿는다.
 * 조에 건 연결은 그 조의 항·호 변경까지, 항에 건 연결은 그 항과 그 아래 호, 호에 건 연결은 그 호만. 위쪽(조 머리) 변경은
 * 항·호 연결에 닿지 않는다. 끝의 '/' 까지 맞춰 제600조·제60조의2 를 제60조로 읽지 않는다.
 */
export function reaches(linkKey, eventKey) {
  const [jo, hang = '', ho = ''] = String(linkKey).split('/');
  const ev = String(eventKey);
  if (ho) return ev === linkKey;
  if (hang) return ev.startsWith(`${jo}/${hang}/`);
  return ev.startsWith(`${jo}/`);
}

const DAY_MS = 86_400_000;

/** 한국 날짜(YYYY-MM-DD) — 서버 todayDateOnly 와 같은 날 */
export function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 확정 때 후보를 만드는 창의 첫날 — 오늘 − 30일 */
export const CONFIRM_WINDOW_DAYS = 30;
export function windowStart(today) {
  return new Date(Date.parse(`${today}T00:00:00Z`) - CONFIRM_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/** 법령 시행일이 창 안인가(시행일이 없으면 창 밖) — 창 안이면 연결을 만들 때 서버가 후보를 바로 만든다 */
export function inConfirmWindow(lawEffectiveDate, today) {
  return Boolean(lawEffectiveDate) && String(lawEffectiveDate).slice(0, 10) >= windowStart(today);
}
