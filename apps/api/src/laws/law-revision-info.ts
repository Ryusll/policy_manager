import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import type { LawDetailMeta } from '../lawgokr/lawgokr.types';

/**
 * 법제처 개정 정보 (T-152) — 제개정이유·개정문은 판 행(law_versions), 약칭은 법령 행(laws — lawBibliography).
 *
 * 매퍼는 본문에서 이미 읽는다(버리던 곳은 저장 단계였다). 본문을 손에 쥔 채 판 행을 만드는 곳(등록 기준판·새 판 반영·재기준)은
 * revisionInfoFields 로 칸을 채우고, 목록만으로 만든 판 행(기존 판 보장)과 T-152 이전 판은 주기 동기화가 법령마다 끝에서('개정 없음'이든
 * 판을 반영했든, 반영이 실패·폐지로 멈췄든) fillRevisionInfo 로 이벤트 없이 채운다 — 실패는 T-144 조별 시행일 표기 채우기
 * (law-effective-collect)처럼 결과 note 로만 알리고 다음 동기화가 다시 본다.
 */

/** 본문 meta → 판 행 칸. 법제처가 주지 않은 값은 null(매퍼가 빈 값을 이미 null 로). 읽은 시각은 늘 찍는다 — 같은 판을 다시 부르지 않게 */
export function revisionInfoFields(meta: Pick<LawDetailMeta, 'revisionReason' | 'amendmentText'>, now = new Date()) {
  return { revisionReason: meta.revisionReason, amendmentText: meta.amendmentText, revisionInfoAt: now };
}

/**
 * 이 본문이 그 판의 것인가 — 법령ID·공포일이 둘 다 있으면 같아야 한다. 다른 판 본문의 이유를 이 판의 근거로 남기지 않게
 * (판 반영의 검사 law-version-sync 와 같다 — 응답에 값이 빠지는 일이 있어 있을 때만 견준다)
 */
export function bodyMatchesVersion(
  meta: Pick<LawDetailMeta, 'lawId' | 'promulgationDate'>,
  version: { promulgatedDate: Date | null },
  law: { externalLawId: string | null },
): boolean {
  if (meta.lawId && law.externalLawId && meta.lawId !== law.externalLawId) return false;
  const day = version.promulgatedDate ? version.promulgatedDate.toISOString().slice(0, 10) : null;
  return !(meta.promulgationDate && day && meta.promulgationDate !== day);
}

export type RevisionFillTarget = { id: string; externalId: string; externalLawId: string | null };
export type RevisionFillOptions = { max: number; deadline?: number };
export type RevisionFillResult = {
  filled: number;
  mismatched: string[];
  failed: Array<{ mst: string; error: string }>;
  /** 다 보지 못하고 멈췄으면(상한·마감·법제처 무응답, 창이 참) 아직 못 읽은 판 수 — 이번에 실패한 판도 센다. 다 봤으면 null */
  remaining: number | null;
  /** 남은 판 수를 세지 못했으면 그 오류 — 앞서 모은 판별 결과는 그대로 돌려준다 */
  remainingError?: string;
};
const errorText = (e: unknown) => (e as Error)?.message ?? String(e);
/** 법제처가 응답하지 않거나 응답이 깨졌다 — 시간 초과·연결 실패·HTTP 오류·형식 오류는 502, 인증값 없음·인증 실패는 503(lawgokr.service) */
const upstreamDown = (e: unknown) => e instanceof BadGatewayException || e instanceof ServiceUnavailableException;

/**
 * 아직 읽지 않은 판(revisionInfoAt null)의 개정 정보를 본문에서 채운다 — 이벤트·판 행 수는 그대로. 실패한 적 없는 판부터 공포 순 최근부터,
 * 실패한 판은 오래전에 실패한 것부터 본다(실패 시각 revisionInfoTriedAt — 계속 실패하는 판이 뒤 판을 막지 않게). 한 번에 max 판까지 채우고
 * 시도는 그 두 배까지, 실행 시간 상한(deadline)을 넘기면 멈춘다. 법제처가 응답하지 않거나 응답이 깨졌으면(502·503) 이 법령은 거기서 멈춘다 —
 * 장애 때 판마다 응답 제한(15초)을 기다리지 않게(그 판 하나만의 이상이었어도 실패 시각으로 뒤로 가 다음 동기화가 잇는다). 그 밖의 실패
 * (본문 이상·찾을 수 없음·DB)는 그 판만 건너뛴다. 판 행은 조건부 갱신(아직 읽지 않았을 때만)이라 다른 경로와 겹쳐도 덮어쓰지 않는다.
 * 기준판의 빈 법종(판 표기 '법률 제N호')과 법령 행의 빈 약칭(저장 판 본문으로만)도 함께 채운다. 판마다의 실패는 던지지 않고 돌려준다
 */
