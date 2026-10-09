import { positionKey, type Position } from '../common/article-structure';

/**
 * 묶음 승인의 자리 겹침 검사 — DB 없는 계산 (T-110 ②).
 *
 * 승인 시행일과 그 뒤의 모든 시행일마다, 조문마다 그날 실제로 시행 중인 버전의 계층(얼린 계층, 없으면 승인 뒤의 조문 행 값)으로
 * 자리(조·가지·항·목)를 놓아 겹치는지 본다. 마지막 모습만 보면 놓친다 — 미래 폐지로 남긴 조문, 유지로 둔 원문에 없는 조문, 미래 시행
 * 예정 버전이 새 조문·이동과 같은 날 같은 자리에 있을 수 있다. 폐지일은 경계로 보지 않는다(자리가 비기만 해서 겹침이 새로 생기지 않는다).
 * 계층이 바뀌는 조문은 시행일부터 늘 묶음 버전이 시행 중이라(더 늦은 시행본은 승인에서 막는다) 얼리지 않은 옛 버전을 볼 일이 없다.
 */

export type BoundaryVersion = {
  versionNum: number;
  effectiveDate: string | null;
  repealedOn: string | null;
  /** 얼린 계층의 자리 — 비어 있으면 조문 행을 따른다 */
  frozen: Position | null;
  /** 이번 묶음이 발행할 버전 */
  bundle?: boolean;
};

export type BoundaryArticle = {
  id: string;
  label: string;
  /** 승인 뒤의 자리(조문 행) */
  after: Position;
  /** 발행 이력 + 이번 묶음 버전 */
  versions: BoundaryVersion[];
  /** 이번 승인에서 폐지(시행일로) — 그날 시행 중인 버전에 폐지일이 붙는다 */
  repealAt?: string | null;
};

export type BoundaryConflict = { date: string; position: string; labels: string[] };

const pick = (versions: BoundaryVersion[], day: string) =>
  versions
    .filter((v) => v.effectiveDate && v.effectiveDate <= day)
    .sort((a, b) => (a.effectiveDate! < b.effectiveDate! ? 1 : a.effectiveDate! > b.effectiveDate! ? -1 : b.versionNum - a.versionNum))[0];

export function findBoundaryConflicts(articles: BoundaryArticle[], effective: string): BoundaryConflict[] {
  const days = new Set<string>([effective]);
  for (const a of articles) {
    for (const v of a.versions) {
      if (v.effectiveDate && v.effectiveDate >= effective) days.add(v.effectiveDate);
    }
  }
  const conflicts: BoundaryConflict[] = [];
  for (const day of [...days].sort()) {
    const occupied = new Map<string, string[]>();
    for (const a of articles) {
      const v = pick(a.versions, day);
      if (!v) continue;
      // 이번 승인에서 폐지하면 그날 시행 중이던 버전(묶음 버전이 아니다)에 폐지일이 붙는다
      const repealedOn = v.repealedOn ?? (a.repealAt && !v.bundle && pick(a.versions, a.repealAt) === v ? a.repealAt : null);
      if (repealedOn && repealedOn <= day) continue;
      const position = v.frozen ?? a.after;
      const key = positionKey(position);
      occupied.set(key, [...(occupied.get(key) ?? []), a.label]);
    }
    for (const [key, labels] of occupied) {
      if (labels.length > 1) conflicts.push({ date: day, position: key, labels });
    }
  }
  return conflicts;
}
