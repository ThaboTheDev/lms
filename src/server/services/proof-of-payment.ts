import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { toCents } from '@/lib/money';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { notify } from './notifications';
import { recordPayment } from './finance';
import {
  OPEN_POP_STATUSES,
  findDuplicates,
  findPopTransition,
  normaliseReference,
  reviewFlags,
  type PopCandidate,
  type PopStatus,
} from './pop-workflow';

/**
 * A learner uploads proof that money was sent. Nothing is credited here: the
 * document goes into the review queue, and the payment is only created when a
 * finance officer approves it, because a screenshot is a claim rather than a
 * receipt.
 */
export async function submitProofOfPayment(
  principal: Principal,
  input: { fileId: string; declaredAmount: number; declaredDate: Date; reference?: string; invoiceId?: string },
) {
  if (!principal.studentId) throw new AppError('Only a learner uploads a proof of payment.', 403, 'not_a_learner');
  requirePermission(principal, 'pop.submit');

  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const file = await prisma.fileObject.findFirst({
    where: { id: input.fileId, uploadedById: principal.userId },
    select: { id: true },
  });
  if (!file) throw new AppError('Upload the document first.', 422, 'file_missing');

  const amount = toCents(input.declaredAmount);
  if (amount <= 0) throw new AppError('Enter the amount you paid.', 422, 'invalid_amount');

  const pop = await prisma.proofOfPayment.create({
    data: {
      institutionId,
      studentId: principal.studentId,
      invoiceId: input.invoiceId || null,
      fileId: input.fileId,
      declaredAmount: amount / 100,
      declaredDate: input.declaredDate,
      reference: input.reference?.trim() || null,
      status: 'PENDING',
    },
    select: { id: true },
  });

  return pop;
}

export interface PopFilters {
  query?: string;
  status?: string;
  from?: Date;
  to?: Date;
  reviewerId?: string;
  programmeId?: string;
}

/**
 * The review queue. Built for volume: every filter is indexed, the page is
 * bounded, and the search covers the three things a reviewer actually has in
 * front of them, which are a name, a student number and a bank reference.
 */