export async function fillRevisionInfo(
  prisma: Pick<PrismaService, 'lawVersion' | 'law'>,
  lawGoKr: Pick<LawGoKrService, 'getLaw'>,
  law: RevisionFillTarget,
  opts: RevisionFillOptions,
): Promise<RevisionFillResult> {
  const take = opts.max * 2;
  const rows = await prisma.lawVersion.findMany({
    where: { lawId: law.id, revisionInfoAt: null },
    select: { id: true, mst: true, promulgatedDate: true, lawType: true },
    orderBy: [{ revisionInfoTriedAt: { sort: 'asc', nulls: 'first' } }, { orderKey: { sort: 'desc', nulls: 'last' } }],
    take,
  });
  let filled = 0;
  let cut = rows.length === take; // 창이 찼으면 그 뒤에도 판이 있을 수 있다
  const mismatched: string[] = [];
  const failed: Array<{ mst: string; error: string }> = [];
  // 읽지 못한 판에는 실패 시각을 남겨 다음 채우기에서 뒤로 보낸다
  const markTried = (id: string) => prisma.lawVersion.updateMany({ where: { id, revisionInfoAt: null }, data: { revisionInfoTriedAt: new Date() } });
  for (const v of rows) {
    if (filled >= opts.max || (opts.deadline !== undefined && Date.now() > opts.deadline)) {
      cut = true;
      break;
    }
    let problem: { error: string; stop: boolean } | null = null; // null = 다른 판 본문
    try {
      const { meta } = await lawGoKr.getLaw(v.mst);
      if (bodyMatchesVersion(meta, v, law)) {
        // 약칭 먼저, 읽음 표지(판 행)는 마지막에 — 약칭 쓰기가 실패하면 그 판을 다시 본다(반쪽 저장 없이)
        if (v.mst === law.externalId && meta.shortTitle) {
          await prisma.law.updateMany({ where: { id: law.id, shortTitle: null }, data: { shortTitle: meta.shortTitle } });
        }
        const r = await prisma.lawVersion.updateMany({
          where: { id: v.id, revisionInfoAt: null },
          data: { ...revisionInfoFields(meta), ...(!v.lawType && meta.lawType ? { lawType: meta.lawType } : {}) },
        });
        filled += r.count;
        continue;
      }
    } catch (e) {
      problem = { error: errorText(e), stop: upstreamDown(e) };
    }
    // 읽지 못한 판 — 실패 시각을 남긴다. 못 남겼으면 그 사실도 알린다(그 판은 다음에도 앞에서 다시 본다)
    const unmarked = await markTried(v.id).then(
      () => null,
      (e: unknown) => errorText(e),
    );
    if (!problem) {
      mismatched.push(v.mst);
      if (unmarked) failed.push({ mst: v.mst, error: `실패 시각을 남기지 못함: ${unmarked}` });
      continue;
    }
    failed.push({ mst: v.mst, error: unmarked ? `${problem.error} (실패 시각도 남기지 못함: ${unmarked})` : problem.error });
    if (problem.stop) {
      cut = true;
      break;
    }
  }
  if (!cut) return { filled, mismatched, failed, remaining: null };
  // 남은 판 수를 못 세도 앞서 모은 판별 결과(이미 쓴 것)는 그대로 돌려준다
  try {
    return { filled, mismatched, failed, remaining: await prisma.lawVersion.count({ where: { lawId: law.id, revisionInfoAt: null } }) };
  } catch (e) {
    return { filled, mismatched, failed, remaining: null, remainingError: errorText(e) };
  }
}

/**
 * 동기화 결과에 붙일 문구 — 채운 것은 로그로만, 다른 판 본문·조회 실패·남은 판은 note 로 알린다(법령의 확인 결과는 그대로,
 * 다음 동기화가 이어서 채운다)
 */
export async function revisionInfoNote(
  prisma: Pick<PrismaService, 'lawVersion' | 'law'>,
  lawGoKr: Pick<LawGoKrService, 'getLaw'>,
  law: RevisionFillTarget & { lawName: string },
  opts: RevisionFillOptions,
  log: { log(message: string): void; warn(message: string): void },
): Promise<string | null> {
  let notes: string[];
  try {
    const r = await fillRevisionInfo(prisma, lawGoKr, law, opts);
    if (r.filled) log.log(`법제처 개정 정보 ${r.filled}판을 채웠습니다 [${law.lawName}]`);
    notes = [
      r.failed.length ? `법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도): ${r.failed.map((f) => `MST ${f.mst} — ${f.error}`).join('; ')}` : '',
      r.mismatched.length ? `본문의 법령ID·공포일이 판과 달라 개정 정보를 채우지 않았습니다(MST ${r.mismatched.join(', ')})` : '',
      r.remaining ? `개정 정보를 아직 못 읽은 판이 ${r.remaining}개 남았습니다 — 다음 동기화가 이어서 채웁니다.` : '',
      r.remainingError ? `개정 정보를 아직 못 읽은 판 수를 세지 못했습니다(다음 동기화가 이어서 채웁니다): ${r.remainingError}` : '',
    ].filter(Boolean);
  } catch (e) {
    // 판 목록 조회 같은 DB 오류 — 판마다의 실패는 위에서 모은다
    notes = [`법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도): ${errorText(e)}`];
  }
  if (!notes.length) return null;
  const message = notes.join(' ');
  log.warn(`${message} [${law.lawName}]`);
  return message;
}
