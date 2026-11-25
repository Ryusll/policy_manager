// 시연 데이터 채우기(T-216) — 실행 결과(execute 가 돌려준 건수)를 글로 보인다. 법령명과 건수·시연 규정 코드만 싣는다(회사 id·연결 id·
// 계정은 싣지 않는다). 마지막 안내는 계획과 같은 규칙(rules.emptyReason·emptyText)이다.
import { emptyReason, emptyText, orphanFix } from './rules.mjs';

/** 실행 결과 글 — 법령명과 건수만(회사 id·연결 id·계정은 싣지 않는다) */
export function formatResult(r) {
  const out = [];
  if (r.deleted) out.push(`지운 시연 규정: ${r.deleted}개`);
  out.push(`넣은 시연 규정: ${r.imported}개${r.datesFilled ? ` (앞 실행이 비워 둔 개정일·시행일 ${r.datesFilled}개 채움)` : ''}`);
  if (r.lawsRegistered.length) {
    out.push(`등록한 법령: ${r.lawsRegistered.map((l) => `${l.name}${l.ok ? '' : '(등록 뒤 목록에서 찾지 못함)'}`).join(', ')}`);
    // 목록에서 찾아 이은 법령만 동기화 뒤에 후보가 생긴다 — 못 찾은 법령은 아래 줄로 따로 알린다(5차 #7)
    if (r.lawsRegistered.some((l) => l.ok)) out.push('  ↳ 다음 동기화 뒤에 다시 실행하면 그 법령의 시행 전 개정으로도 후보가 생긴다.');
  }
  out.push(`법령 연결: 새로 ${r.links.created}건, 이미 있음 ${r.links.existing}건${r.links.confirmed ? `, 추천을 확정 ${r.links.confirmed}건` : ''}`);
  for (const s of r.links.skipped) out.push(`  ! 잇지 않음: ${s}`);
  // 만들지 않은 수는 계획처럼 후보(조문) 수로 적는다(8차 #3) — 변경은 아래 '!' 줄에 하나씩
  const c = r.candidates;
  const notMade = [
    c.blockedRows && `다른 규정에도 닿아 만들지 않은 후보 ${c.blockedRows}건`,
    c.orphanRows && `예전 시연 규정에 닿아 만들지 않은 후보 ${c.orphanRows}건`,
    c.partialRows && `일부 조문에만 후보가 있어 만들지 않은 후보 ${c.partialRows}건`,
  ].filter(Boolean).map((s) => `, ${s}`).join('');
  const linked = c.linked ? `(연결하면서 생김 ${c.linked} · 만들기 ${c.created})` : '';
  out.push(`개정 후보: 닿는 변경 ${c.events}건에서 새로 ${c.created + c.linked}건${linked}, 이미 있음 ${c.existing}건, 건너뜀 ${c.skipped}건(실질 변경 없는 변경 ${c.noChange}건)${notMade}`);
  for (const b of c.blocked) out.push(`  ! 다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음: ${b}`);
  if (c.blocked.length) {
    out.push('  ↳ 그 규정에도 후보가 생기므로 부르지 않았습니다. --reset 으로는 풀리지 않습니다(그 규정의 연결은 남는다) — 시연 전용 고객사에서 실행하세요.');
  }
  for (const b of c.orphanOnly) out.push(`  ! 예전 시연 규정에 닿아 '개정 후보 만들기'를 하지 않음: ${b}`);
  if (c.orphanOnly.length) out.push(`  ↳ ${orphanFix(c.orphanReset)}`);
  for (const b of c.partial) out.push(`  ! 일부 시연 조문에만 후보가 있어 '개정 후보 만들기'를 하지 않음(다시 채우려면 --reset): ${b}`);
  out.push(`검토 요청: ${r.reviewRequested ? '1건 보냄' : '보내지 않음(이미 검토 중인 후보가 있거나 후보가 없다)'}`);
  const byLaw = Object.entries(r.pendingByLaw).map(([law, n]) => `${law} ${n}`).join(', ');
  out.push(`처리 대기 후보(작성·검토 중): ${r.pending}건 — 검토 중 ${r.inReview}건${byLaw ? ` · ${byLaw}` : ''}`);
  const w = r.lawsWithoutCandidates;
  if (w.registeredNow.length) out.push(`  ↳ 새로 등록해 아직 변경이 없는 법령(다음 동기화 뒤 다시 실행): ${w.registeredNow.join(', ')}`);
  if (w.lostAfterRegister.length) out.push(`  ! 등록했지만 목록에서 이름으로 찾지 못해 잇지 못한 법령(개발팀에 알리세요): ${w.lostAfterRegister.join(', ')}`);
  if (w.reachedNone.length) out.push(`  ↳ 닿는 변경은 있지만 후보가 생기지 않은 법령(실질 변경 없음·시행 본문 없음·다른 규정에도 닿음·예전 시연 규정에 닿음·잇지 않은 인용): ${w.reachedNone.join(', ')}`);
  if (w.noEvents.length) out.push(`  ↳ 시연 조문에 닿는 변경이 없는 인용 법령: ${w.noEvents.join(', ')}`);
  if (w.notRegistered.length) out.push(`  ↳ 등록되지 않은 인용 법령(법제처에서 현행 판을 찾지 못함): ${w.notRegistered.join(', ')}`);
  // 마지막 안내는 계획과 같은 규칙이다(rules.emptyReason) — 모두 처리했을 뿐이면 --reset, 까닭이 위 줄에 있으면 그 줄, 새로 등록한
  // 법령만 기다리면 동기화 뒤 다시, 닿는 변경이 하나도 없으면 PM
  if (!r.pending) {
    const reason = emptyReason({ processed: r.candidatesTotal > 0, groups: w });
    out.push(emptyText(reason, { processedCount: r.candidatesTotal, waitSync: w.registeredNow.length > 0, noEvents: w.noEvents.length > 0 }));
  }
  return out.join('\n');
}
