/**
 * src/server/services/refunds.ts
 *
 * Money going back. A refund is requested by one finance officer and approved
 * by another, because returning money is where a single person acting alone
 * does the most damage. Processing records the refund as a negative journal
 * entry against the invoice, so the balance, the ageing and the audit trail
 * all see it, and the learner is told.
 */
import 'server-only';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { AppError, NotFoundError } from '@/lib/errors';
import { formatMoney, toCents } from '@/lib/money';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { refreshInvoice } from './finance';
import { notify } from './notifications';

export async function requestRefund(principal: Principal, input: { paymentId: string; amount: number; reason: string }) {
  requirePermission(principal, 'finance.manage');
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, institutionId: true, studentId: true, amount: true, status: true, refunds: { where: { status: { not: 'DECLINED' } }, select: { amount: true } } },
  });
  if (!payment) throw new NotFoundError('Payment');
  requireSameInstitution(principal, payment.institutionId);
  if (payment.status !== 'CLEARED') throw new AppError('Only a cleared payment can be refunded.', 409, 'not_refundable');

  const paid = toCents(String(payment.amount));
  const already = payment.refunds.reduce((sum, refund) => sum + toCents(String(refund.amount)), 0);
  const asked = Math.round(input.amount * 100);
  if (!(asked > 0)) throw new AppError('Enter the amount to refund.', 422, 'validation_failed', { amount: 'Enter the amount to refund.' });
  if (asked + already > paid) {
    throw new AppError(`At most ${formatMoney(paid - already)} of this payment can still be refunded.`, 422, 'validation_failed', { amount: 'More than was paid.' });
  }
  if (input.reason.trim().length < 5) throw new AppError('Record why the money is going back.', 422, 'validation_failed', { reason: 'Record the reason.' });

  const refund = await prisma.refund.create({
    data: { institutionId: payment.institutionId, studentId: payment.studentId, paymentId: payment.id, amount: asked / 100, reason: input.reason.trim(), requestedById: principal.userId },
  });
  await recordAudit(principal, { action: 'finance.refund_requested', entityType: 'Refund', entityId: refund.id, after: { amount: formatMoney(asked), reason: refund.reason } });
  return refund;
}

export async function decideRefund(principal: Principal, refundId: string, decision: 'APPROVED' | 'DECLINED' | 'PROCESSED') {
  requirePermission(principal, 'finance.manage');
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true, institutionId: true, status: true, amount: true, requestedById: true, reason: true, studentId: true,
      payment: { select: { id: true, invoiceId: true, method: true, reference: true } },
      student: { select: { userId: true } },
    },
  });
  if (!refund) throw new NotFoundError('Refund');
  requireSameInstitution(principal, refund.institutionId);

  if (decision === 'PROCESSED') {
    if (refund.status !== 'APPROVED') throw new AppError('Only an approved refund can be marked as paid out.', 409, 'invalid_transition');
    await prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refundId }, data: { status: 'PROCESSED', processedOn: new Date() } });
      // The money leaves as a negative journal entry, so the invoice balance re-derives.
      await tx.payment.create({
        data: {
          institutionId: refund.institutionId,
          studentId: refund.studentId,
          invoiceId: refund.payment?.invoiceId ?? null,
          amount: -Number(refund.amount),
          method: 'JOURNAL',
          reference: `Refund ${refund.id.slice(-8)}${refund.payment?.reference ? ` of ${refund.payment.reference}` : ''}`,
          paidOn: new Date(),
          status: 'CLEARED',
          recordedById: principal.userId,
        },
      });
    });
    if (refund.payment?.invoiceId) await refreshInvoice(refund.payment.invoiceId);
    await notify({
      userId: refund.student.userId,
      institutionId: refund.institutionId,
      type: 'payment.status',
      title: `Refund of ${formatMoney(toCents(String(refund.amount)))} paid out`,
      body: refund.reason,
      linkUrl: '/account',
    });
  } else {
    if (refund.status !== 'REQUESTED') throw new AppError('That refund has already been decided.', 409, 'invalid_transition');
    if (decision === 'APPROVED' && refund.requestedById === principal.userId) {
      throw new AppError('Somebody other than the person who asked for it has to approve a refund.', 403, 'four_eyes');
    }
    await prisma.refund.update({ where: { id: refundId }, data: { status: decision, approvedById: principal.userId } });
  }

  await recordAudit(principal, { action: `finance.refund_${decision.toLowerCase()}`, entityType: 'Refund', entityId: refundId, before: { status: refund.status }, after: { status: decision } });
}

export async function listRefunds(principal: Principal) {
  requirePermission(principal, 'finance.read');
  return prisma.refund.findMany({
    where: { institutionId: principal.institutionId ?? '', status: { in: ['REQUESTED', 'APPROVED'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, amount: true, reason: true, status: true, createdAt: true, requestedById: true,
      student: { select: { studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
      payment: { select: { reference: true, invoice: { select: { id: true, number: true } } } },
    },
  });
}
