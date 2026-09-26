import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { sum, toCents, type Cents } from '@/lib/money';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { notify } from './notifications';
import {
  ageDebt,
  buildInstalments,
  calculateInvoice,
  deriveStatus,
  planArrears,
  type DiscountInput,
  type LineInput,
} from './invoicing-rules';

/** Sequential, gapless references per institution and year, as for student numbers. */
async function allocateNumber(institutionId: string, kind: 'INV' | 'REC', year: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${institutionId}:${year}`}))`;

    const prefix = `${kind}-${year}-`;
    const latest =
      kind === 'INV'
        ? await tx.invoice.findFirst({
            where: { institutionId, number: { startsWith: prefix } },
            orderBy: { number: 'desc' },
            select: { number: true },
          })
        : await tx.receipt.findFirst({
            where: { institutionId, number: { startsWith: prefix } },
            orderBy: { number: 'desc' },
            select: { number: true },
          });

    const last = latest ? Number(latest.number.slice(prefix.length)) : 0;
    return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(6, '0')}`;
  });
}

/* --------------------------------------------------------- fee structures */

export async function listFees(principal: Principal) {
  requirePermission(principal, 'finance.read');

  return prisma.feeStructure.findMany({
    where: { institutionId: principal.institutionId ?? undefined },
    orderBy: [{ feeType: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, feeType: true, amount: true, currency: true, isActive: true,
      programme: { select: { code: true } },
      course: { select: { code: true } },
      academicYear: { select: { label: true } },
    },
  });
}

export async function createFee(
  principal: Principal,
  input: {
    name: string;
    feeType: string;
    amount: number;
    programmeId?: string;
    courseId?: string;
    academicYearId?: string;
  },
) {
  requirePermission(principal, 'finance.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const fee = await prisma.feeStructure.create({
    data: {
      institutionId,
      name: input.name.trim(),
      feeType: input.feeType as never,
      amount: input.amount,
      programmeId: input.programmeId || null,
      courseId: input.courseId || null,
      academicYearId: input.academicYearId || null,
    },
  });

  await recordAudit(principal, {
    action: 'finance.fee_created',
    entityType: 'FeeStructure',
    entityId: fee.id,
    after: { name: fee.name, feeType: input.feeType, amount: input.amount },
  });

  return fee;
}

/* ---------------------------------------------------------------- invoices */

export interface InvoiceDraft {
  studentId: string;
  academicYearId?: string;
  dueOn?: Date | null;
  notes?: string;
  lines: { description: string; feeType: string; quantity: number; unitAmount: number }[];
  discounts?: DiscountInput[];
  issue?: boolean;
}

/**
 * Creates an invoice. The totals are computed by the pure rules rather than by
 * the caller, so a figure typed into a form cannot disagree with the lines that
 * are supposed to add up to it.
 */
export async function createInvoice(principal: Principal, draft: InvoiceDraft) {
  requirePermission(principal, 'finance.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const student = await prisma.studentProfile.findFirst({
    where: { id: draft.studentId, institutionId },
    select: { id: true, studentNumber: true, userId: true },
  });
  if (!student) throw new NotFoundError('Student');
  if (draft.lines.length === 0) {
    throw new AppError('An invoice needs at least one line.', 422, 'no_lines');
  }

  const lineInputs: LineInput[] = draft.lines.map((line) => ({
    description: line.description,
    feeType: line.feeType,
    quantity: line.quantity,
    unitAmount: toCents(line.unitAmount),
  }));

  const totals = calculateInvoice(lineInputs, draft.discounts ?? []);
  const issuedOn = new Date();
  const number = await allocateNumber(institutionId, 'INV', issuedOn.getFullYear());

  const invoice = await prisma.invoice.create({
    data: {
      institutionId,
      studentId: draft.studentId,
      number,
      academicYearId: draft.academicYearId || null,
      status: draft.issue === false ? 'DRAFT' : 'ISSUED',
      issuedOn,
      dueOn: draft.dueOn ?? null,
      subtotal: totals.subtotal / 100,
      discountTotal: totals.discountTotal / 100,
      total: totals.total / 100,
      balance: totals.total / 100,
      notes: draft.notes || null,
      lines: {
        create: totals.lines.map((line) => ({
          description: line.description,
          feeType: line.feeType as never,
          quantity: line.quantity,
          unitAmount: line.unitAmount / 100,
          lineTotal: line.lineTotal / 100,
        })),
      },
    },
    select: { id: true, number: true, total: true },
  });

  await recordAudit(principal, {
    action: 'finance.invoice_created',
    entityType: 'Invoice',
    entityId: invoice.id,
    institutionId,
    after: {
      number: invoice.number,
      studentNumber: student.studentNumber,
      total: totals.total / 100,
      discounts: totals.appliedDiscounts,
    },
  });

  if (draft.issue !== false) {
    await notify({
      userId: student.userId,
      institutionId,
      type: 'payment.status',
      title: `Invoice ${invoice.number}`,
      body: `An invoice for R${(totals.total / 100).toFixed(2)} has been added to your account.`,
      linkUrl: '/account',
    });
  }

  return invoice;
}

/** Recomputes the balance and status from the payments actually recorded. */
export async function refreshInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, total: true, dueOn: true, status: true,
      payments: { where: { status: 'CLEARED' }, select: { amount: true } },
    },
  });
  if (!invoice) return null;

  const paid = sum(invoice.payments.map((payment: { amount: unknown }) => toCents(String(payment.amount))));
  const result = deriveStatus({
    total: toCents(String(invoice.total)),
    paid,
    dueOn: invoice.dueOn,
    issued: invoice.status !== 'DRAFT',
    cancelled: invoice.status === 'CANCELLED',
    writtenOff: invoice.status === 'WRITTEN_OFF',
  });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { balance: result.balance / 100, status: result.status as never },
  });

  return result;
}

export async function listInvoices(
  principal: Principal,
  filters: { query?: string; status?: string; studentId?: string },
  paging: { skip: number; perPage: number },
) {
  requirePermission(principal, 'finance.read');

  const where = {
    institutionId: principal.institutionId ?? undefined,
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.studentId ? { studentId: filters.studentId } : {}),
    ...(filters.query
      ? {
          OR: [
            { number: { contains: filters.query, mode: 'insensitive' as const } },
            { student: { studentNumber: { contains: filters.query } } },
            { student: { user: { lastName: { contains: filters.query, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where: where as never }),
    prisma.invoice.findMany({
      where: where as never,
      skip: paging.skip,
      take: paging.perPage,
      orderBy: { issuedOn: 'desc' },
      select: {
        id: true, number: true, status: true, issuedOn: true, dueOn: true,
        total: true, balance: true, currency: true,
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
  ]);

  return { total, invoices };
}

export async function loadInvoice(principal: Principal, invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, institutionId: true, number: true, status: true, issuedOn: true, dueOn: true,
      subtotal: true, discountTotal: true, total: true, balance: true, currency: true, notes: true,
      student: {
        select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
      lines: { select: { id: true, description: true, feeType: true, quantity: true, unitAmount: true, lineTotal: true } },
      payments: {
        orderBy: { paidOn: 'desc' },
        select: {
          id: true, amount: true, method: true, reference: true, paidOn: true, status: true,
          receipt: { select: { id: true, number: true } },
        },
      },
      pops: {
        orderBy: { submittedAt: 'desc' },
        select: { id: true, status: true, declaredAmount: true, declaredDate: true, submittedAt: true },
      },
      plans: {
        select: {
          id: true, name: true, status: true,
          instalmentList: { orderBy: { dueOn: 'asc' }, select: { id: true, dueOn: true, amount: true, paidAmount: true, status: true } },
        },
      },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice');

  const isOwner = principal.studentId === invoice.student.id;
  if (!isOwner) {
    requireSameInstitution(principal, invoice.institutionId);
    requirePermission(principal, 'finance.read', { institutionId: invoice.institutionId });
  }

  const plan = invoice.plans[0];
  const arrears = plan
    ? planArrears(
        plan.instalmentList.map((instalment: { dueOn: Date; amount: unknown; paidAmount: unknown }) => ({
          dueOn: instalment.dueOn,
          amount: toCents(String(instalment.amount)),
          paidAmount: toCents(String(instalment.paidAmount)),
        })),
      )
    : null;

  return { invoice, arrears };
}

/* ---------------------------------------------------------------- payments */

export interface PaymentInput {
  studentId: string;
  invoiceId?: string;
  amount: number;
  method: string;
  reference?: string;
  paidOn: Date;
  popId?: string;
}

/**
 * Records money received and issues its receipt in the same transaction. A
 * payment without a receipt is the thing a learner cannot prove, so the two are
 * never separated.
 */
export async function recordPayment(principal: Principal, input: PaymentInput) {
  requirePermission(principal, 'finance.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const student = await prisma.studentProfile.findFirst({
    where: { id: input.studentId, institutionId },
    select: { id: true, studentNumber: true, userId: true },
  });
  if (!student) throw new NotFoundError('Student');

  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new AppError('A payment has to be more than zero.', 422, 'invalid_amount');

  const receiptNumber = await allocateNumber(institutionId, 'REC', input.paidOn.getFullYear());

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        institutionId,
        studentId: input.studentId,
        invoiceId: input.invoiceId || null,
        amount: amountCents / 100,
        method: input.method as never,
        reference: input.reference || null,
        paidOn: input.paidOn,
        status: 'CLEARED',
        recordedById: principal.userId,
      },
      select: { id: true },
    });

    await tx.receipt.create({
      data: { institutionId, paymentId: created.id, number: receiptNumber },
    });

    if (input.popId) {
      await tx.proofOfPayment.update({
        where: { id: input.popId },
        data: { paymentId: created.id },
      });
    }

    return created;
  });

  if (input.invoiceId) await refreshInvoice(input.invoiceId);

  await recordAudit(principal, {
    action: 'finance.payment_recorded',
    entityType: 'Payment',
    entityId: payment.id,
    institutionId,
    after: {
      studentNumber: student.studentNumber,
      amount: amountCents / 100,
      method: input.method,
      reference: input.reference ?? null,
      receipt: receiptNumber,
    },
  });

  await notify({
    userId: student.userId,
    institutionId,
    type: 'payment.status',
    title: `Payment received: receipt ${receiptNumber}`,
    body: `R${(amountCents / 100).toFixed(2)} has been credited to your account.`,
    linkUrl: '/account',
  });

  return { paymentId: payment.id, receiptNumber };
}

/* ------------------------------------------------------------- statements */

/** A learner's account: invoices, payments and what is owed. */
export async function loadAccount(principal: Principal, studentId: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: {
      id: true, institutionId: true, studentNumber: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!student) throw new NotFoundError('Student');

  const isOwner = principal.studentId === studentId;
  if (!isOwner) {
    requireSameInstitution(principal, student.institutionId);
    requirePermission(principal, 'finance.read', { institutionId: student.institutionId });
  }

  const [invoices, payments, pops] = await Promise.all([
    prisma.invoice.findMany({
      where: { studentId, status: { notIn: ['CANCELLED'] } },
      orderBy: { issuedOn: 'desc' },
      select: { id: true, number: true, status: true, issuedOn: true, dueOn: true, total: true, balance: true },
    }),
    prisma.payment.findMany({
      where: { studentId, status: 'CLEARED' },
      orderBy: { paidOn: 'desc' },
      select: {
        id: true, amount: true, method: true, reference: true, paidOn: true,
        receipt: { select: { id: true, number: true } },
      },
    }),
    prisma.proofOfPayment.findMany({
      where: { studentId },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, status: true, declaredAmount: true, declaredDate: true, submittedAt: true, reviewNotes: true },
    }),
  ]);

  const balances: { balance: Cents; dueOn: Date | null }[] = invoices.map(
    (invoice: { balance: unknown; dueOn: Date | null }) => ({
      balance: toCents(String(invoice.balance)),
      dueOn: invoice.dueOn,
    }),
  );

  return {
    student,
    invoices,
    payments,
    pops,
    outstanding: sum(balances.map((entry) => Math.max(0, entry.balance))),
    ageing: ageDebt(balances),
  };
}

/** Institution-wide figures for the finance dashboard. */
export async function financeOverview(principal: Principal) {
  requirePermission(principal, 'finance.read');
  const institutionId = principal.institutionId ?? undefined;

  const [collected, invoiceRows, pendingPops] = await Promise.all([
    prisma.payment.aggregate({
      where: { institutionId, status: 'CLEARED' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.findMany({
      where: { institutionId, status: { notIn: ['CANCELLED', 'DRAFT', 'WRITTEN_OFF'] } },
      select: { balance: true, dueOn: true },
    }),
    prisma.proofOfPayment.count({
      where: { institutionId, status: { in: ['PENDING', 'UNDER_REVIEW', 'NEEDS_CLARIFICATION'] } },
    }),
  ]);

  const balances = (invoiceRows as { balance: unknown; dueOn: Date | null }[]).map((invoice) => ({
    balance: toCents(String(invoice.balance)),
    dueOn: invoice.dueOn,
  }));

  return {
    collectedCents: toCents(String(collected._sum.amount ?? 0)),
    paymentCount: collected._count._all,
    outstandingCents: sum(balances.map((entry) => Math.max(0, entry.balance))),
    ageing: ageDebt(balances),
    pendingPops,
  };
}

/* ---------------------------------------------------------- payment plans */

export async function createPaymentPlan(
  principal: Principal,
  input: { studentId: string; invoiceId: string; name: string; instalments: number; startsOn: Date },
) {
  requirePermission(principal, 'finance.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, institutionId },
    select: { id: true, balance: true, number: true },
  });
  if (!invoice) throw new NotFoundError('Invoice');

  const balance = toCents(String(invoice.balance));
  if (balance <= 0) throw new AppError('This invoice has nothing outstanding.', 409, 'nothing_owing');
  if (input.instalments < 2 || input.instalments > 24) {
    throw new AppError('A plan runs over between 2 and 24 instalments.', 422, 'invalid_plan');
  }

  const schedule = buildInstalments(balance, input.instalments, input.startsOn);

  const plan = await prisma.paymentPlan.create({
    data: {
      institutionId,
      studentId: input.studentId,
      invoiceId: input.invoiceId,
      name: input.name.trim(),
      instalments: input.instalments,
      startsOn: input.startsOn,
      status: 'ACTIVE',
      instalmentList: {
        create: schedule.map((instalment) => ({
          dueOn: instalment.dueOn,
          amount: instalment.amount / 100,
          status: 'DUE' as const,
        })),
      },
    },
    select: { id: true },
  });

  await recordAudit(principal, {
    action: 'finance.plan_created',
    entityType: 'PaymentPlan',
    entityId: plan.id,
    institutionId,
    after: { invoice: invoice.number, instalments: input.instalments, total: balance / 100 },
  });

  return plan;
}
