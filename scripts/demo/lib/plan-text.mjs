// 시연 데이터 채우기(T-216) — 계획(buildPlan 결과)을 글로 보이고, 실행을 막는 것을 가른다. --plan·실행 앞에 같은 글을 보인다.
// 회사 id·계정·서버 주소는 싣지 않는다 — 법령명·건수와 규정 코드(시연 규정, 같은 코드로 겹친 규정, 예전 시연 규정의 지금 코드 —
// 화면에서 찾아 지울 수 있게)만 싣는다.
import { emptyReason, emptyText, orphanFix } from './rules.mjs';

/** 실행을 막는 것 — 있으면 쓰지 않고 멈춘다 */
export function planBlockers(plan) {
  const out = [];
  if (!plan.lawgokr?.configured) out.push('이 서버에는 법제처 연동이 설정되어 있지 않습니다. 법령 등록·동기화가 되는 서버에서 실행하세요.');
  if (plan.conflicts.length) {
    out.push(
      `이 고객사에 같은 코드의 규정이 이미 있습니다(이 스크립트가 넣은 것으로 볼 수 없음): ${conflictText(plan)}. ` +
        '시연 전용 고객사에서 실행하세요. 그 규정이 예전에 넣은 시연 규정이면 화면에서 지운 뒤 다시 실행합니다.',
    );
  }
  if (plan.slotShort) {
    out.push(`요금제(${plan.slotShort.plan ?? '?'})의 규정 자리가 모자랍니다 — 새로 넣을 ${plan.slotShort.needed}개, 남은 자리 ${plan.slotShort.remaining}개. Pro 이상 고객사에서 실행하세요.`);
  }
  return out;
}

const day = (d) => (d ? String(d).slice(0, 10) : '날짜 없음');
const WHY = {
  contentDiffers: '내용이 시연 규정과 다름',
  noMarker: '이 스크립트의 가져오기 표시 없음',
  cannotVerify: '가져오기 이력이 30건 넘게 쌓여 이 스크립트가 넣었는지 확인할 수 없음',
};
const FIELD = { revisionDate: '개정일', effectiveDate: '시행일' };
const conflictText = (plan) => plan.conflicts.map((c) => `${c}(${WHY[plan.conflictWhy?.[c]] ?? '판단 못 함'})`).join(', ');

