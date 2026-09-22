import 'server-only';
import { prisma } from '@/lib/db';
import { registerHandler } from '@/lib/queue';
import { scanFile } from '@/lib/storage/scan';
import { deliverNotificationEmail, type NotifyInput } from '@/server/services/notifications';

/**
 * Background handlers. Imported once at boot so the in-process queue has
 * something to dispatch to; the worker process imports the same module, so a
 * job behaves identically whichever driver queued it.
 */
let registered = false;

export function registerJobHandlers() {
  if (registered) return;
  registered = true;

  /**
   * Malware scan. The file stays PENDING until a verdict comes back, and
   * nothing downstream serves a file that came back INFECTED. With no scanner
   * configured the verdict is SKIPPED rather than CLEAN, because an institution
   * asked at an audit what it checked should be able to answer honestly.
   */
  registerHandler('file.scan', async (payload) => {
    const fileId = String(payload.fileId ?? '');
    if (!fileId) return;

    const file = await prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { id: true, storageKey: true },
    });
    if (!file) return;

    const result = await scanFile(file.storageKey);

    // A scanner that was unreachable leaves the file PENDING so the next sweep
    // picks it up, rather than recording a verdict nobody reached.
    if (result.verdict === 'FAILED') {
      console.warn('[scan] could not scan', file.storageKey, result.detail);
      return;
    }

    // Every remaining verdict - CLEAN, INFECTED, SKIPPED - is a ScanStatus, so
    // this is the one place the file stops being PENDING.
    await prisma.fileObject.update({
      where: { id: fileId },
      data: { scanStatus: result.verdict },
    });
  });

  registerHandler('email.send', async (payload) => {
    await deliverNotificationEmail(payload as unknown as NotifyInput);
  });

  /**
   * Email for an audience-wide notice. Walked one at a time so one bad address
   * cannot stop the rest.
   *
   * TODO(phase-10): batch these with buildDigests and pace them against the
   * mail provider's rate limit once the deployment target is known.
   */
  registerHandler('notification.fanout', async (payload) => {
    const { institutionId, userIds, notice } = payload as unknown as {
      institutionId: string;
      userIds: string[];
      notice: Omit<NotifyInput, 'userId' | 'institutionId'>;
    };
    if (!Array.isArray(userIds)) return;

    for (const userId of userIds) {
      await deliverNotificationEmail({ ...notice, userId, institutionId });
    }
  });

  /**
   * Course progress rollup. Cheap enough to run inline when a lesson is
   * completed; queued as well so a missed update heals on the next pass.
   */
  registerHandler('analytics.recalculate', async (payload) => {
    const studentId = String(payload.studentId ?? '');
    const offeringId = String(payload.offeringId ?? '');
    if (!studentId || !offeringId) return;

    const { recalculateCourseProgress } = await import('@/server/services/learning');
    await recalculateCourseProgress(studentId, offeringId);
  });

  /**
   * Refreshes the at-risk list for every institution. Scheduled nightly rather
   * than computed per page load, because it reads across the whole cohort.
   */
  registerHandler('atrisk.evaluate', async () => {
    console.info('[jobs] at-risk evaluation runs from the scheduled worker; see scripts/worker.ts');
  });

  registerHandler('retention.sweep', async () => {
    console.info('[jobs] retention sweeps are run deliberately from the privacy screen');
  });
}

registerJobHandlers();
