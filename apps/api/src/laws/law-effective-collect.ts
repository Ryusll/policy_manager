import { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import { EFFECTIVE_NOTES_VERSION, readEffectiveNotes, sameEffectiveNotes, type EffectiveNote } from '../common/effective-notes';
import { buildLawArticleRows } from './law-rows';
import { TX_OPTIONS } from './law-tx';

export type EffectiveNotesTarget = { id: string; externalId: string; effectiveNotesVersion: number | null };

/**
 * 이미 등록된 법령의 조별 시행일 표기를 지금 읽기 규칙으로 맞춘다(T-144, PAT-06) — 주기 동기화가 같은 판(MST)이면 본문을
 * 다시 받지 않아서, T-144 이전에 등록한 법령(판 null)이나 읽기 규칙이 바뀐 뒤의 법령(판이 옛 번호)은 표기가 비었거나 낡았다.
 * 법령 행의 판이 `EFFECTIVE_NOTES_VERSION` 과 다를 때만 이 판을 한 번 읽어(캐시된 매핑 결과) 달라진 조항만 고쳐 쓴다.
 *
 * **이벤트는 만들지 않는다.** 우리가 다시 읽은 것이지 법령이 바뀐 것이 아니다. 본문·시행일·연결·사라진 조항은 건드리지 않는다.
 * 이번 판에 없는 nodeKey 의 행도 그대로 둔다 — 그래도 법령의 판은 올려, 매 주기 다시 읽는 일이 없게 한다.
 *
 * 겹치는 저장과의 순서: 먼저 법령 행의 판을 "같은 MST 이고 아직 옛 판"일 때만 올려 행 잠금을 잡는다. 등록·새 판 저장(saveArticles)도
 * 법령 행을 먼저 고치므로 이 트랜잭션이 끝날 때까지 기다리고, 그쪽이 먼저 끝났으면 판이 이미 올라가 있어(또는 MST 가 바뀌어) 여기서 손을 뗀다.
 * @returns 고쳐 쓴 조항 수. 판이 이미 같으면 null(읽지 않음)
 */
export async function collectEffectiveNotes(
  prisma: PrismaService,
  lawGoKr: Pick<LawGoKrService, 'getLaw'>,
  law: EffectiveNotesTarget,
): Promise<number | null> {
  if (law.effectiveNotesVersion === EFFECTIVE_NOTES_VERSION) return null;
  const { tree } = await lawGoKr.getLaw(law.externalId);
  const fresh = new Map(buildLawArticleRows(tree.roots).rows.map((r) => [r.nodeKey, r.effectiveNotes]));
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.law.updateMany({
      where: {
        id: law.id,
        externalId: law.externalId,
        OR: [{ effectiveNotesVersion: null }, { effectiveNotesVersion: { not: EFFECTIVE_NOTES_VERSION } }],
      },
      data: { effectiveNotesVersion: EFFECTIVE_NOTES_VERSION },
    });
    if (!claimed.count) return 0;
    const live = await tx.lawArticle.findMany({
      where: { lawId: law.id, deletedAt: null },
      select: { id: true, nodeKey: true, effectiveNotes: true },
    });
    // 바뀌는 조항만, 같은 값끼리 묶어 쓴다 — 조항 1,800개 법령도 쓰기 몇 번으로 끝난다(대부분 [])
    const groups = new Map<string, { notes: EffectiveNote[]; ids: string[] }>();
    for (const a of live) {
      const notes = fresh.get(a.nodeKey);
      if (!notes) continue;
      const stored = readEffectiveNotes(a.effectiveNotes);
      if (stored && sameEffectiveNotes(stored, notes)) continue;
      const key = JSON.stringify(notes);
      const group = groups.get(key) ?? { notes, ids: [] };
      group.ids.push(a.id);
      groups.set(key, group);
    }
    let written = 0;
    for (const { notes, ids } of groups.values()) {
      const r = await tx.lawArticle.updateMany({
        where: { id: { in: ids } },
        data: { effectiveNotes: notes as unknown as Prisma.InputJsonValue },
      });
      written += r.count;
    }
    return written;
  }, TX_OPTIONS);
}
