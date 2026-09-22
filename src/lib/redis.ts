import 'server-only';
import Redis from 'ioredis';
import { env } from './env';

/**
 * One shared connection. Redis is optional: without REDIS_URL the rate limiter
 * and the queue fall back to their in-process versions, which are correct for a
 * single instance and for development.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis | null };

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (globalForRedis.redis !== undefined) return globalForRedis.redis;

  try {
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    client.on('error', (error) => console.error('[redis]', error.message));
    globalForRedis.redis = client;
    return client;
  } catch (error) {
    console.error('[redis] could not connect, falling back to in-process behaviour', error);
    globalForRedis.redis = null;
    return null;
  }
}

export function redisAvailable(): boolean {
  return getRedis() !== null;
}
