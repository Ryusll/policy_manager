// 공개 저장소에 들어가면 안 되는 것 찾기: 공인 IP(운영 서버 주소), 비밀키·API 키 형태.
// git-guard(커밋 전후)와 CLAUDE.md 검사가 함께 쓴다. 예시용 주소(TEST-NET)와 사설·예약 대역은 뺀다.

// 앞뒤에 숫자 마디가 더 붙은 것(1.2.3.4.5 같은 버전 번호)은 주소로 보지 않는다
const IPV4 = /(?<!\d|\d\.)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/g;
const DASHED_HOST = /\b\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\.(sslip|nip)\.io\b/i;

const KEY_PATTERNS = [
  ['비밀키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Anthropic API 키', /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ['AWS 접근 키', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub 토큰', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API 키', /\bAIza[0-9A-Za-z_-]{35}\b/],
];

function isPublicIp(a, b, c) {
  if ([a, b, c].some((n) => n > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a === 198 && (b === 18 || b === 19)) return false; // 벤치마크용
  return true;
}

// 한 줄에서 찾은 것의 종류 목록. 값 자체는 돌려주지 않는다(대화·로그에 다시 새지 않게).
export function leakKinds(line) {
  const kinds = [];
  for (const m of String(line).matchAll(IPV4)) {
    const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(Number);
    if (d <= 255 && isPublicIp(a, b, c)) {
      kinds.push('공인 IP 주소');
      break;
    }
  }
  if (DASHED_HOST.test(line)) kinds.push('IP가 들어간 호스트 이름');
  for (const [name, re] of KEY_PATTERNS) if (re.test(line)) kinds.push(name);
  return kinds;
}

// unified diff의 더한 줄(+)에서 찾는다. 결과: [{ file, line(diff 안의 순번), kinds }]
export function scanDiff(diff) {
  const found = [];
  let file = null;
  let n = 0;
  for (const raw of String(diff || '').split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '');
      n = 0;
      continue;
    }
    if (!raw.startsWith('+')) continue;
    n += 1;
    const kinds = leakKinds(raw.slice(1));
    if (kinds.length) found.push({ file, line: n, kinds });
  }
  return found;
}

export const describeLeaks = (found) =>
  found.slice(0, 8).map((f) => `- ${f.file ?? '(파일)'}: ${f.kinds.join(', ')}`).join('\n');
