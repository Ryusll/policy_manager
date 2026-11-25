import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * 법제처 응답 캐시.
 *
 * 캐시가 필요한 이유는 속도보다 **호출량**이다. 법령 본문 한 건이 수백 KB(자동차관리법
 * 기준 약 750KB)이고, 가져오기 마법사는 같은 법령을 미리보기하는 동안 여러 번 조회한다.
 * 법제처는 인증값(OC)당 사용량을 제한하므로 그대로 흘려보내면 금방 막힌다.
 *
 * `REDIS_URL`이 있으면 Redis를, 없으면 프로세스 메모리를 쓴다. 로컬 `npm run dev`는
 * Redis 없이 도는 반면 Docker Compose에는 redis 서비스가 이미 떠 있어서, 둘 다 되게
 * 하지 않으면 개발자가 캐시를 통째로 꺼버리는 쪽으로 흐른다. 다만 메모리 캐시는
 * 인스턴스마다 따로 놀기 때문에 여러 대로 늘릴 때는 Redis가 사실상 필수다.
 */
@Injectable()
export class LawGoKrCache implements OnModuleDestroy {
  private readonly log = new Logger(LawGoKrCache.name);
  private readonly redis: Redis | null;
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  /** 메모리 폴백일 때만 의미가 있다. Redis는 TTL로 알아서 줄어든다. */
  private readonly memoryMaxEntries = 200;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.redis = null;
      this.log.log('REDIS_URL이 없어 법제처 응답을 프로세스 메모리에 캐싱합니다.');
      return;
    }
    this.redis = new Redis(url, {
      // 캐시일 뿐이므로 Redis가 죽어도 요청을 붙잡고 있으면 안 된다. 큐잉 없이 즉시 실패시킨다.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    // 이 리스너가 없으면 연결 실패 시 unhandled 'error' 이벤트로 프로세스가 죽는다.
    this.redis.on('error', (err) => {
      this.log.warn(`Redis 캐시 오류(무시하고 원본 호출로 진행): ${err?.message || err}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.readRaw(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch {
      return;
    }
    if (this.redis) {
      try {
        await this.redis.set(key, raw, 'EX', ttlSeconds);
        return;
      } catch (e: any) {
        this.log.warn(`Redis 쓰기 실패, 메모리로 대체: ${e?.message || e}`);
      }
    }
    if (this.memory.size >= this.memoryMaxEntries) {
      // 가장 오래 전에 넣은 항목부터 버린다(Map은 삽입 순서를 유지한다).
      const oldest = this.memory.keys().next();
      if (!oldest.done) this.memory.delete(oldest.value);
    }
    this.memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  private async readRaw(key: string): Promise<string | null> {
    if (this.redis) {
      try {
        return await this.redis.get(key);
      } catch (e: any) {
        this.log.warn(`Redis 읽기 실패, 원본 호출로 진행: ${e?.message || e}`);
        return null;
      }
    }
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value;
  }
}
