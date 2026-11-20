// 시연 데이터 채우기(T-216) — 계획(--plan)과 실행이 함께 쓰는 규칙: '개정 후보 만들기'를 부를지, 후보가 없는 인용 법령의 까닭,
// 처리 대기 후보가 없을 때의 마지막 안내. 둘이 따로 세다가 같은 상태를 달리 알렸다(계획은 '변경 없음 — PM', 실행은 '까닭을 보세요')
// — 5차 검토 #1. 그래서 한곳에 두고 둘 다 이것을 부른다.
import { normalizeLawName, reaches } from './law-match.mjs';

/**
 * '개정 후보 만들기'를 부를지 — 서버의 영향 판정(survey.eventReach — 만들기와 같은 판정)으로 정한다. 만들기는 조문을 좁히지 못하고
 * 그 고객사의 확정 연결 전부에 후보를 만들며, 중복은 (변경·조문·기준 판·발행 이력 지문·예정 시행일·공통 기준값 지문)으로만 가른다 —
 * 시행일이 지난 변경은 예정 시행일이 그날이고, 승인으로 판이 늘면 지문이 바뀌어 이미 후보가 있는 조문에도 새 후보가 생긴다.
 * - covered: 후보를 만들 수 있는(그날 시행 본문이 있는) 시연 조문에 모두 이 변경의 후보가 있다(상태 무관 — 다른 규정에도 닿아도 '이미 있음')
 * - none: 후보를 만들 수 있는 시연 조문이 없다(닿는 시연 조문에 그날 시행 본문이 없다)
 * - others: 이 스크립트 것이 아닌 규정에도 닿는다 — 부르지 않는다(그 규정에도 후보가 생긴다)
 * - partial: 다른 시연 조문에 이미 이 변경의 후보가 있다 — 부르지 않는다(부르면 그 조문에 다시 생길 수 있다, 채우려면 --reset)
 * - generate: 닿는 시연 조문에 이 변경의 후보가 하나도 없고 다른 규정에도 닿지 않는다 — 부른다
 * others 를 partial 보다 먼저 본다 — 둘 다면 --reset 해도 다른 규정의 연결이 남아 다시 막히므로 그 까닭을 알린다(5차 #5).
 */
export function generateAction(reach) {
  if (reach.uncovered === 0) return reach.covered > 0 ? 'covered' : 'none';
  // 예전 시연 규정(orphans)도 이 스크립트 것으로 확인하지 못한 규정이다 — 그 규정에도 후보가 생기므로 막는다(까닭은 따로 알린다)
  if (reach.others > 0 || reach.orphans > 0) return 'others';
  if (reach.covered > 0) return 'partial';
  return 'generate';
}

/** 시연 조문이 인용한 조항에 닿는 변경이 있는 법령(정규화한 이름) — 연결 상태(반려·법령에 없는 조항)와 관계없이 인용 전부로 가른다 */
export function lawsReached(cites, eventsOf) {
  const out = new Set();
  for (const cite of cites) {
    const norm = normalizeLawName(cite.law);
    if ((eventsOf(norm) ?? []).some((ev) => ev.lawArticleId && reaches(cite.nodeKey, ev.nodeKey))) out.add(norm);
  }
  return out;
}

/**
 * 후보가 하나도 없는 인용 법령을 까닭별로(상태 무관 — 모두 처리했을 뿐인 법령은 넣지 않는다). 계획은 '있거나 이번에 생길' 후보로,
 * 실행은 실행 뒤의 후보로 hasCandidate 를 정한다.
 * - registeredNow: 새로 등록한(계획: 등록할) 법령 — 현행 판이 기준이라 변경은 다음 동기화 뒤에 생긴다
 * - lostAfterRegister: 등록했지만 목록에서 이름으로 찾지 못해 잇지 못한 법령(실행만)
 * - reachedNone: 닿는 변경은 있지만 후보가 없다(반려된 연결·법령에 없는 조항·규정에서 찾지 못한 행·다른 규정에도 닿음·예전 시연 규정에 닿음·실질 변경 없음·시행 본문 없음)
 * - noEvents: 시연 조문에 닿는 변경이 없다 — 처리 대기가 끝내 0건이면 PM 에게 올린다(완료 정의 ③)
 * - notRegistered: 법제처에서 현행 판을 찾지 못해 등록하지 않았다
 */
export function lawsWithoutCandidates(lawState, { hasCandidate, reached, registeredNow, lostAfterRegister = new Set() }) {
  const without = lawState.filter((l) => !hasCandidate(l));
  const names = (pred) => without.filter(pred).map((l) => l.name);
  return {
    registeredNow: names((l) => registeredNow.has(l.norm)),
    lostAfterRegister: names((l) => lostAfterRegister.has(l.norm)),
    reachedNone: names((l) => l.registered && reached.has(l.norm)),
    noEvents: names((l) => l.registered && !reached.has(l.norm)),
    notRegistered: names((l) => !l.registered && !registeredNow.has(l.norm) && !lostAfterRegister.has(l.norm)),
  };
}

