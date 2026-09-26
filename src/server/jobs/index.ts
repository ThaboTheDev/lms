import 'server-only';
import { prisma } from '@/lib/db';
import { mailer, type OutboundEmail } from '@/lib/mail';
import { registerHandler } from '@/lib/queue';
import { systemPrincipal } from '@/lib/rbac/system';
import { scanFile } from '@/lib/storage/scan';
import { deliverNotificationEmail, type NotifyInput } from '@/server/services/notifications';
import { resolveChannels } from '@/server/services/notification-rules';

/**
 * Background handlers. The in-process queue imports this module the first time
 * it dispatches, whichever route queued the job; the worker imports it at boot.
 * A job therefore behaves the same whichever driver queued it.
 */
let registered = false;

/** How long past its deadline an open attempt is left before the sweep submits it. */
const SWEEP_GRACE_MS = 2 * 60_000;

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

    await prisma.fileObject.update({
      where: { id: fileId },
      data: { scanStatus: result.verdict },
    });
  });

  registerHandler('email.send', async (payload) => {
    await deliverNotificationEmail(payload as unknown as NotifyInput);
  });

  /** Mail for people with no account to notify: applicants, invitations. */
  registerHandler('mail.send', async (payload) => {
    await mailer.send(payload as unknown as OutboundEmail);
  });

  /**
   * Email for a notice sent to many people. The in-app rows were written when
   * the notice went out; email follows each person's preference for that type
   * of notice, and is walked one at a time so one bad address cannot stop the rest.
   */
  registerHandler('notification.fanout', async (payload) => {
    const { institutionId, userIds, notice } = payload as unknown as {
      institutionId: string;
      userIds: string[];
      notice: Omit<NotifyInput, 'userId' | 'institutionId'>;
    };
    if (!Array.isArray(userIds) || !notice?.type) return;

    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type: notice.type },
      select: { userId: true, inApp: true, email: true, sms: true, push: true },
    });
    const byUser = new Map(preferences.map((row) => [row.userId, row]));

    for (const userId of userIds) {
      const preference = byUser.get(userId);
      const channels = resolveChannels(notice.type, preference ? { ...preference, type: notice.type } : null);
      if (!channels.includes('EMAIL')) continue;
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
   * Rebuilds the at-risk list for every active institution. Nightly rather than
   * per page load, because it reads across the whole cohort and support staff
   * work the list over days.
   */
  registerHandler('atrisk.evaluate', async () => {
    const { refreshAtRiskFlags } = await import('@/server/services/analytics');
    const institutions = await prisma.institution.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    for (const institution of institutions) {
      const { written } = await refreshAtRiskFlags(systemPrincipal(institution.id));
      console.info(`[jobs] at-risk: ${institution.name}: ${written} learners flagged for support`);
    }
  });

  /**
   * Submits timed attempts that were abandoned: the tab was closed, the laptop
   * shut, the connection lost. The browser submits when the clock runs out if
   * it is still open; this is for when it is not. The attempt is recorded as
   * submitted at its deadline with whatever was autosaved by then.
   */
  registerHandler('attempts.sweep', async () => {
    const { attemptDeadline } = await import('@/server/services/assessment-window');
    const { submitAttempt } = await import('@/server/services/submissions');

    const open = await prisma.submission.findMany({
      where: {
        status: 'IN_PROGRESS',
        assessment: { OR: [{ timeLimitMinutes: { not: null } }, { closesAt: { not: null } }] },
      },
      select: {
        id: true,
        startedAt: true,
        assessment: {
          select: {
            institutionId: true, status: true, opensAt: true, dueAt: true, closesAt: true,
            timeLimitMinutes: true, maxAttempts: true, allowLate: true,
          },
        },
      },
      take: 500,
    });

    const now = Date.now();
    let submitted = 0;
    for (const attempt of open) {
      const deadline = attemptDeadline(attempt.assessment, attempt.startedAt);
      if (!deadline || deadline.getTime() + SWEEP_GRACE_MS > now) continue;
      try {
        await submitAttempt(systemPrincipal(attempt.assessment.institutionId), attempt.id, true);
        submitted += 1;
      } catch (error) {
        console.warn('[jobs] could not submit abandoned attempt', attempt.id, error instanceof Error ? error.message : error);
      }
    }
    if (submitted > 0) console.info(`[jobs] submitted ${submitted} abandoned attempts`);
  });

  /**
   * Arrears. Invoice status is derived from the payments and the due date, so
   * an invoice that simply passed its due date needs re-deriving to read as
   * overdue; instalments past their date with money still owed are marked too.
   */
  registerHandler('invoices.arrears', async () => {
    const { refreshInvoice } = await import('@/server/services/finance');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const due = await prisma.invoice.findMany({
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueOn: { lt: today } },
      select: { id: true },
      take: 5000,
    });
    for (const invoice of due) await refreshInvoice(invoice.id);

    const instalments = await prisma.paymentPlanInstalment.updateMany({
      where: { status: { in: ['DUE', 'PARTIAL'] }, dueOn: { lt: today } },
      data: { status: 'OVERDUE' },
    });
    console.info(`[jobs] arrears: ${due.length} invoices re-derived, ${instalments.count} instalments now overdue`);
  });

  registerHandler('retention.sweep', async () => {
    console.info('[jobs] retention sweeps are run deliberately from the privacy screen');
  });
}

registerJobHandlers();
