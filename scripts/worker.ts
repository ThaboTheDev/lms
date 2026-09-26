/**
 * Background worker. Runs alongside the web process when QUEUE_DRIVER=redis and
 * consumes the same handlers the application registers, so a job behaves the
 * same whichever process picked it up.
 *
 *   npm run worker
 *
 * With QUEUE_DRIVER=memory this process is unnecessary: jobs run in the web
 * process, which is fine for one instance and for development.
 */
import { Queue, Worker } from 'bullmq';
import { getRedis } from '../src/lib/redis';
import { env } from '../src/lib/env';
import { getHandler, registeredJobs, type JobName } from '../src/lib/queue';
import { registerJobHandlers } from '../src/server/jobs';
import { SCHEDULE, SCHEDULE_TIMEZONE } from '../src/server/jobs/schedule';

registerJobHandlers();

async function main() {
  if (env.QUEUE_DRIVER !== 'redis') {
    console.log('QUEUE_DRIVER is not redis, so there is nothing for a worker to consume.');
    return;
  }

  const connection = getRedis();
  if (!connection) {
    console.error('REDIS_URL is not reachable. The worker cannot start.');
    process.exit(1);
  }

  const workers = registeredJobs().map((name: JobName) => {
    const worker = new Worker(
      name,
      async (job) => {
        const handler = getHandler(name);
        if (!handler) return;
        await handler(job.data as Record<string, unknown>);
      },
      { connection, concurrency: 5 },
    );

    worker.on('failed', (job, error) => {
      console.error(`[worker] ${name} failed on attempt ${job?.attemptsMade}`, error.message);
    });

    return worker;
  });

  console.log(`[worker] consuming ${workers.length} queues: ${registeredJobs().join(', ')}`);

  // Scheduled work. upsertJobScheduler is idempotent, so every worker can
  // register the same schedule at boot and Redis keeps exactly one of each.
  for (const entry of SCHEDULE) {
    const scheduler = new Queue(entry.name, { connection });
    await scheduler.upsertJobScheduler(
      `schedule:${entry.name}`,
      { pattern: entry.pattern, tz: SCHEDULE_TIMEZONE },
      { name: entry.name, data: {}, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } } },
    );
    await scheduler.close();
    console.log(`[worker] scheduled ${entry.name} (${entry.pattern}): ${entry.description}`);
  }

  const shutdown = async () => {
    console.log('[worker] draining');
    await Promise.all(workers.map((worker) => worker.close()));
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
