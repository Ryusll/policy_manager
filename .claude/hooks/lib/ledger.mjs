// 작업관리대장(docs/Deliverables/17_작업관리대장/작업관리대장.md) 읽기.
// 대장은 사람이 고치는 마크다운이라 CLI가 없다. 여기서는 두 가지만 읽는다:
//   - 다음에 쓸 번호(T-·C-·D-) — 다른 세션과 번호가 겹치지 않게 세션 시작·상태 줄에 보여 준다
//   - 상태 칸이 "완료"로 시작하는 작업 행 — done-gate가 새로 완료로 바뀌는 행을 찾는다

// 표 행의 첫 칸 ID. 예: "| T-130 | 제목 | ... | **완료(10/9)** → C-61 |"
const ROW = /^\|\s*(~~)?([TCD])-(\d+)(~~)?\s*\|/;

export function nextIds(text) {
  const max = { T: 0, C: 0, D: 0 };
  for (const line of String(text || '').split('\n')) {
    const m = line.match(ROW);
    if (m) max[m[2]] = Math.max(max[m[2]], Number(m[3]));
  }
  return { T: `T-${max.T + 1}`, C: `C-${max.C + 1}`, D: `D-${max.D + 1}` };
}

// 마지막 칸(상태)이 "완료"로 시작하는 T 행의 ID 집합. "진행 — ① 완료" 같은 부분 진행은 넣지 않는다.
export function completedTasks(text) {
  const done = new Set();
  for (const line of String(text || '').split('\n')) {
    const m = line.match(ROW);
    if (!m || m[2] !== 'T') continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    const status = (cells[cells.length - 1] || '').replace(/^[*_~\s]+/, '');
    if (status.startsWith('완료')) done.add(`T-${m[3]}`);
  }
  return done;
}

export function newlyCompleted(before, after) {
  const was = completedTasks(before);
  return [...completedTasks(after)].filter((id) => !was.has(id));
}
