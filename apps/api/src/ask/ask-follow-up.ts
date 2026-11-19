import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AI_QA_LOG_RETENTION_DAYS, retentionCutoff } from './ask-retention';
import { ASK_MAX_GROUPS, joKey, type AskRow } from './ask-text';

/** 이어받는 조 수 — 후보 12개 가운데 AI 가 고른 조 다음 자리(T-220) */
export const ASK_CARRY_MAX = 4;
/** AI 가 목차에서 고른 조를 받는 수 — 이어 묻기가 아니면 지금과 같다 */
const SELECTED_MAX = 10;

type ParentDb = Pick<Prisma.TransactionClient, 'aiQaLog'>;

/** 이어 물을 앞 질문 — 그 답이 근거로 댄 조문 id(인용 차례) */
export interface AskParent {
  id: string;
  articleIds: string[];
}

/**
 * 이어서 묻기(T-220, SRS SEARCH-12)의 앞 질문(부모) 확인. 본인 것·같은 회사·보관 기간(90일) 안이면서 **답을 냈고 물은 때의
 * 근거를 남긴 기록**(T-218 뒤)만 받는다 — 답하지 못한 질문·오류·처리 중이던 질문, 근거를 남기기 전의 옛 기록은 이어 묻지 않는다.
 * 아니면 구분 없이 같은 400(무엇이 있는지 알려 주지 않는다). 예약 트랜잭션 안에서 범위 확인 다음·한도 확인 앞에 보므로 거절되면
 * 기록 행도 한도 차감도 없다. 근거의 조문 id 를 같은 트랜잭션에서 읽어 넘긴다 — 그사이 파기와 겹치지 않게.
 * 앞 질문·답의 글은 다시 보내지 않는다(외부 전송 고지의 보내는 항목이 그대로다).
 */
export async function checkedParent(
  db: ParentDb,
  tenantId: string,
  userId: string | null,
  parentId: string | undefined,
): Promise<AskParent | null> {
  if (!parentId) return null;
  const row = userId
    ? await db.aiQaLog.findFirst({
        where: { id: parentId, tenantId, userId, answerable: true, createdAt: { gte: retentionCutoff(AI_QA_LOG_RETENTION_DAYS) } },
        select: { id: true, citations: true },
      })
    : null;
  const cited = row?.citations;
  const articleIds = Array.isArray(cited)
    ? cited.flatMap((c) => {
        const id = c && typeof c === 'object' && !Array.isArray(c) ? c.articleId : undefined;
        return typeof id === 'string' ? [id] : [];
      })
    : null;
  // 이어받을 근거 조문이 없는 기록(근거를 남기기 전 옛 기록·근거가 빈 기록)도 앞 질문이 될 수 없다
  if (!row || !articleIds?.length) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'AI_QA_PARENT_INVALID',
      message: '이어서 물을 앞 질문을 찾을 수 없습니다. 새 질문으로 물어 주세요.',
    });
  }
  return { id: row.id, articleIds };
}

/**
 * 앞 답의 근거 조문이 **지금** 든 조 — 조 번호가 아니라 조문 id 로 찾아, 조 번호가 바뀌는 개정 뒤에도 같은 조를 따라간다.
 * 지금 시행 중이고 이번 범위 안인 조(liveKeys)만, 앞 답이 인용한 차례대로 4개까지. 지운·폐지된 조문은 빠진다.
 */
export function carriedKeys(
  articleIds: readonly string[],
  rows: readonly Pick<AskRow, 'articleId' | 'policyId' | 'number' | 'branchNumber'>[],
  liveKeys: ReadonlySet<string>,
): string[] {
  const keyOf = new Map(rows.map((r) => [r.articleId, joKey(r.policyId, r.number, r.branchNumber)]));
  const out: string[] = [];
  for (const id of articleIds) {
    const key = keyOf.get(id);
    if (key && liveKeys.has(key) && !out.includes(key)) out.push(key);
    if (out.length >= ASK_CARRY_MAX) break;
  }
  return out;
}

/**
 * 후보 합치기 — AI 가 목차에서 이번 질문으로 고른 조 → 이어받은 조(4개까지) → 질문 낱말이 든 조, 겹치지 않게 12개까지.
 * 이어받은 조가 있으면 그 수만큼 자리를 남겨 두고(AI 가 고른 조는 8~10개) 그다음에 놓는다 — 이번 질문에 AI 가 가장 맞다고 고른
 * 조들이 앞에 서고, AI 가 조를 많이 고르는 모호한 이어 질문('그건 며칠까지 되나요?')에서도 앞 답의 조가 12개 후보 안에 든다.
 * 다만 본문 글자 상한(CONTEXT_MAX_CHARS)은 이 차례로 채우므로, 앞의 조들이 상한을 채우면 뒤의 조부터 빠질 수 있다.
 * 이어 묻기가 아니면(이어받은 조 없음) 지금과 같다 — AI 가 고른 조 10개까지, 나머지는 낱말 조.
 */
export function mergeCandidates(carried: readonly string[], selected: readonly string[], keyword: readonly string[]): string[] {
  const carry = carried.slice(0, ASK_CARRY_MAX);
  const picked = selected.filter((k) => !carry.includes(k)).slice(0, Math.min(SELECTED_MAX, ASK_MAX_GROUPS - carry.length));
  const chosen: string[] = [];
  for (const k of [...picked, ...carry, ...keyword]) {
    if (!chosen.includes(k)) chosen.push(k);
    if (chosen.length >= ASK_MAX_GROUPS) break;
  }
  return chosen;
}