export async function listProofsOfPayment(
  principal: Principal,
  filters: PopFilters,
  paging: { skip: number; perPage: number },
) {
  requirePermission(principal, 'pop.review');

  const where = {
    institutionId: principal.institutionId ?? undefined,
    ...(filters.status
      ? { status: filters.status as never }
      : { status: { in: OPEN_POP_STATUSES as never } }),
    ...(filters.reviewerId ? { reviewerId: filters.reviewerId } : {}),
    ...(filters.from || filters.to
      ? {
          submittedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.programmeId
      ? { student: { programmeEnrolments: { some: { programmeId: filters.programmeId } } } }
      : {}),
    ...(filters.query
      ? {
          OR: [
            { reference: { contains: filters.query, mode: 'insensitive' as const } },
            { student: { studentNumber: { contains: filters.query } } },
            { student: { user: { lastName: { contains: filters.query, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  const [total, items, counts] = await Promise.all([
    prisma.proofOfPayment.count({ where: where as never }),
    prisma.proofOfPayment.findMany({
      where: where as never,
      skip: paging.skip,
      take: paging.perPage,
      // Oldest first: a queue that is worked newest first leaves the earliest
      // submissions waiting longest, which is exactly backwards.
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true, status: true, declaredAmount: true, declaredDate: true, reference: true,
        submittedAt: true, reviewedAt: true, reviewNotes: true,
        student: {
          select: {
            id: true, studentNumber: true,
            user: { select: { firstName: true, lastName: true } },
            programmeEnrolments: {
              take: 1,
              orderBy: { enrolledOn: 'desc' },
              select: { programme: { select: { code: true } } },
            },
          },
        },
        invoice: { select: { id: true, number: true, balance: true } },
        reviewer: { select: { firstName: true, lastName: true } },
        file: { select: { id: true, originalName: true, mimeType: true } },
      },
    }),
    prisma.proofOfPayment.groupBy({
      by: ['status'],
      where: { institutionId: principal.institutionId ?? undefined },
      _count: { _all: true },
    }),
  ]);

  return {
    total,
    items,
    counts: (counts as { status: string; _count: { _all: number } }[]).map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
  };
}

export async function loadProofOfPayment(principal: Principal, popId: string) {
  const pop = await prisma.proofOfPayment.findUnique({
    where: { id: popId },
    select: {
      id: true, institutionId: true, status: true, declaredAmount: true, declaredDate: true,
      reference: true, submittedAt: true, reviewedAt: true, reviewNotes: true, paymentId: true,
      student: {
        select: {
          id: true, studentNumber: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      },
      invoice: { select: { id: true, number: true, balance: true, total: true } },
      file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true } },
      reviewer: { select: { firstName: true, lastName: true } },
    },
  });
  if (!pop) throw new NotFoundError('Proof of payment');

  const isOwner = principal.studentId === pop.student.id;
  if (!isOwner) {
    requireSameInstitution(principal, pop.institutionId);
    requirePermission(principal, 'pop.review', { institutionId: pop.institutionId });
  }

  // Candidates are narrowed by reference or amount before comparison, so the
  // duplicate check stays cheap with a hundred thousand documents on file.
  const candidates = await prisma.proofOfPayment.findMany({
    where: {
      institutionId: pop.institutionId,
      id: { not: popId },
      OR: [
        ...(pop.reference ? [{ reference: { contains: normaliseReference(pop.reference).slice(0, 6) } }] : []),
        { studentId: pop.student.id },
        { declaredAmount: pop.declaredAmount },
      ],
    },
    take: 50,
    select: { id: true, studentId: true, declaredAmount: true, declaredDate: true, reference: true, status: true },
  });

  const subject: PopCandidate = {
    id: pop.id,
    studentId: pop.student.id,
    declaredAmount: toCents(String(pop.declaredAmount)),
    declaredDate: pop.declaredDate,
    reference: pop.reference,
    status: pop.status as PopStatus,
  };

  const duplicates = findDuplicates(
    subject,
    (candidates as { id: string; studentId: string; declaredAmount: unknown; declaredDate: Date; reference: string | null; status: string }[]).map(
      (candidate) => ({
        id: candidate.id,
        studentId: candidate.studentId,
        declaredAmount: toCents(String(candidate.declaredAmount)),
        declaredDate: candidate.declaredDate,
        reference: candidate.reference,
        status: candidate.status as PopStatus,
      }),
    ),
  );

  const flags = reviewFlags(
    { declaredAmount: subject.declaredAmount, declaredDate: pop.declaredDate, reference: pop.reference },
    {
      invoiceBalance: pop.invoice ? toCents(String(pop.invoice.balance)) : null,
      duplicates,
      submittedAt: pop.submittedAt,
    },
  );

  return { pop, duplicates, flags };
}

export interface ReviewInput {
  status: PopStatus;
  note?: string;
  /** Approving may credit a different figure from the one the learner declared. */
  amount?: number;
  paymentMethod?: string;
}

/**
 * Reviews one document. Approval is the only path that creates money, and it
 * does so through the ordinary payment service, so an approved proof produces a
 * receipt and an audit entry exactly like a payment captured at the counter.
 */
export async function reviewProofOfPayment(principal: Principal, popId: string, input: ReviewInput) {
  const pop = await prisma.proofOfPayment.findUnique({
    where: { id: popId },
    select: {
      id: true, institutionId: true, status: true, studentId: true, invoiceId: true,
      declaredAmount: true, declaredDate: true, reference: true, paymentId: true,
      student: { select: { studentNumber: true, userId: true } },
    },
  });
  if (!pop) throw new NotFoundError('Proof of payment');

  requireSameInstitution(principal, pop.institutionId);
  requirePermission(principal, 'pop.review', { institutionId: pop.institutionId });

  const rule = findPopTransition(pop.status as PopStatus, input.status);
  if (!rule) {
    throw new AppError(
      `A document that is ${pop.status.toLowerCase().replace(/_/g, ' ')} cannot be moved to ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
      409,
      'invalid_transition',
    );
  }
  if (rule.requiresNote && !input.note?.trim()) {
    throw new AppError('Record why, so the learner knows what to do next.', 422, 'note_required');
  }

  let paymentId = pop.paymentId;
  let receiptNumber: string | null = null;

  if (input.status === 'APPROVED' && !paymentId) {
    const result = await recordPayment(principal, {
      studentId: pop.studentId,
      invoiceId: pop.invoiceId ?? undefined,
      amount: input.amount ?? Number(pop.declaredAmount),
      method: (input.paymentMethod as never) ?? 'EFT',
      reference: pop.reference ?? undefined,
      paidOn: pop.declaredDate,
      popId: pop.id,
    });
    paymentId = result.paymentId;
    receiptNumber = result.receiptNumber;
  }

  await prisma.proofOfPayment.update({
    where: { id: popId },
    data: {
      status: input.status as never,
      reviewerId: principal.userId,
      reviewedAt: new Date(),
      reviewNotes: input.note?.trim() || null,
      ...(paymentId ? { paymentId } : {}),
    },
  });

  await recordAudit(principal, {
    action: 'finance.pop_reviewed',
    entityType: 'ProofOfPayment',
    entityId: popId,
    institutionId: pop.institutionId,
    before: { status: pop.status },
    after: {
      status: input.status,
      studentNumber: pop.student.studentNumber,
      amount: input.amount ?? Number(pop.declaredAmount),
      receipt: receiptNumber,
    },
  });

  // The payment service already told the learner about an approved payment, so
  // only the other outcomes are announced here.
  if (input.status !== 'APPROVED') {
    await notify({
      userId: pop.student.userId,
      institutionId: pop.institutionId,
      type: 'payment.status',
      title: `Your proof of payment: ${input.status.toLowerCase().replace(/_/g, ' ')}`,
      body: input.note?.trim() || 'Open your account for the detail.',
      linkUrl: '/account',
    });
  }

  return { status: input.status, receiptNumber };
}

/**
 * Takes the next unassigned document in the queue. Claiming prevents two
 * officers reviewing the same proof at the same time, which at intake volumes
 * happens within minutes.
 */
export async function claimNext(principal: Principal) {
  requirePermission(principal, 'pop.review');

  const next = await prisma.proofOfPayment.findFirst({
    where: {
      institutionId: principal.institutionId ?? undefined,
      status: 'PENDING',
      reviewerId: null,
    },
    orderBy: { submittedAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;

  await prisma.proofOfPayment.update({
    where: { id: next.id },
    data: { status: 'UNDER_REVIEW', reviewerId: principal.userId },
  });

  return next.id;
}
