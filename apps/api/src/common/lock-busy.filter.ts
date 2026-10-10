import { ArgumentsHost, Catch, ConflictException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { LOCK_BUSY_MESSAGE, LockBusyException } from './row-locks';

export const TX_BUSY_MESSAGE = '요청이 몰려 처리를 시작하지 못했습니다 — 잠시 뒤 다시 시도하세요.';

/**
 * 잠금 다툼을 다시 시도할 수 있는 응답으로 바꾸고 남긴다(T-131).
 *
 * 잠금 도우미(`common/row-locks`)는 명시적 잠금을 정해진 시간 안에 못 잡으면 `LockBusyException`(409)을 던진다 — 여기서 어느 잠금을
 * 얼마나 기다렸는지 경고로 남긴다. 그 뒤의 암묵적 대기(행 UPDATE·FK 확인)나 도우미를 거치지 않는 쓰기에서 같은 일이 나면 Prisma
 * 오류로 올라오므로 같은 409 로 바꾼다.
 * - 잠금을 못 잡음(55P03)·교착(40P01, Prisma P2034) → 409 `LOCK_BUSY_MESSAGE`. 교착은 잠금 순서가 어긋났다는 뜻이라 오류로 남긴다
 * - 트랜잭션을 시작하지 못함(P2028 "Unable to start a transaction" — 커넥션을 못 얻어 아무것도 하지 않았다) → 503
 * 그 밖의 Prisma 오류(트랜잭션 제한을 넘김·커넥션 대기 초과 P2024 처럼 이미 일부를 했을 수 있는 것 포함)는 지금처럼 기본 처리(500, 오류 로그)
 */
export function lockBusyException(e: unknown): HttpException | null {
  const known = e instanceof Prisma.PrismaClientKnownRequestError ? e : null;
  const dbCode = (known?.meta as { code?: string } | undefined)?.code;
  const message = e instanceof Error ? e.message : '';
  if (known?.code === 'P2034' || dbCode === '55P03' || dbCode === '40P01' || /\b(?:55P03|40P01)\b|lock timeout|deadlock detected/i.test(message)) {
    return new ConflictException(LOCK_BUSY_MESSAGE);
  }
  if (known?.code === 'P2028' && /unable to start a transaction/i.test(message)) return new ServiceUnavailableException(TX_BUSY_MESSAGE);
  return null;
}

/** 교착 — 잠금 순서가 어긋났다는 뜻 */
const isDeadlock = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.meta as { code?: string } | undefined)?.code === '40P01')) ||
  (e instanceof Error && /\b40P01\b|deadlock detected/i.test(e.message));

@Catch(LockBusyException, Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError)
export class LockBusyFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('LockBusy');

  catch(exception: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string; route?: { path?: string } }>();
    // 경로는 쿼리 없이 — 쿼리에 개인정보가 실릴 수 있다
    const where = `${req?.method ?? ''} ${req?.route?.path ?? (req?.originalUrl ?? req?.url ?? '').split('?')[0]}`;
    if (exception instanceof LockBusyException) {
      this.logger.warn(`409 ${where} — ${exception.lock} 잠금을 ${exception.waitMs}ms 안에 못 잡음`);
      return super.catch(exception, host);
    }
    const mapped = lockBusyException(exception);
    if (!mapped) return super.catch(exception, host);
    const code =
      exception instanceof Prisma.PrismaClientKnownRequestError
        ? `${exception.code}${(exception.meta as { code?: string } | undefined)?.code ? `/${(exception.meta as { code?: string }).code}` : ''}`
        : 'unknown';
    const summary = (exception instanceof Error ? exception.message : '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
    if (isDeadlock(exception)) {
      this.logger.error(`${mapped.getStatus()} ${where} — 교착(${code}): ${exception instanceof Error ? exception.message : ''}`);
    } else {
      this.logger.warn(`${mapped.getStatus()} ${where} — ${code}: ${summary.slice(0, 200)}`);
    }
    return super.catch(mapped, host);
  }
}
