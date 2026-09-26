import type { JobName } from '@/lib/queue';

/**
 * Work that runs on a clock rather than because somebody clicked something.
 * The worker registers these with BullMQ as job schedulers, which Redis keeps
 * across restarts and deduplicates across several workers. Times are in the
 * institution's own time zone.
 */
export const SCHEDULE: { name: JobName; pattern: string; description: string }[] = [
  { name: 'attempts.sweep', pattern: '*/5 * * * *', description: 'Submit timed attempts that were abandoned' },
  { name: 'atrisk.evaluate', pattern: '0 1 * * *', description: 'Rebuild the at-risk list' },
  { name: 'invoices.arrears', pattern: '0 2 * * *', description: 'Mark overdue invoices and instalments' },
  { name: 'files.rescan', pattern: '*/15 * * * *', description: 'Scan files the scanner missed or never saw' },
  { name: 'notifications.digest', pattern: '5 * * * *', description: 'Send daily and weekly notice summaries that are due' },
];

export const SCHEDULE_TIMEZONE = 'Africa/Johannesburg';