/** --plan·실행 앞에 보이는 글 */
export function formatPlan(plan, { tenantName }) {
  const out = [];
  out.push(`대상 고객사: ${tenantName ?? '(이름 없음)'} — 이 고객사가 시연 전용인지 확인하세요.`);
  if (plan.conflicts.length) out.push(`! 같은 코드의 다른 규정: ${conflictText(plan)} — 이대로는 실행하지 않습니다.`);
  if (plan.reset) out.push(`지우고 다시 넣을 시연 규정: ${plan.toDelete.map((p) => p.code).join(', ') || '없음'}`);
  out.push(`새로 넣을 시연 규정: ${plan.toImport.join(', ') || '없음'}${plan.kept.length ? ` (이미 있어 그대로: ${plan.kept.join(', ')})` : ''}`);
  if (plan.dateFills?.length) {
    out.push(`비어 있는 날짜를 채울 시연 규정: ${plan.dateFills.map((d) => `${d.code}(${d.fields.map((f) => FIELD[f]).join('·')})`).join(', ')}`);
  }
  if (plan.slots) out.push(`규정 자리: ${plan.slots.used}/${plan.slots.max ?? '무제한'} 사용 중(요금제 ${plan.slots.plan})`);
  out.push(`새로 등록할 법령: ${plan.lawsToRegister.map((l) => l.name).join(', ') || '없음'}`);
  if (plan.lawsToRegister.length) {
    out.push('  ↳ 새로 등록한 법령은 현행 판이 기준이라 지금은 변경이 없습니다. 공포됐지만 시행 전인 판이 있으면 다음 동기화(매일 13:30·통합 관리자 실행) 뒤에 변경이 생깁니다 — 그 뒤 다시 실행하세요.');
    out.push('  ↳ 등록한 법령은 모든 고객사의 공용 목록에 남고, 연결·후보가 남는 한 지울 수 없습니다.');
  }
  if (plan.lawsMissing.length) out.push(`! 법제처에서 찾지 못한 법령: ${plan.lawsMissing.join(', ')} — 이 법령을 인용한 조문은 잇지 않습니다.`);
  const toConfirm = plan.links.toConfirm ? `, 추천을 확정 ${plan.links.toConfirm}건` : '';
  out.push(`법령 연결: 새로 ${plan.links.toCreate}건, 이미 있음 ${plan.links.existing}건${toConfirm}${plan.links.waitRegister ? `, 법령 등록 뒤 ${plan.links.waitRegister}건` : ''}`);
  for (const u of plan.links.unresolved) out.push(`  ! 법령에서 찾지 못한 조항: ${u}`);
  for (const u of plan.links.rejected) out.push(`  ! 사람이 반려한 연결이라 잇지 않음: ${u}`);
  for (const u of plan.links.missingRows) out.push(`  ! 규정에서 그 행을 찾지 못해 잇지 않음(화면에서 조문을 지우거나 번호를 바꿨다 — 처음 시연 규정으로 되돌리려면 --reset): ${u}`);
  if (plan.orphans?.length) {
    out.push(
      `  ! 예전에 이 스크립트가 넣은 것으로 보이는 규정(지금 시연 문서에 없는 코드): ${plan.orphans.join(', ')} — 지우지 않습니다. ` +
        "남아 있으면 그 규정에 닿는 변경은 '개정 후보 만들기'를 하지 않으니(그 규정에만 닿으면 '예전 시연 규정에 닿아 …', 다른 규정에도 닿으면 '다른 규정에도 닿아 …' — 이때는 지워도 막힌다), 시연 문서에서 빼거나 코드를 바꾼 것이면 화면에서 지우세요.",
    );
  }
  out.push(`쓸 법령 변경(시연 조문이 인용한 조항에 닿는 것): ${plan.eventLines.length ? '' : '없음'}`);
  for (const l of plan.eventLines) {
    const how = l.inWindow ? '창 안 — 연결하면 바로 후보' : "창 밖 — '개정 후보 만들기'로";
    const blocked = l.blocked ? ` · 다른 규정에도 닿아 만들지 않음 ${l.blocked}건` : '';
    const orphan = l.orphanBlocked ? ` · 예전 시연 규정에 닿아 만들지 않음 ${l.orphanBlocked}건` : '';
    const partial = l.partial ? ` · 일부 조문에만 후보가 있어 만들지 않음 ${l.partial}건` : '';
    out.push(`  - ${l.law} ${l.version ?? ''} 공포 ${day(l.promulgatedDate)} · 시행 ${day(l.lawEffectiveDate)} · ${how} · 변경 ${l.events}건 · 닿는 조문 ${l.rows.length}개 · 새 후보 최대 ${l.newCandidates}건${blocked}${orphan}${partial}`);
  }
  if (plan.candidates.blocked) {
    out.push(
      "  ! 이 고객사의 다른 규정에도 확정 연결이 닿는 변경은 '개정 후보 만들기'를 하지 않습니다(그 규정에도 후보가 생긴다). " +
        '--reset 으로는 풀리지 않습니다(그 규정의 연결은 남는다) — 시연 전용 고객사에서 실행하세요.',
    );
  }
  if (plan.candidates.orphanBlocked) {
    // 예전 시연 규정에만 닿는 변경 — 다른 규정에도 닿는 변경은 위 줄이다(지워도 막힌다, 8차 #1·#2)
    out.push(`  ! 예전 시연 규정에만 확정 연결이 닿는 변경도 '개정 후보 만들기'를 하지 않습니다(그 규정에도 후보가 생긴다). ${orphanFix(plan.candidates.orphanReset)}`);
  }
  if (plan.candidates.partial) {
    out.push("  ! 일부 시연 조문에만 이 변경의 후보가 있으면 '개정 후보 만들기'를 하지 않습니다(이미 후보가 있는 조문에 다시 생길 수 있다) — 다시 채우려면 --reset 으로 실행하세요.");
  }
  if (plan.cappedLaws.length) out.push(`  ↳ ${plan.cappedLaws.join(', ')}: 서버가 가장 늦게 감지한 변경 100건만 주어 그것만 봤습니다(더 먼저 감지한 변경은 쓰지 않는다).`);
  // 후보가 없을 인용 법령(실행 결과와 같은 묶음) — 새로 등록할 법령·법제처에서 찾지 못한 법령은 위 줄에 있다
  const g = plan.lawGroups;
  if (g.reachedNone.length) out.push(`  ↳ 닿는 변경은 있지만 후보가 생기지 않을 법령(반려된 연결·법령에 없는 조항·규정에서 찾지 못한 행·다른 규정에도 닿음·예전 시연 규정에 닿음·시행 본문 없음): ${g.reachedNone.join(', ')}`);
  if (g.noEvents.length) out.push(`  ↳ 시연 조문에 닿는 변경이 없는 인용 법령: ${g.noEvents.join(', ')}`);
  const blockedNote =
    (plan.candidates.blocked ? `, 다른 규정에도 닿아 만들지 않음 ${plan.candidates.blocked}건` : '') +
    (plan.candidates.orphanBlocked ? `, 예전 시연 규정에 닿아 만들지 않음 ${plan.candidates.orphanBlocked}건` : '') +
    (plan.candidates.partial ? `, 일부 조문에만 후보가 있어 만들지 않음 ${plan.candidates.partial}건` : '');
  out.push(`개정 후보: 새로 최대 ${plan.candidates.auto + plan.candidates.manual}건(연결하면 바로 ${plan.candidates.auto} · 만들기 ${plan.candidates.manual}), 이미 있음 ${plan.candidates.existing}건${blockedNote} — 서버가 실질 변경 없음·시행 본문 없음은 건너뛴다`);
  if (!plan.reset && plan.kept.length) out.push(`지금 처리 대기(작성·검토 중): ${plan.pendingNow}건`);
  const newCandidates = plan.candidates.auto + plan.candidates.manual;
  // 보낼 후보(작성 중 — 지금 있거나 새로 생길 것)가 있을 때만
  if (plan.willRequestReview && (newCandidates > 0 || plan.pendingNow > 0)) out.push('검토 요청: 처리 대기 후보 하나를 검토 중으로 보낸다(검토 중인 시연 후보가 없을 때만)');
  // 실행 뒤에도 처리 대기가 없으면 실행 결과와 같은 규칙(rules.emptyReason·emptyText)으로 알린다 — 0건이면 완료가 아니므로 어느 갈래든
  // 끝내 PM 에게 올리는 길을 적는다(완료 정의 ③). --reset 이면 지금 후보는 함께 지워져 세지 않는다
  if (newCandidates === 0 && plan.pendingNow === 0) {
    const reason = emptyReason({ processed: plan.candidatesNow > 0, groups: g });
    out.push(emptyText(reason, { future: true, processedCount: plan.candidatesNow, waitSync: plan.lawsToRegister.length > 0, noEvents: g.noEvents.length > 0 }));
  }
  return out.join('\n');
}
