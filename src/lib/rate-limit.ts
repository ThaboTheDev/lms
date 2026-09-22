import { env } from './env';
import { getRedis } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitStore {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

/**
 * Single-process fixed window. Correct for one instance and for development.
 * Entries are swept as they are touched so a long-running process does not
 * accumulate a bucket per address seen.
 */
class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; expiresAt: number }>();
  private lastSweep = Date.now();

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      this.buckets.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    const retryAfterSeconds = Math.ceil((bucket.expiresAt - now) / 1000);
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds,
    };
  }

  async reset(key: string) {
    this.buckets.delete(key);
  }
}

/**
 * Shared fixed window across every instance. INCR and EXPIRE are issued in one
 * pipeline so two requests arriving together cannot both see a fresh counter.
 * A Redis failure allows the request rather than blocking it: a rate limiter
 * that takes the site down when its backing store hiccups is worse than a
 * limiter that briefly lets traffic through.
 */
class RedisStore implements RateLimitStore {
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redis = getRedis();
    if (!redis) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };

    try {
      const namespaced = `ratelimit:${key}`;
      const results = await redis
        .multi()
        .incr(namespaced)
        .ttl(namespaced)
        .exec();

      const count = Number(results?.[0]?.[1] ?? 1);
      let ttl = Number(results?.[1]?.[1] ?? -1);

      if (ttl < 0) {
        await redis.expire(namespaced, windowSeconds);
        ttl = windowSeconds;
      }

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: count > limit ? ttl : 0,
      };
    } catch (error) {
      console.error('[rate-limit] redis failed, allowing the request', error);
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }

  async reset(key: string) {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(`ratelimit:${key}`).catch(() => undefined);
  }
}

const memoryStore = new MemoryStore();
const redisStore = new RedisStore();

function store(): RateLimitStore {
  return env.RATE_LIMIT_DRIVER === 'redis' && getRedis() ? redisStore : memoryStore;
}

export function rateLimit(key: string, limit: number, windowSeconds: number) {
  return store().hit(`${env.NODE_ENV}:${key}`, limit, windowSeconds);
}

export function resetRateLimit(key: string) {
  return store().reset(`${env.NODE_ENV}:${key}`);
}
