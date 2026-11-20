#!/usr/bin/env node
// 영업 시연 데이터 채우기(T-216) — 시연 전용 고객사에 시연 규정을 넣고, 그 서버가 감지한 실제 법령 개정에 연결을 확정해
// 개정 검토 대기 후보를 만든다. 고객사 관리자 계정으로 공개 API 만 부른다(DB 직접 쓰기 없음 — ADR-0029).
// 절차는 Runbook_배포롤백 7-11 '시연 준비'. 먼저 --plan 으로 보고 실행한다. 주소·계정은 명령줄에 적지 않는다(셸 기록에 남는다) —
// `read -r VEDA_DEMO_URL` 처럼 받아 export 한 뒤:
//
//   node scripts/demo/seed-demo.mjs --plan
//
// 종료 코드: 0 끝남, 1 실패(서버 거절·연결 실패·예상하지 못한 오류), 2 인자·환경변수, 3 사람이 먼저 할 일(비밀번호 변경·로그인·권한),
// 4 실행을 막는 것(이 스크립트 것으로 확인할 수 없는 같은 코드 규정·자리 부족·법제처 미설정)
import { pathToFileURL } from 'node:url';
import { USAGE, parseArgs, promptHidden, readConfig } from './lib/config.mjs';
import { ApiError, StopError, createClient } from './lib/api.mjs';
import { DEFAULT_DATA_DIR, loadDemoPolicies } from './lib/demo-policies.mjs';
import { kstToday } from './lib/law-match.mjs';
import { survey } from './lib/survey.mjs';
import { buildPlan } from './lib/plan.mjs';
import { formatPlan, planBlockers } from './lib/plan-text.mjs';
import { execute } from './lib/run.mjs';
import { formatResult } from './lib/run-text.mjs';

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ out: (s: string) => void, err: (s: string) => void }} io
 * @param {{ fetchImpl?: typeof fetch, paceMs?: number, sleepImpl?: (ms: number) => Promise<void>, prompt?: (q: string) => Promise<string | null>, dataDir?: string, today?: string }} deps
 *   시험이 바꿔 끼우는 것 — 시연 규정 폴더(dataDir)는 시험용 규정을 넣을 때만 바꾼다(명령 인자로는 열지 않는다)
 * @returns {Promise<number>} 종료 코드
 */
export async function main(argv, env, io, deps = {}) {
  const parsed = parseArgs(argv);
  if ('error' in parsed || parsed.opts.help) {
    if ('error' in parsed) io.err(parsed.error);
    io.out(USAGE);
    return 'error' in parsed ? 2 : 0;
  }
  const { opts } = parsed;
  const cfg = readConfig(env);
  if ('error' in cfg) {
    io.err(cfg.error);
    io.out(USAGE);
    return 2;
  }
  const config = cfg.config;
  if (!config.password) config.password = (await (deps.prompt ?? promptHidden)('관리자 비밀번호: ')) ?? '';
  if (!config.password) {
    io.err('비밀번호가 없습니다 — VEDA_DEMO_PASSWORD 를 주거나 터미널에서 입력하세요.');
    return 2;
  }

  let demo;
  try {
    demo = loadDemoPolicies(deps.dataDir ?? DEFAULT_DATA_DIR);
  } catch (err) {
    io.err(err.message);
    return 2;
  }

  const api = createClient({ base: config.base, fetchImpl: deps.fetchImpl, paceMs: deps.paceMs, sleepImpl: deps.sleepImpl, log: io.out });
  // 실행이 어디까지 갔는지 — 실패했을 때 다시 실행 안내를 가른다(--reset 이 다 지우기 전이면 --reset 으로 다시)
  const progress = { started: false, toDelete: 0, deleted: 0 };
  try {
    const user = await api.login({ tenant: config.tenant, email: config.email, password: config.password });
    config.password = '';
    if (user.mustChangePassword) {
      throw new StopError('PASSWORD_CHANGE_REQUIRED', '이 계정은 비밀번호를 먼저 바꿔야 합니다. 화면에서 한 번 로그인해 임시 비밀번호를 바꾼 뒤 다시 실행하세요.');
    }
    if (user.role !== 'admin') {
      throw new StopError('NOT_ADMIN', '고객사 관리자 계정으로 실행하세요 — 편집자는 시행일 있는 발행본을 만들 수 없어 개정 후보가 생기지 않습니다.');
    }
    const s = await survey(api, demo);
    const plan = buildPlan(demo, s, { today: deps.today ?? kstToday(), reset: opts.reset });
    io.out(formatPlan(plan, { tenantName: user.tenantName }));
    const blockers = planBlockers(plan);
    if (opts.plan) {
      for (const b of blockers) io.err(`! ${b}`);
      io.out(blockers.length ? '\n위 문제를 먼저 풀어야 실행할 수 있습니다.' : '\n--plan 이라 아무것도 쓰지 않았습니다.');
      return blockers.length ? 4 : 0;
    }
    if (blockers.length) {
      for (const b of blockers) io.err(`! ${b}`);
      return 4;
    }
    io.out('\n실행합니다.');
    progress.started = true;
    progress.toDelete = plan.toDelete.length;
    const result = await execute(api, demo, s, plan, { log: io.out, progress });
    io.out(`\n${formatResult(result)}`);
    return 0;
  } catch (err) {
    if (err instanceof StopError) {
      io.err(err.message);
      return 3;
    }
    const f = failureText(err);
    io.err(`실패: ${f.text}`);
    const hint = rerunHint(f.kind, opts, progress);
    if (hint) io.err(hint);
    return 1;
  }
}

