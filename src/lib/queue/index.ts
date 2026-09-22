import { env } from '@/lib/env';

export type JobName =
  | 'email.send'
  | 'certificate.generate'
  | 'transcript.generate'
  | 'analytics.recalculate'
  | 'atrisk.evaluate'
  | 'retention.sweep'
  | 'file.scan'
  | 'notification.fanout';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface QueueDriver {
  enqueue(name: JobName, payload: Record<string, unknown>, options?: { delayMs?: number }): Promise<void>;
}

const handlers = new Map<JobName, JobHandler>();

export function registerHandler(name: JobName, handler: JobHandler) {
  handlers.set(name, handler);
}

export function getHandler(name: JobName): JobHandler | undefined {
  return handlers.get(name);
}

export function registeredJobs(): JobName[] {
  return [...handlers.keys()];
}

/**
 * Runs the handler on the next tick, in this process. Correct for development
 * and for a single instance; work is lost if the process dies mid-job, which is
 * why production uses the Redis driver.
 */
const memoryDriver: QueueDriver = {
  async enqueue(name, payload, options) {
    const run = async () => {
      const handler = handlers.get(name);
      if (!handler) return console.warn(`[queue] no handler registered for ${name}`);
      try {
        await handler(payload);
      } catch (error) {
        console.error(`[queue] job ${name} failed`, error);
      }
    };
    setTimeout(run, options?.delayMs ?? 0);
  },
};

/**
 * Hands the job to BullMQ, which persists it in Redis and retries with backoff.
 * The worker process imports the same handlers, so a job behaves identically
 * whichever driver queued it.
 *
 * Enqueueing must not take a request down, so a failure here falls back to
 * running the job in process rather than throwing.
 */
const redisDriver: QueueDriver = {
  async enqueue(name, payload, options) {
    try {
      const { Queue } = await import('bullmq');
      const { getRedis } = await import('@/lib/redis');
      const connection = getRedis();
      if (!connection) return memoryDriver.enqueue(name, payload, options);

      const queue = new Queue(name, { connection });
      await queue.add(name, payload, {
        delay: options?.delayMs ?? 0,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 7 * 86_400 },
      });
    } catch (error) {
      console.error(`[queue] could not enqueue ${name}, running it in process`, error);
      await memoryDriver.enqueue(name, payload, options);
    }
  },
};

export const queue: QueueDriver = env.QUEUE_DRIVER === 'redis' ? redisDriver : memoryDriver;
