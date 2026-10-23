import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { VersionStatus } from '@prisma/client';
import { asOfState } from '../common/as-of';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { holdArticleVersions, LOCK_WAIT_MS } from '../common/row-locks';
import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * 법령 관계 근거 문구의 원천 판(T-177, PAT-08 — 특허 도 3 S320 "근거가 특정 조문 버전의 본문에 기초하면 그 버전의 식별자를
 * 법령 관계 정보에 대응시켜 저장"). 연결 대상은 그대로 조문이고, 원천 판은 근거 문구에만 붙는다.
 *
 * **규칙 하나**: 근거 문구와 판 본문에서 공백을 지우고, 근거 문구(공백 빼고 4자 이상)를 담은 판 가운데 오늘(한국 날짜) 시행 중인
 * 판 먼저, 없으면 판 번호가 가장 큰 판. 못 찾으면 null — 본문 밖 문구(메모·사람이 쓴 설명)다. 직접 만들기·근거 문구 고치기·자동
 * 찾기가 모두 이것을 쓰고, 이미 있던 연결은 마이그레이션 `20261018120000_law_link_evidence_version` 의 같은 SQL 이 채웠다(고치면
 * 둘 다 — 시험이 본다).
 *
 * 원천 판은 **연결할 때(근거 문구를 고칠 때) 근거 문구를 담고 있던 판**이다 — 초안이 그 뒤 고쳐져도 다시 고르지 않는다. 지금 본문과
 * 맞는지는 볼 때마다 따로 잰다(`evidenceInContent` — 목록은 오늘 시행 판, 개정 후보는 기준 본문). 비교 기준(공백을 지우고 포함)은
 * 규칙 엔진이 근거 문구로 문장을 좁히는 기준(amendment-rules)과 같다. 시행 판을 먼저 고르는 까닭 — 같은 문장이 시행 판과 초안에 모두
 * 있을 때 초안을 원천으로 남기면 초안이 고쳐지거나 지워질 때 원천이 흔들린다.
 */

/** 지우는 공백 — JS `\s` 와 같은 문자 모음을 그대로 적었다. 마이그레이션 SQL 이 같은 글자열을 쓴다(시험이 같은지 본다) */
export const EVIDENCE_SPACE_CLASS = '[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+';
const SPACES = new RegExp(EVIDENCE_SPACE_CLASS, 'g');

/** 이보다 짧으면(공백 뺀 글자 수) 원천을 찾지 않는다 — 어디에나 있는 짧은 말이 원천을 정하지 않게(엔진도 4자 미만은 쓰지 않는다) */
export const MIN_EVIDENCE_LENGTH = 4;

export const compactEvidence = (s: string) => s.replace(SPACES, '');

/**
 * 원천을 찾을 근거 문구(공백을 지운 것). 비었거나 짧으면 null. 글자 수는 코드 포인트로 센다 — 마이그레이션 SQL 의 `char_length` 와
 * 같은 셈(UTF-16 길이로 세면 확장 한자·이모지가 든 문구에서 갈린다)
 */
export function searchableEvidence(evidence: string | null | undefined): string | null {
  const ev = evidence ? compactEvidence(evidence) : '';
  return Array.from(ev).length >= MIN_EVIDENCE_LENGTH ? ev : null;
}

/** 이 본문이 근거 문구를 담는가(공백 무시) — 원천 고르기와 "지금 판에 있나"가 같은 기준. 찾을 수 없는 근거 문구면 null */
export function evidenceInContent(content: string, evidence: string | null | undefined): boolean | null {
  const ev = searchableEvidence(evidence);
  return ev === null ? null : compactEvidence(content).includes(ev);
}

export interface VersionForEvidence {
  id: string;
  versionNum: number;
  status: VersionStatus;
  effectiveDate: Date | null;
  repealedOn: Date | null;
  content: string;
}

/**
 * 오늘 시행 중인 판 — `currentVersionWhere` + `CURRENT_VERSION_ORDER`(common/as-of) 의 메모리 판. 고른 판이 오늘 폐지 상태면
 * 시행 중인 판이 없다(`asOfState` — 그 앞 판으로 되돌아가지 않는다)
 */
export function currentVersionOf<T extends Pick<VersionForEvidence, 'id' | 'versionNum' | 'status' | 'effectiveDate' | 'repealedOn'>>(
  versions: T[],
  today: Date,
): T | null {
  const issued = versions.filter(
    (v) => (v.status === 'published' || v.status === 'archived') && (!v.effectiveDate || v.effectiveDate.getTime() <= today.getTime()),
  );
  // 시행일 내림차순(시행일 없는 예전 시행본은 맨 뒤 — NULLS LAST), 같으면 판 번호 큰 쪽
  const key = (v: T) => (v.effectiveDate ? v.effectiveDate.getTime() : -Infinity);
  issued.sort((a, b) => (key(b) === key(a) ? b.versionNum - a.versionNum : key(b) - key(a)));
  const picked = issued[0] ?? null;
  return asOfState(picked, today) === 'in_force' ? picked : null;
}

/** 근거 문구의 원천 판 id. 근거 문구가 비었거나 짧거나 어느 판 본문에도 없으면 null */
export function pickEvidenceVersion(versions: VersionForEvidence[], evidence: string | null | undefined, today: Date): string | null {
  const ev = searchableEvidence(evidence);
  if (ev === null) return null;
  const holding = versions.filter((v) => compactEvidence(v.content).includes(ev));
  if (!holding.length) return null;
  const current = currentVersionOf(versions, today);
  if (current && holding.some((v) => v.id === current.id)) return current.id;
  return holding.reduce((a, b) => (b.versionNum > a.versionNum ? b : a)).id;
}

/** 원천 판과 "본문에서 찾았는가" — 연결에 함께 쓴다(찾았으면 원천 판이 그 뒤 지워져도 본문에서 찾은 근거로 남는다) */
export function evidenceSource(versions: VersionForEvidence[], evidence: string | null | undefined, today: Date) {
  const evidenceVersionId = pickEvidenceVersion(versions, evidence, today);
  return { evidenceVersionId, evidenceFromBody: evidenceVersionId !== null };
}

/**
 * 원천을 정해 쓰는 트랜잭션 제한 — 잠그는 단계(조문·판 두 문장이 한도 3초를 나눠 쓴다)와 쓰기의 암묵적 기다림(연결 행·FK 확인, 단계마다
 * lock_timeout 3초)이 겹쳐도 기본 제한(5초)에 걸려 409 대신 500 이 되지 않게
 */
const EVIDENCE_TX_TIMEOUT_MS = LOCK_WAIT_MS * 3;

/**
 * 근거 문구의 원천을 정해 연결을 쓴다(T-177). 한 트랜잭션에서 조문 행과 그 판들을 먼저 잡고(`holdArticleVersions` — 조문 → 판 → 연결
 * 순서로 삭제와 같다) 잡은 판들로 원천을 고른 뒤 쓴다 — 고른 판이 쓰기 전에 지워지지 않고, 지우는 쪽이 앞이면 끝나길 기다렸다가 남은 판들로
 * 고른다. 조문이 그 사이 지워졌으면 404. 원천을 쓰는 곳(만들기·근거 문구 고치기·자동 추천)은 모두 이 길로 쓴다
 */
export async function withHeldVersions<T>(
  db: PrismaService,
  articleId: string,
  work: (tx: Prisma.TransactionClient, versions: VersionForEvidence[], today: Date) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      const versions = await holdArticleVersions(tx, articleId);
      if (!versions) throw new NotFoundException('조문을 찾을 수 없습니다.');
      return work(tx, versions, todayDateOnly());
    },
    { timeout: EVIDENCE_TX_TIMEOUT_MS },
  );
}

/** 원천 판 요약을 만들 때 읽는 열 — 본문은 읽지 않는다(초안 본문이 목록·근거로 새지 않게) */
export const EVIDENCE_VERSION_SELECT = { select: { id: true, articleId: true, versionNum: true, status: true, effectiveDate: true } } as const;

export interface EvidenceVersionSummary {
  id: string;
  versionNum: number;
  status: VersionStatus;
  /** YYYY-MM-DD */
  effectiveDate: string | null;
}

/**
 * 응답·근거 스냅샷에 싣는 원천 판 요약. 원천이 연결의 조문이 아닌 판을 가리키면(서버만 고르니 생기지 않아야 할 행 — 옛 잘못된 행을
 * 막는 것과 같은 방어, our-links) 싣지 않는다
 */
export function evidenceSummary(link: {
  articleId: string;
  evidenceVersion: { id: string; articleId: string; versionNum: number; status: VersionStatus; effectiveDate: Date | null } | null;
}): EvidenceVersionSummary | null {
  const v = link.evidenceVersion;
  if (!v || v.articleId !== link.articleId) return null;
  return { id: v.id, versionNum: v.versionNum, status: v.status, effectiveDate: v.effectiveDate ? toDateOnlyString(v.effectiveDate) : null };
}
