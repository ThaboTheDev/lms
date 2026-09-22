import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * Readiness. The orchestrator uses this to decide whether to send traffic here,
 * so it checks the things a request actually needs. Redis is reported but does
 * not fail the check: the rate limiter and the queue both degrade to their
 * in-process behaviour, which is worse but not broken.
 */
export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, { status: string; detail?: string; latencyMs?: number }> = {};

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: 'down',
      detail: error instanceof Error ? error.message : 'unreachable',
    };
  }

  if (env.REDIS_URL) {
    try {
      const redis = getRedis();
      const redisStart = Date.now();
      await redis?.ping();
      checks.redis = { status: redis ? 'ok' : 'unconfigured', latencyMs: Date.now() - redisStart };
    } catch {
      checks.redis = { status: 'degraded', detail: 'queue and rate limiting fall back in process' };
    }
  } else {
    checks.redis = { status: 'unconfigured', detail: 'running in single instance mode' };
  }

  const healthy = checks.database?.status === 'ok';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'unhealthy',
      checks,
      queueDriver: env.QUEUE_DRIVER,
      storageDriver: env.STORAGE_DRIVER,
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
