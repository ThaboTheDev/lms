import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, fromCents, percentOf, sum, toCents } from '@/lib/money';
import {
  ageDebt,
  buildInstalments,
  calculateInvoice,
  deriveStatus,
  planArrears,
  priceLines,
} from '@/server/services/invoicing-rules';

describe('money', () => {
  it('converts to and from cents without drift', () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents('99.99')).toBe(9999);
    expect(fromCents(123456)).toBe(1234.56);
  });

  it('adds amounts that would drift as floats', () => {
    // 0.1 + 0.2 in floating point is famously not 0.3.
    expect(fromCents(sum([toCents(0.1), toCents(0.2)]))).toBe(0.3);
  });

  it('splits an amount without losing or inventing a cent', () => {
    const parts = allocate(100_00, 3);
    expect(sum(parts)).toBe(100_00);
    expect(parts).toEqual([3334, 3333, 3333]);
  });

  it('puts the odd cent on the first payment', () => {
    expect(allocate(10_01, 2)[0]).toBe(501);
  });

  it('rounds a percentage to the nearest cent and never goes negative', () => {
    expect(percentOf(999, 10)).toBe(100);
    expect(percentOf(1000, -50)).toBe(0);
  });

  it('formats in rands', () => {
    expect(formatMoney(123456).replace(/\u00a0/g, ' ')).toContain('1 234,56');
  });
});

describe('invoice totals', () => {
  const lines = [
    { description: 'Tuition', feeType: 'TUITION', quantity: 1, unitAmount: 24_000_00 },
    { description: 'Registration', feeType: 'REGISTRATION', quantity: 1, unitAmount: 1_500_00 },
  ];

  it('prices the lines and totals them', () => {
    expect(priceLines([{ ...lines[0]!, quantity: 3 }])[0]!.lineTotal).toBe(72_000_00);
    expect(calculateInvoice(lines).subtotal).toBe(25_500_00);
  });

  it('applies a percentage discount to the subtotal', () => {
    const result = calculateInvoice(lines, [{ name: 'Early payment', type: 'PERCENTAGE', value: 10 }]);
    expect(result.discountTotal).toBe(2_550_00);
    expect(result.total).toBe(22_950_00);
  });

  it('applies percentage discounts before fixed ones, so the order cannot change the answer', () => {
    const discounts = [
      { name: 'Bursary', type: 'FIXED' as const, value: 5_000_00 },
      { name: 'Early payment', type: 'PERCENTAGE' as const, value: 10 },
    ];
    const forwards = calculateInvoice(lines, discounts);
    const backwards = calculateInvoice(lines, [...discounts].reverse());
    expect(forwards.total).toBe(backwards.total);
    expect(forwards.total).toBe(25_500_00 - 2_550_00 - 5_000_00);
  });

  it('never turns an invoice into a credit', () => {
    const result = calculateInvoice(lines, [{ name: 'Full scholarship', type: 'SCHOLARSHIP', value: 99_999_00 }]);
    expect(result.total).toBe(0);
    expect(result.discountTotal).toBe(25_500_00);
  });
});

describe('invoice status', () => {
  const dueOn = new Date('2026-03-31T23:59:00Z');
  const now = new Date('2026-04-15T00:00:00Z');

  it('stays a draft until it is issued', () => {
    expect(deriveStatus({ total: 1000, paid: 0, dueOn, issued: false }, now).status).toBe('DRAFT');
  });

  it('reads as overdue once the date passes with money owing', () => {
    const result = deriveStatus({ total: 1000, paid: 0, dueOn, issued: true }, now);
    expect(result.status).toBe('OVERDUE');
    expect(result.overdueDays).toBe(14);
  });

  it('shows a part payment as partially paid before the due date', () => {
    const early = new Date('2026-03-01T00:00:00Z');
    expect(deriveStatus({ total: 1000, paid: 400, dueOn, issued: true }, early).status).toBe('PARTIALLY_PAID');
  });

  it('reads an overpayment as paid and leaves a credit balance', () => {
    const result = deriveStatus({ total: 1000, paid: 1500, dueOn, issued: true }, now);
    expect(result.status).toBe('PAID');
    expect(result.balance).toBe(-500);
  });

  it('cannot sit at paid while money is owed', () => {
    expect(deriveStatus({ total: 1000, paid: 999, dueOn, issued: true }, now).status).not.toBe('PAID');
  });

  it('closes out a cancelled or written off invoice', () => {
    expect(deriveStatus({ total: 1000, paid: 0, dueOn, issued: true, cancelled: true }, now).balance).toBe(0);
    expect(deriveStatus({ total: 1000, paid: 0, dueOn, issued: true, writtenOff: true }, now).status).toBe('WRITTEN_OFF');
  });
});

describe('ageing', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('places each balance in the right bucket', () => {
    const buckets = ageDebt(
      [
        { balance: 100_00, dueOn: new Date('2026-07-01') },
        { balance: 200_00, dueOn: new Date('2026-05-20') },
        { balance: 300_00, dueOn: new Date('2026-04-15') },
        { balance: 400_00, dueOn: new Date('2026-01-01') },
      ],
      now,
    );

    expect(buckets[0]!.amount).toBe(100_00);
    expect(buckets[1]!.amount).toBe(200_00);
    expect(buckets[2]!.amount).toBe(300_00);
    expect(buckets[4]!.amount).toBe(400_00);
  });

  it('keeps the bucket total equal to the total outstanding', () => {
    const invoices = [
      { balance: 100_00, dueOn: new Date('2026-05-01') },
      { balance: 250_00, dueOn: null },
      { balance: 0, dueOn: new Date('2026-01-01') },
    ];
    const buckets = ageDebt(invoices, now);
    const bucketTotal = buckets.reduce((total, bucket) => total + bucket.amount, 0);
    expect(bucketTotal).toBe(350_00);
  });
});

describe('payment plans', () => {
  it('splits the total across instalments without losing a cent', () => {
    const plan = buildInstalments(10_000_01, 4, new Date('2026-02-15T00:00:00Z'));
    expect(plan).toHaveLength(4);
    expect(plan.reduce((total, entry) => total + entry.amount, 0)).toBe(10_000_01);
  });

  it('steps a month at a time', () => {
    const plan = buildInstalments(300_00, 3, new Date('2026-01-15T00:00:00Z'));
    expect(plan.map((entry) => entry.dueOn.getMonth())).toEqual([0, 1, 2]);
    expect(plan.every((entry) => entry.dueOn.getDate() === 15)).toBe(true);
  });

  it('does not skip February for a plan starting on the 31st', () => {
    const plan = buildInstalments(300_00, 3, new Date(2026, 0, 31));
    expect(plan.map((entry) => entry.dueOn.getMonth())).toEqual([0, 1, 2]);
    expect(plan[1]!.dueOn.getDate()).toBe(28);
  });

  it('reports arrears and what falls due next', () => {
    const arrears = planArrears(
      [
        { dueOn: new Date('2026-01-15'), amount: 100_00, paidAmount: 100_00 },
        { dueOn: new Date('2026-02-15'), amount: 100_00, paidAmount: 40_00 },
        { dueOn: new Date('2026-04-15'), amount: 100_00, paidAmount: 0 },
      ],
      new Date('2026-03-01'),
    );

    expect(arrears.overdueAmount).toBe(60_00);
    expect(arrears.overdueCount).toBe(1);
    expect(arrears.nextDueOn).toEqual(new Date('2026-04-15'));
  });
});
