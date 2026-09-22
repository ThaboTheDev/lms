/**
 * Invoice arithmetic and status. Pure, because the figure a learner sees, the
 * figure the finance office reconciles and the figure in a report must be the
 * same number produced by the same code.
 */
import { allocate, clampToZero, percentOf, sum, type Cents } from '@/lib/money';

export interface LineInput {
  description: string;
  feeType: string;
  quantity: number;
  unitAmount: Cents;
}

export interface Line extends LineInput {
  lineTotal: Cents;
}

export type DiscountKind = 'PERCENTAGE' | 'FIXED' | 'SCHOLARSHIP' | 'BURSARY';

export interface DiscountInput {
  name: string;
  type: DiscountKind;
  /** Percentage points for PERCENTAGE, cents for everything else. */
  value: number;
}

export interface InvoiceTotals {
  lines: Line[];
  subtotal: Cents;
  discountTotal: Cents;
  total: Cents;
  appliedDiscounts: { name: string; amount: Cents }[];
}

export function priceLines(inputs: LineInput[]): Line[] {
  return inputs.map((line) => ({
    ...line,
    lineTotal: Math.round(line.unitAmount * line.quantity),
  }));
}

/**
 * Discounts apply to the subtotal, percentage ones first. Applying a fixed
 * amount before a percentage would quietly change what the percentage means,
 * and the order has to be the same every time or two invoices for the same
 * learner will not match.
 */
export function calculateInvoice(inputs: LineInput[], discounts: DiscountInput[] = []): InvoiceTotals {
  const lines = priceLines(inputs);
  const subtotal = sum(lines.map((line) => line.lineTotal));

  const ordered = [...discounts].sort((a, b) => {
    const rank = (kind: DiscountKind) => (kind === 'PERCENTAGE' ? 0 : 1);
    return rank(a.type) - rank(b.type);
  });

  const applied: { name: string; amount: Cents }[] = [];
  let remaining = subtotal;

  for (const discount of ordered) {
    const amount =
      discount.type === 'PERCENTAGE'
        ? percentOf(subtotal, discount.value)
        : Math.round(discount.value);

    // A discount never turns an invoice into a credit.
    const capped = Math.min(amount, remaining);
    if (capped <= 0) continue;

    applied.push({ name: discount.name, amount: capped });
    remaining -= capped;
  }

  const discountTotal = sum(applied.map((entry) => entry.amount));

  return {
    lines,
    subtotal,
    discountTotal,
    total: clampToZero(subtotal - discountTotal),
    appliedDiscounts: applied,
  };
}

export type InvoiceStatus =
  | 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'WRITTEN_OFF';

export interface BalanceInput {
  total: Cents;
  paid: Cents;
  dueOn: Date | null;
  issued: boolean;
  cancelled?: boolean;
  writtenOff?: boolean;
}

export interface BalanceResult {
  balance: Cents;
  status: InvoiceStatus;
  overdueDays: number;
}

/**
 * Status is derived rather than stored as an independent fact, so an invoice
 * cannot sit at PAID while money is still owed. An overpayment leaves a credit
 * balance and still reads as paid.
 */
export function deriveStatus(input: BalanceInput, now: Date = new Date()): BalanceResult {
  const balance = input.total - input.paid;

  if (input.cancelled) return { balance: 0, status: 'CANCELLED', overdueDays: 0 };
  if (input.writtenOff) return { balance: 0, status: 'WRITTEN_OFF', overdueDays: 0 };
  if (!input.issued) return { balance, status: 'DRAFT', overdueDays: 0 };

  if (balance <= 0) return { balance, status: 'PAID', overdueDays: 0 };

  const overdueDays =
    input.dueOn && now > input.dueOn
      ? Math.floor((now.getTime() - input.dueOn.getTime()) / 86_400_000)
      : 0;

  if (overdueDays > 0) return { balance, status: 'OVERDUE', overdueDays };
  if (input.paid > 0) return { balance, status: 'PARTIALLY_PAID', overdueDays: 0 };
  return { balance, status: 'ISSUED', overdueDays: 0 };
}

export interface AgeingBucket {
  label: string;
  fromDays: number;
  toDays: number | null;
  amount: Cents;
  count: number;
}

/**
 * The ageing analysis a finance office actually works from: current, then
 * 30, 60, 90 and older. Anything not yet due sits in current rather than being
 * left out, because the total across buckets must equal the total outstanding.
 */
export function ageDebt(
  invoices: { balance: Cents; dueOn: Date | null }[],
  now: Date = new Date(),
): AgeingBucket[] {
  const buckets: AgeingBucket[] = [
    { label: 'Current', fromDays: 0, toDays: 0, amount: 0, count: 0 },
    { label: '1 to 30 days', fromDays: 1, toDays: 30, amount: 0, count: 0 },
    { label: '31 to 60 days', fromDays: 31, toDays: 60, amount: 0, count: 0 },
    { label: '61 to 90 days', fromDays: 61, toDays: 90, amount: 0, count: 0 },
    { label: 'Over 90 days', fromDays: 91, toDays: null, amount: 0, count: 0 },
  ];

  for (const invoice of invoices) {
    if (invoice.balance <= 0) continue;

    const days =
      invoice.dueOn && now > invoice.dueOn
        ? Math.floor((now.getTime() - invoice.dueOn.getTime()) / 86_400_000)
        : 0;

    const bucket =
      buckets.find((candidate) => days >= candidate.fromDays && (candidate.toDays === null || days <= candidate.toDays)) ??
      buckets[0]!;

    bucket.amount += invoice.balance;
    bucket.count += 1;
  }

  return buckets;
}

export interface InstalmentPlan {
  dueOn: Date;
  amount: Cents;
  sequence: number;
}

/**
 * Builds an instalment schedule. The odd cent goes on the first payment, and
 * the dates step by month from the start, clamped so that a plan starting on
 * the 31st does not skip February.
 */
export function buildInstalments(total: Cents, count: number, startsOn: Date): InstalmentPlan[] {
  const amounts = allocate(total, count);

  return amounts.map((amount, index) => {
    const dueOn = new Date(startsOn);
    const targetDay = startsOn.getDate();
    dueOn.setDate(1);
    dueOn.setMonth(dueOn.getMonth() + index);

    const daysInMonth = new Date(dueOn.getFullYear(), dueOn.getMonth() + 1, 0).getDate();
    dueOn.setDate(Math.min(targetDay, daysInMonth));

    return { dueOn, amount, sequence: index + 1 };
  });
}

export interface ArrearsResult {
  overdueAmount: Cents;
  overdueCount: Cents;
  nextDueOn: Date | null;
  nextAmount: Cents;
}

export function planArrears(
  instalments: { dueOn: Date; amount: Cents; paidAmount: Cents }[],
  now: Date = new Date(),
): ArrearsResult {
  const outstanding = instalments.filter((instalment) => instalment.paidAmount < instalment.amount);
  const overdue = outstanding.filter((instalment) => instalment.dueOn < now);
  const next = outstanding.find((instalment) => instalment.dueOn >= now) ?? null;

  return {
    overdueAmount: sum(overdue.map((instalment) => instalment.amount - instalment.paidAmount)),
    overdueCount: overdue.length,
    nextDueOn: next?.dueOn ?? null,
    nextAmount: next ? next.amount - next.paidAmount : 0,
  };
}
