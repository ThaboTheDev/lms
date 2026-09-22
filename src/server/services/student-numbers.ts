import 'server-only';
import { prisma } from '@/lib/db';
import { formatApplicationReference, formatStudentNumber, parseSequence } from './reference-format';

/**
 * Student numbers are the institution's public reference for a learner, so they
 * must be unique, gapless enough to look orderly and safe to issue when several
 * registrations are captured at the same moment.
 *
 * A Postgres advisory lock held for the length of the transaction serialises
 * allocation per institution and per year. The unique constraint on
 * (institutionId, studentNumber) is the backstop if anything ever bypasses this
 * path.
 *
 * Format: <year><sequence padded to five digits>, e.g. 202600137.
 */
export async function allocateStudentNumber(
  institutionId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const lockKey = `student-number:${institutionId}:${year}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const prefix = String(year);
    const latest = await tx.studentProfile.findFirst({
      where: { institutionId, studentNumber: { startsWith: prefix } },
      orderBy: { studentNumber: 'desc' },
      select: { studentNumber: true },
    });

    const lastSequence = latest ? parseSequence(latest.studentNumber, prefix) : 0;
    return formatStudentNumber(year, lastSequence + 1);
  });
}

export { formatStudentNumber } from './reference-format';

/** Applications get a human-quotable reference before a student number exists. */
export async function allocateApplicationReference(
  institutionId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const lockKey = `application-ref:${institutionId}:${year}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const prefix = `APP-${year}-`;
    const latest = await tx.application.findFirst({
      where: { institutionId, referenceNumber: { startsWith: prefix } },
      orderBy: { referenceNumber: 'desc' },
      select: { referenceNumber: true },
    });

    const lastSequence = latest ? parseSequence(latest.referenceNumber, prefix) : 0;
    return formatApplicationReference(year, lastSequence + 1);
  });
}
