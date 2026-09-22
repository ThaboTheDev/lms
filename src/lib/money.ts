/**
 * Money is handled in integer cents everywhere inside the application, and
 * converted to the database Decimal only at the edge. Floating point arithmetic
 * on currency loses cents, and an institution reconciling twenty thousand
 * payments notices.
 */

export type Cents = number;

export function toCents(amount: number | string): Cents {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function fromCents(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function formatMoney(cents: Cents, currency = 'ZAR', locale = 'en-ZA'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(fromCents(cents));
}

export function sum(values: Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0);
}

/** Percentage of an amount, rounded to the nearest cent, never below zero. */
export function percentOf(cents: Cents, percent: number): Cents {
  return Math.max(0, Math.round(cents * (percent / 100)));
}

/**
 * Splits an amount into equal parts without losing or inventing a cent. The
 * remainder lands on the first instalment, which is the convention finance
 * offices use: the learner pays the odd cent up front rather than discovering
 * it on the last payment.
 */
export function allocate(total: Cents, parts: number): Cents[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, index) => (index === 0 ? base + remainder : base));
}

export function clampToZero(cents: Cents): Cents {
  return cents < 0 ? 0 : cents;
}