const scrubUrls = (s) => String(s).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, '<주소>');

/** 연결 실패 — 요청을 보내지 못했거나('fetch failed') 본문을 받다 끊겼다('terminated', undici 소켓 오류 UND_ERR_*) */
const isNetworkError = (err) =>
  err instanceof TypeError && (err.message === 'fetch failed' || err.message === 'terminated' || String(err.cause?.code ?? '').startsWith('UND_ERR'));

/**
 * 실패 글 — 서버 거절은 경로(id 는 가린다)·상태·서버 문구, 주소가 VEDA API 가 아니면(성공인데 JSON 아님) 설정 문제로, 연결 실패는
 * 까닭 코드(DNS 오류 글에는 호스트가 있어 코드만), 넘겨주기(3xx)는 따로, 그 밖의 오류(응답 꼴이 다름·코드 결함)는 오류 이름과 글을
 * 그대로(주소는 가린다) — 원인을 감추지 않는다.
 * @returns {{ kind: 'api' | 'config' | 'network' | 'unexpected', text: string }}
 */
export function failureText(err) {
  if (err instanceof ApiError) return { kind: err.config ? 'config' : 'api', text: err.message };
  if (isNetworkError(err)) {
    const cause = err.cause;
    if (/redirect/i.test(String(cause?.message ?? ''))) {
      // 넘겨주기는 주소 문제다 — 다시 돌려도 같다(4차)
      return { kind: 'config', text: '서버가 다른 주소로 넘기려 해(3xx) 멈췄습니다 — VEDA_DEMO_URL 이 https 로 VEDA 를 직접 가리키는지 확인하세요.' };
    }
    const why = cause?.code ?? (cause?.message ? scrubUrls(cause.message).slice(0, 80) : '연결 실패');
    return { kind: 'network', text: `서버에 닿지 못했습니다(${why}) — 서버 주소와 네트워크를 확인하세요.` };
  }
  return { kind: 'unexpected', text: `${err?.name ?? 'Error'}: ${scrubUrls(err?.message ?? err)}`.slice(0, 300) };
}

/**
 * 실패 뒤 할 일 — --plan 은 쓴 것이 없고, 예상하지 못한 오류는 다시 돌려도 같은 곳에서 멈출 수 있어 알리라고 하고, 주소 설정 문제는
 * 고친 뒤 다시. --reset 은 다 지운 뒤에 멈췄으면 --reset 없이(이어서 넣는다), 지우기 전·지우는 중이면 --reset 으로 다시(남은 옛 시연
 * 규정을 지운다).
 */
export function rerunHint(kind, opts, progress = { started: false, toDelete: 0, deleted: 0 }) {
  if (opts.plan) return null;
  if (kind === 'unexpected') return '예상하지 못한 오류입니다 — 다시 실행하기 전에 이 출력을 개발팀에 알리세요.';
  if (kind === 'config') return '주소(VEDA_DEMO_URL)가 VEDA 를 가리키는지 고친 뒤 다시 실행하세요.';
  if (opts.reset) {
    if (!progress.started || progress.deleted < progress.toDelete) {
      return '--reset 을 붙여 같은 명령을 다시 실행하면 남은 시연 규정을 지우고 처음부터 넣습니다.';
    }
    return '--reset 없이 같은 명령을 다시 실행하면 이미 넣은 규정·연결·후보는 건너뛰고 이어서 채웁니다(--reset 을 붙이면 넣은 시연 규정을 다시 지우고 처음부터 넣는다).';
  }
  return '같은 명령을 다시 실행하면 이미 넣은 규정·연결·후보는 건너뛰고 이어서 채웁니다.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) };
  process.exitCode = await main(process.argv.slice(2), process.env, io);
}
