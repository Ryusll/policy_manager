import { describe, expect, it } from 'vitest';
import { BadGatewayException, BadRequestException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CHECK_FAILED_FOR_CUSTOMER,
  DEADLINE_FOR_CUSTOMER,
  LAWGOKR_FAILED_FOR_CUSTOMER,
  REPEALED_FOR_CUSTOMER,
  checkErrorForCustomer,
  walkCheckError,
} from '../apps/api/src/laws/law-check-error';
import { LawVersionConflictError, LawVersionDuplicateError } from '../apps/api/src/laws/law-version-apply';
import { setup } from './lawSyncFake';

/**
 * T-222 법령 확인 실패 사유에 서버 원문을 싣지 않기(SRS NFR-9) — 고객 화면(법령 상세 머리말·목록 툴팁)의 `lastCheckError` 에는 허용 목록의
 * 고객 문구만, 원문은 통합 관리자 동기화 이력(실행 결과의 error)과 서버 로그에. '확인 실패' 판정(값이 있느냐 — 대시보드 T-213 포함)은 그대로.
 */
const prismaError = () =>
  new Prisma.PrismaClientKnownRequestError('\nInvalid `prisma.law.update()` invocation in\n/app/dist/laws/law-sync-mark.js:42:5\nUnique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
const notConfigured = '법제처 연동이 준비되지 않았습니다. 아스트룸에 문의하세요.';
const refused = '법제처가 이 서버의 연결을 거절했습니다. 계속되면 아스트룸에 문의하세요.';
const coded = (code: string, message: string) => new ServiceUnavailableException({ statusCode: 503, error: 'Service Unavailable', code, message });

describe('고객에게 보일 확인 실패 사유 (T-222)', () => {
  it('구현 사정이 든 오류(Prisma·TypeError·일반 Error·문자열·없음·내부 판 기록 오류·4xx 입력 검증·등록 문구)는 고정 문구 — 원문 낱말이 남지 않는다', () => {
    const inputs: unknown[] = [
      prismaError(),
      new TypeError("Cannot read properties of undefined (reading 'mst')"),
      new Error('저장된 판(MST 123)을 법제처 판 목록에서 찾지 못했습니다'),
      'boom',
      undefined,
      null,
      new LawVersionDuplicateError('판 기록에 MST 1 이(가) 이미 있습니다 — 법령 행과 판 기록이 어긋났습니다(확인 필요).'),
      new NotFoundException('법령일련번호(MST)는 숫자여야 합니다.'),
      new BadRequestException('법제처 응답에 조문이 없어 등록할 수 없습니다 (MST=12). 별표·서식만 있는 문서일 수 있습니다.'),
      new HttpException({ code: 'SOMETHING_ELSE', message: '내부 사정' }, 400),
    ];
    for (const e of inputs) {
      const out = checkErrorForCustomer(e);
      expect(out, String(e)).toBe(CHECK_FAILED_FOR_CUSTOMER);
      expect(out).not.toMatch(/prisma|Invalid|invocation|TypeError|\/app\/|MST|등록할 수/);
    }
    // 다시 시도해도 풀리지 않는 실패에도 할 일이 있게 — 고정·법제처(5xx)·확인 시간 초과 문구 모두(2차 검토)
    for (const p of [CHECK_FAILED_FOR_CUSTOMER, LAWGOKR_FAILED_FOR_CUSTOMER, DEADLINE_FOR_CUSTOMER]) expect(p).toContain('계속되면 아스트룸에 문의하세요');
  });

  it('법제처 연결·응답 문제(HttpException 5xx)는 한 문구 — 법제처 쪽 글(잠시 뒤 다시 시도하세요·다시 검색해 주세요·영어 기본 글)을 옮기지 않는다', () => {
    for (const e of [
      new BadGatewayException('법제처에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.'),
      new BadGatewayException('법제처 목록을 온전히 받지 못했습니다. 잠시 뒤 다시 검색해 주세요.'),
      new BadGatewayException(),
      coded('UNKNOWN_CODE', '모르는 안내'),
      new HttpException('Gateway Timeout', 504),
    ]) {
      expect(checkErrorForCustomer(e), String(e)).toBe(LAWGOKR_FAILED_FOR_CUSTOMER);
    }
  });

  it('고객용으로 정해 둔 것은 그 문구 — 법제처 미설정·연결 거절(코드), 같은 법령이 따로 등록됨(LawVersionConflictError)', () => {
    expect(checkErrorForCustomer(coded('LAWGOKR_NOT_CONFIGURED', notConfigured))).toBe(notConfigured);
    expect(checkErrorForCustomer(coded('LAWGOKR_AUTH', refused))).toBe(refused);
    const conflict = '같은 법령이 따로 등록돼 있어 새 판(MST 7)을 반영하지 못했습니다 — 아스트룸에 문의하세요.';
    expect(checkErrorForCustomer(new LawVersionConflictError(conflict))).toBe(conflict);
  });

  it('비어 있는 문구는 돌려주지 않는다 — 확인 실패 판정(값이 있느냐)이 빈 값으로 성공처럼 보이지 않게', () => {
    expect(checkErrorForCustomer(coded('LAWGOKR_AUTH', '   '))).toBe(LAWGOKR_FAILED_FOR_CUSTOMER);
    expect(checkErrorForCustomer(new LawVersionConflictError(''))).toBe(CHECK_FAILED_FOR_CUSTOMER);
    for (const p of [CHECK_FAILED_FOR_CUSTOMER, LAWGOKR_FAILED_FOR_CUSTOMER, REPEALED_FOR_CUSTOMER]) expect(p.trim()).not.toBe('');
  });
});

describe('판 걷기 결과의 확인 실패 사유 — 허용 목록 (T-222)', () => {
  const raw = 'MST 12 반영 실패(반영한 판이 없습니다): Invalid prisma.law.update() invocation';
  it('판 반영 실패(failed)는 그 오류의 고객 문구 — 원인이 없거나 내부 오류면 고정 문구', () => {
    expect(walkCheckError({ kind: 'failed', mst: '12', message: 'Invalid…', cause: prismaError() }, raw)).toBe(CHECK_FAILED_FOR_CUSTOMER);
    expect(walkCheckError({ kind: 'failed', mst: '12', message: 'x' }, raw)).toBe(CHECK_FAILED_FOR_CUSTOMER);
    expect(walkCheckError({ kind: 'failed', mst: '12', message: 'x', cause: new BadGatewayException('법제처 응답을 읽지 못했습니다.') }, raw)).toBe(LAWGOKR_FAILED_FOR_CUSTOMER);
  });

  it('확인 시간 안에 하나도 반영하지 못함·폐지 판은 이 파일의 고객 문구(실행 결과의 남은 판 수·운영자용 글 대신), 그 밖의 갈래에 실린 글은 고정 문구, 실패가 아니면 null', () => {
    const timeout = '확인 시간 안에 새 판을 하나도 반영하지 못했습니다(남은 판 2개) — 다음 확인 때 다시 시도합니다.';
    expect(walkCheckError({ kind: 'deadline' }, timeout)).toBe(DEADLINE_FOR_CUSTOMER);
    expect(DEADLINE_FOR_CUSTOMER).toContain('확인 시간 안에');
    expect(walkCheckError({ kind: 'repeal', mst: '9' }, '폐지 판(MST 9)입니다 — 이벤트를 만들지 않았습니다(…). 추적 해제를 검토하세요.')).toBe(REPEALED_FOR_CUSTOMER);
    expect(walkCheckError({ kind: 'race', mst: '9', message: '법령이 더는 MST 8 을 가리키지 않습니다' }, '법령이 더는 MST 8 을 가리키지 않습니다')).toBe(CHECK_FAILED_FOR_CUSTOMER);
    expect(walkCheckError(undefined, null)).toBeNull();
    expect(walkCheckError({ kind: 'cap' }, undefined)).toBeNull();
  });
});

describe('동기화가 확인 기록과 이력에 나눠 남긴다 — 가짜 동기화로 (T-222)', () => {
  const checkError = (calls: { lawUpdates: any[] }) => calls.lawUpdates.find((d) => 'lastCheckError' in d && d.lastCheckError)?.lastCheckError;

  it('판 목록 받기가 법제처 연결 실패(502)로 끝나면 — 확인 기록은 법제처 고객 문구, 실행 결과(이력)는 원문', async () => {
    const { service, calls } = setup({ listFails: true, listError: new BadGatewayException('법제처에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.') });
    const run = await service.run({ trigger: 'manual' });
    expect(checkError(calls)).toBe(LAWGOKR_FAILED_FOR_CUSTOMER);
    expect(run.results[0]).toMatchObject({ outcome: 'failed', error: '법제처에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.' });
  });

  it('판 목록 받기가 연결 거절(코드 LAWGOKR_AUTH)로 끝나면 — 확인 기록은 그 안내 그대로', async () => {
    const { service, calls } = setup({ listFails: true, listError: coded('LAWGOKR_AUTH', refused) });
    await service.run({ trigger: 'manual' });
    expect(checkError(calls)).toBe(refused);
  });

  it('판 반영이 내부 문구(4xx 등록 문구)로 실패하면 — 확인 기록은 고정 문구, 결과는 MST·원문 그대로', async () => {
    const { service, calls } = setup({ failBody: '900300', bodyError: new BadRequestException('법제처 응답에 조문이 없어 등록할 수 없습니다 (MST=900300).') });
    const run = await service.run({ trigger: 'manual' });
    expect(checkError(calls)).toBe(CHECK_FAILED_FOR_CUSTOMER);
    expect(run.results[0].error).toContain('MST 900300 반영 실패');
    expect(run.results[0].error).toContain('조문이 없어');
  });

  it('판 반영이 법제처 응답 문제(502)로 실패하면 — 확인 기록은 법제처 고객 문구(판 걷기의 cause 로 고른다)', async () => {
    const { service, calls } = setup({ failBody: '900300', bodyError: new BadGatewayException('법제처 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.') });
    const run = await service.run({ trigger: 'manual' });
    expect(checkError(calls)).toBe(LAWGOKR_FAILED_FOR_CUSTOMER);
    expect(run.results[0].error).toContain('MST 900300 반영 실패'); // 판 걷기 안(applyChain)에서 실패했다 — catch 경로가 아니라 cause 로 골랐다
  });
});