/**
 * 처리 대기 후보가 없을 때 무엇을 안내할지(5차 #1·#3). 만든 후보를 모두 처리했으면 processed(--reset). 위 줄에 까닭이 있으면
 * reasons(닿는 변경은 있지만 후보가 없음·등록 뒤 못 찾음). 새로 등록한 법령만 남았으면 sync(다음 동기화 뒤 다시 — 그래도 없으면 PM).
 * 그 밖에는 pm(인용 법령에 닿는 변경이 하나도 없다). '일부 조문에만 후보'는 후보가 있다는 뜻이라 여기에 오지 않는다. 만들기를 막은
 * 변경(다른 규정·예전 시연 규정)은 따로 받지 않는다 — 계획·실행은 인용에 닿는 변경만 보므로, 후보가 하나도 없을 때 그 법령은 늘
 * reachedNone 에 든다(9차 #5: 따로 받던 막힘 표시는 결과를 바꾸지 못했다).
 * @returns {'processed' | 'reasons' | 'sync' | 'pm'}
 */
export function emptyReason({ processed, groups }) {
  if (processed) return 'processed';
  if (groups.reachedNone.length || groups.lostAfterRegister.length) return 'reasons';
  if (groups.registeredNow.length) return 'sync';
  return 'pm';
}

const ORPHAN_LINE = "위 '예전에 이 스크립트가 넣은 것으로 보이는 규정' 줄";

/**
 * 예전 시연 규정에만 막힌 변경을 푸는 길(계획·실행이 같은 글, 9차 #4) — 마침표까지 든 문장. 일부 시연 조문에 그 변경의 후보가 있으면
 * (계획은 이번 연결로 생길 것도) 지우기만 해서는 '일부 조문에만 후보'로 다시 막히므로 지운 뒤 --reset 까지 적는다. 그 규정이 어느
 * 줄인지는 첫 문장에 붙인다 — 끝에 붙이면 '일부 조문에만' 설명을 가리키는 것처럼 읽혔다(10차 회귀 #3, 11차 #3).
 */
export const orphanFix = (needsReset) =>
  needsReset
    ? `그 규정을 화면에서 지운 뒤 --reset 으로 다시 채우면 풀립니다(${ORPHAN_LINE}). 일부 시연 조문에 그 변경의 후보가 있거나 이번 연결로 생겨, 지우기만 하면 '일부 조문에만 후보'로 다시 막힙니다.`
    : `그 규정을 화면에서 지우면 풀립니다(${ORPHAN_LINE}).`;

/** 만든 후보를 모두 처리했을 때(시연에서 승인·반려) — 변경이 없어서가 아니다. 다시 채우려면 --reset */
export const processedText = (n) => `! 처리 대기 후보가 없습니다 — 만든 후보 ${n}건을 모두 처리(승인·반려)했습니다. 다시 채우려면 --reset 으로 실행하세요.`;

/**
 * 마지막 안내 글 — 계획(future)은 '생기지 않습니다', 실행은 '없습니다'. 처리 대기가 0건이면 완료가 아니므로(완료 정의 ③) 어느 갈래든
 * 끝내 PM 에게 올리는 길을 적는다(6차 #3·#4): 까닭이 있으면 풀 수 있는 것(반려된 연결·예전 시연 규정은 화면에서, 규정에서 찾지 못한 행은
 * --reset 으로, 다른 규정에도 닿는 변경은 시연 전용 고객사에서 — 11차 #2)은 풀고 나머지는 PM 에게,
 * 새로 등록한 법령은 시행 전 판이 있을 때만 동기화 뒤에 변경이 생기므로(알 수 없다) 다시 실행하고, 닿는 변경이 없는 법령은 바로 PM 에게.
 */
export function emptyText(reason, { future = false, processedCount = 0, waitSync = false, noEvents = false } = {}) {
  if (reason === 'processed') return processedText(processedCount);
  const none = future ? '처리 대기 후보가 생기지 않습니다' : '처리 대기 후보가 없습니다';
  const syncNote = `${future ? '새로 등록할 법령은' : '새로 등록한 법령은'} 공포됐지만 시행 전인 판이 있을 때만 다음 동기화 뒤에 변경이 생깁니다`;
  if (reason === 'reasons') {
    const sync = waitSync ? ` ${syncNote} — 그 뒤 다시 실행하세요.` : '';
    return (
      `! ${none} — 위 법령 줄의 까닭을 보세요. 반려된 연결과 예전 시연 규정은 화면에서, 규정에서 찾지 못한 행은 --reset 으로, 다른 규정에도 닿는 변경은 시연 전용 고객사에서 풀립니다.${sync} ` +
      '풀 수 없는 까닭(실질 변경 없음·시행 본문 없음·법령에 없는 조항·등록 뒤 못 찾음)이면 위 법령 목록을 까닭과 함께 PM 에게 알리세요.'
    );
  }
  if (reason === 'sync') {
    return noEvents
      ? `! ${none} — 시연 조문에 닿는 변경이 없는 인용 법령(위 목록)은 PM 에게 알리세요. ${syncNote} — 그 뒤 다시 실행하세요.`
      : `! ${none} — ${syncNote}. 그 뒤 다시 실행하고, 그래도 없으면 위 법령 목록을 PM 에게 알리세요.`;
  }
  return `! ${none} — 인용한 법령에 이 서버가 감지한 변경이 없습니다. 위 법령 목록을 PM 에게 알리세요.`;
}
