import { createHash } from 'crypto';
import { toDateOnlyString } from '../common/date-only';
import { selectValue, type ValueRow } from '../variables/variable-binding';

/**
 * 개정 후보에 변수 값을 넣는 계획 — DB 없는 계산 (T-109 ②, 특허 청구항 5, 도 9 단계 930~950).
 *
 * 영향 조문의 기준 본문에 걸린 변수 연결마다, 후보의 **예정 사내 시행일**에 맞는 값을 골라 그 자리에 넣을지 정한다.
 * - 그 날 맞는 값이 정확히 하나이고 지금 문구와 다르면 넣는다(`applied`)
 * - 같으면 그대로(`unchanged`)
 * - 값이 없거나·기간이 겹치거나·기간 미확정이거나, 연결된 구간의 문구가 기준 본문과 다르면 넣지 않는다(`held`)
 * - 법령 개정과 같은 자리를 고치게 되면 원문을 두고 양쪽 제안을 남긴다(`conflict` — 규칙 엔진이 정한다)
 * 변수 근거는 법령 근거와 따로 `rationale.variables` 에 남는다(값·유효기간·범위·위치 전후).
 */

export type BindingInput = {
  id: string;
  variableId: string;
  key: string;
  label: string;
  origin: string;
  start: number;
  end: number;
  text: string;
};

export type ValueInput = ValueRow & { variableId: string };

export type VariableEntryStatus = 'applied' | 'unchanged' | 'held' | 'conflict';
export type VariableHoldReason = 'none' | 'ambiguous' | 'unconfirmed' | 'span_mismatch' | 'law_conflict';

export interface VariableEntry {
  index: number;
  bindingId: string;
  variableId: string;
  key: string;
  label: string;
  origin: string;
  /** 고른 값 — 그 날짜에 맞는 값이 정확히 하나일 때 */
  valueId: string | null;
  value: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** 값의 범위 — 지금은 그 회사(테넌트) */
  scope: 'tenant';
  /** 기준 본문 쪽 구간(연결된 자리) */
  base: { start: number; end: number; text: string };
  /** 후보 본문 쪽 구간 — 넣었을 때만 */
  candidate: { start: number; end: number; text: string } | null;
  status: VariableEntryStatus;
  reason: VariableHoldReason | null;
}

/** 규칙 엔진에 넘기는 변수 값 넣기 제안 — `ref` 는 `entries[].index` */
export interface VariableProposal {
  ref: number;
  start: number;
  end: number;
  replacement: string;
}

const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);

export function planVariables(
  base: string,
  bindings: BindingInput[],
  values: ValueInput[],
  date: Date,
): { entries: VariableEntry[]; proposals: VariableProposal[] } {
  const proposals: VariableProposal[] = [];
  const entries = [...bindings]
    .sort((a, b) => a.start - b.start)
    .map((b, index): VariableEntry => {
      const entry: VariableEntry = {
        index,
        bindingId: b.id,
        variableId: b.variableId,
        key: b.key,
        label: b.label,
        origin: b.origin,
        valueId: null,
        value: null,
        validFrom: null,
        validTo: null,
        scope: 'tenant',
        base: { start: b.start, end: b.end, text: b.text },
        candidate: null,
        status: 'held',
        reason: null,
      };
      // 연결된 자리의 문구가 기준 본문과 다르면 어디에 넣을지 믿을 수 없다
      if (base.slice(b.start, b.end) !== b.text) return { ...entry, reason: 'span_mismatch' };
      const pick = selectValue(
        values.filter((v) => v.variableId === b.variableId),
        date,
      );
      if ('reason' in pick) return { ...entry, reason: pick.reason };
      const chosen = {
        ...entry,
        valueId: pick.value.id,
        value: pick.value.value,
        validFrom: day(pick.value.validFrom),
        validTo: day(pick.value.validTo),
      };
      if (pick.value.value === b.text) return { ...chosen, status: 'unchanged' };
      proposals.push({ ref: index, start: b.start, end: b.end, replacement: pick.value.value });
      return { ...chosen, status: 'applied' };
    });
  return { entries, proposals };
}

/**
 * 변수 입력의 지문 — 연결·고른 값·결과가 같으면 같다. 후보 중복 판정에 쓴다(예정 시행일과 함께).
 * 값 문구도 넣는다(vf2, T-139) — 값 행은 제자리에서 고쳐지므로 id 가 같아도 문구가 다를 수 있다. vf1(문구 없음)으로 만든 후보와
 * 입력이 같아도 지문이 달라 "다시 만들기"는 한 번 새 후보를 만든다(옛 후보도 승인 때 문구를 다시 본다)
 */
export function variableFingerprint(entries: VariableEntry[]): string {
  if (!entries.length) return '';
  const rows = entries.map((e) => JSON.stringify([e.bindingId, e.status, e.valueId, e.value, e.reason])).sort();
  return `vf2:${createHash('sha256').update(rows.join('\n'), 'utf8').digest('hex')}`;
}

/** 본문에 미치는 효과 — 값을 넣었으면 그 값(값 행과 문구), 아니면 원문 그대로 */
const effect = (e: Pick<VariableEntry, 'status' | 'valueId' | 'value'> | undefined) =>
  e?.status === 'applied' ? `apply:${JSON.stringify([e.valueId, e.value])}` : 'keep';

export interface VariableMismatch {
  label: string;
  /** 후보가 그 자리에 둔 문구 */
  candidate: string;
  /** 지금 다시 고르면 둘 문구(값을 고를 수 없으면 null) */
  expected: string | null;
  /** 연결이 풀려 근거가 없어졌다 */
  released?: boolean;
}

/**
 * 후보가 넣은 변수 값이 지금(그 날짜 기준) 다시 골라도 같은가 — 본문에 미치는 효과로 비교한다(T-109 ②).
 * 원문을 둔 자리(그대로·보류·충돌)는 서로 같고, 값을 넣은 자리는 같은 값(같은 값 행, 같은 문구 — 값 행은 제자리에서 고쳐진다)이어야 한다. 법령 개정과 겹쳐
 * 원문을 둔 자리는 다시 골라도 겹치므로 보지 않는다. 후보가 값을 넣었는데 그 연결이 풀렸으면 근거가 없어진 것이다.
 * 변수 반영 전(`rule/1`) 후보는 변수 기록이 없어 "모두 원문"으로 본다 — 지금 고르면 넣을 값이 있으면 다르다.
 */
export function compareVariableEffects(stored: VariableEntry[] | undefined, expected: VariableEntry[]): VariableMismatch[] {
  const byBinding = new Map((stored ?? []).map((e) => [e.bindingId, e]));
  const out: VariableMismatch[] = [];
  for (const e of expected) {
    const s = byBinding.get(e.bindingId);
    if (s?.status === 'conflict') continue;
    if (effect(s) !== effect(e)) {
      out.push({
        label: e.label,
        candidate: s?.status === 'applied' ? (s.value ?? '') : e.base.text,
        expected: e.status === 'applied' ? e.value : e.status === 'unchanged' ? e.base.text : null,
      });
    }
  }
  const live = new Set(expected.map((e) => e.bindingId));
  for (const s of stored ?? []) {
    if (s.status === 'applied' && !live.has(s.bindingId)) {
      out.push({ label: s.label, candidate: s.value ?? '', expected: null, released: true });
    }
  }
  return out;
}
