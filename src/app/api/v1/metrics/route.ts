import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { toErrorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Operational figures for a monitoring system, behind a permission because they
 * describe the institution rather than the process. Counts only: nothing here
 * identifies a person.
 */
export async function GET() {
  try {
    const principal = await requirePrincipal();
    requirePermission(principal, 'report.read');
    const institutionId = principal.institutionId ?? undefined;

    const dayAgo = new Date(Date.now() - 86_400_000);

    const [
      activeSessions,
      failedLogins,
      pendingScans,
      unmarkedSubmissions,
      popQueue,
      overdueInvoices,
      auditWrites,
    ] = await Promise.all([
      prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: dayAgo } } }),
      prisma.fileObject.count({ where: { institutionId, scanStatus: 'PENDING' } }),
      prisma.submission.count({ where: { status: { in: ['SUBMITTED', 'LATE', 'UNDER_REVIEW'] } } }),
      prisma.proofOfPayment.count({
        where: { institutionId, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
      }),
      prisma.invoice.count({ where: { institutionId, status: 'OVERDUE' } }),
      prisma.auditLog.count({ where: { institutionId, createdAt: { gte: dayAgo } } }),
    ]);

    return NextResponse.json(
      {
        gauges: {
          active_sessions: activeSessions,
          files_awaiting_scan: pendingScans,
          submissions_awaiting_marking: unmarkedSubmissions,
          proof_of_payment_queue: popQueue,
          invoices_overdue: overdueInvoices,
        },
        last24h: {
          failed_sign_ins: failedLogins,
          audit_entries: auditWrites,
        },
        time: new Date().toISOString(),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
