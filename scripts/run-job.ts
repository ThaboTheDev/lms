/**
 * Runs one background job now, in this process, and exits. For operators, for
 * cron on a host without the worker, and for checking a job by hand:
 *
 *   npm run job -- atrisk.evaluate
 *   npm run job -- attempts.sweep
 *   npm run job -- invoices.arrears
 */
import { getHandler, registeredJobs, type JobName } from '../src/lib/queue';
import { registerJobHandlers } from '../src/server/jobs';

async function main() {
  registerJobHandlers();
  const name = process.argv[2] as JobName | undefined;
  const handler = name ? getHandler(name) : undefined;
  if (!name || !handler) {
    console.error(`Usage: npm run job -- <name>\nJobs: ${registeredJobs().join(', ')}`);
    process.exit(2);
  }
  const payload = process.argv[3] ? (JSON.parse(process.argv[3]) as Record<string, unknown>) : {};
  await handler(payload);
  console.log(`[job] ${name} finished`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
