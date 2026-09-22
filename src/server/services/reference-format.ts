/**
 * Formatting for the institution's public references. Pure, so the rules can be
 * tested and reused by the allocation service, imports and reporting.
 */
export function formatStudentNumber(year: number, sequence: number): string {
  return `${year}${String(sequence).padStart(5, '0')}`;
}

export function formatApplicationReference(year: number, sequence: number): string {
  return `APP-${year}-${String(sequence).padStart(5, '0')}`;
}

/** Reads the sequence back out of a reference, returning 0 if it does not fit. */
export function parseSequence(reference: string, prefix: string): number {
  if (!reference.startsWith(prefix)) return 0;
  const sequence = Number(reference.slice(prefix.length));
  return Number.isFinite(sequence) ? sequence : 0;
}
