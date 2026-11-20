import { HttpException } from '@nestjs/common';
import type { ChainStop } from './law-version-chain';
import { LawVersionConflictError } from './law-version-apply';

/**
 * 법령 확인 실패 사유 — 고객 화면(법령 상세 머리말·법령 목록 툴팁, `lastCheckError`)에 보일 문구(T-222, SRS NFR-9).
 * 원문(Prisma·TypeError·내부 오류 글·입력 검증 문구 — 구현 사정이 든 글)은 통합 관리자 동기화 이력(실행 결과의 error)과 서버 로그에만 남긴다.
 * 고객 문구는 허용 목록으로만 고른다 — 고객용으로 정해 둔 것만 그 문구를 쓰고, 그 밖(앞으로 더해질 오류 포함)은 고정 문구다. 판정은 이
 * 파일에서 하고, 다른 파일에 있는 문구를 그대로 쓰는 것은 셋뿐이다 — 법령ID 없는 옛 법령(NO_LAW_ID, law-sync.service 가 바로 남긴다),
 * 같은 법령 중복 등록(law-version-apply 의 LawVersionConflictError), 법제처 미설정·연결 거절 안내(lawgokr.service 의 코드 붙은 503).
 * '확인 실패' 판정은 문구가 아니라 값이 있느냐라 그대로다(대시보드 T-213 포함) — 그래서 빈 문구를 돌려주지 않는다.
 */
export const CHECK_FAILED_FOR_CUSTOMER = '확인 중 문제가 생겼습니다 — 다음 확인 때 다시 시도합니다. 계속되면 아스트룸에 문의하세요.';
/**
 * 법제처 연결·응답 문제(5xx) — 법제처 쪽 오류 문구('잠시 뒤 다시 시도하세요' 등 사용자가 할 일처럼 읽히는 글) 대신. 인증값이 틀려 HTML
 * 오류 화면이 오는 경우처럼 다시 시도해도 풀리지 않는 5xx 도 있어 문의 안내를 붙인다(2차 검토)
 */
// '확인을 마치지 못했습니다' — 앞 판을 반영한 뒤 다음 판에서 실패한 경우도 있다(그 판들은 반영됐다, 3차 검토)
export const LAWGOKR_FAILED_FOR_CUSTOMER = '법제처 연결이나 응답에 문제가 있어 확인을 마치지 못했습니다 — 다음 확인 때 다시 시도합니다. 계속되면 아스트룸에 문의하세요.';
/** 확인 시간 안에 새 판을 하나도 반영하지 못함 — 실행 결과의 글(남은 판 수)은 이력에만 두고 고객에게는 이 문구(판 걷기의 고객 문구 판정을 이 파일에서, 2차 검토) */
export const DEADLINE_FOR_CUSTOMER = '정해진 확인 시간 안에 새 개정을 반영하지 못했습니다 — 다음 확인 때 다시 시도합니다. 계속되면 아스트룸에 문의하세요.';
/** 폐지 판에서 멈춤 — 실행 결과의 글('이벤트를 만들지 않았습니다 … 추적 해제를 검토하세요')은 운영자용이라 고객에게는 이 문구 */
export const REPEALED_FOR_CUSTOMER = '폐지된 법령입니다 — 폐지 판부터는 개정을 확인하지 않습니다.';
/** 고객 화면에 그대로 보이게 정해 둔 법제처 안내(T-212 — 미설정·연결 거절, 아스트룸 문의 포함) */
const CUSTOMER_CODES = new Set(['LAWGOKR_NOT_CONFIGURED', 'LAWGOKR_AUTH']);

/** 고객용으로 정해 둔 HttpException 이면 그 문구, 아니면 null */
function codedMessage(e: HttpException): string | null {
  const r = e.getResponse() as { code?: unknown; message?: unknown } | string | null;
  if (!r || typeof r !== 'object' || typeof r.code !== 'string' || !CUSTOMER_CODES.has(r.code)) return null;
  return typeof r.message === 'string' && r.message.trim() ? r.message.trim() : null;
}

/**
 * 오류 → 고객에게 보일 확인 실패 사유. 같은 법령이 따로 등록됨(LawVersionConflictError — 아스트룸에 문의)과 고객용 코드를 단 법제처 안내는
 * 그 문구, 그 밖의 법제처 연결·응답 문제(HttpException 5xx — 법제처가 오류 상태로 답한 것도 lawgokr.service 가 502 로 바꾼다)는 한 문구,
 * 나머지(4xx 입력 검증·등록 문구, 법제처 조회 결과로 우리 서버가 내는 4xx — 그 판이 없음·번호 형식, 일반 오류)는 고정 문구다.
 */
export function checkErrorForCustomer(e: unknown): string {
  if (e instanceof LawVersionConflictError) return e.message.trim() || CHECK_FAILED_FOR_CUSTOMER;
  if (e instanceof HttpException) {
    const coded = codedMessage(e);
    if (coded) return coded;
    if (e.getStatus() >= 500) return LAWGOKR_FAILED_FOR_CUSTOMER;
  }
  return CHECK_FAILED_FOR_CUSTOMER;
}

/**
 * 판 걷기 결과(walkResult)의 확인 실패 사유 — 허용 목록: 확인 시간 안에 하나도 반영하지 못함(deadline)은
 * DEADLINE_FOR_CUSTOMER, 폐지 판은 REPEALED_FOR_CUSTOMER, 판 반영 실패(failed)는 그 오류의 고객 문구, 그 밖은 고정 문구. 실패가 아니면
 * (error 없음) null. walkResult 의 글(남은 판 수·MST)은 실행 결과(이력)에만 남는다
 */
export function walkCheckError(stop: ChainStop | undefined, error: string | null | undefined): string | null {
  if (!error) return null;
  switch (stop?.kind) {
    case 'deadline':
      return DEADLINE_FOR_CUSTOMER;
    case 'repeal':
      return REPEALED_FOR_CUSTOMER;
    case 'failed':
      return checkErrorForCustomer(stop.cause);
    default:
      return CHECK_FAILED_FOR_CUSTOMER;
  }
}
