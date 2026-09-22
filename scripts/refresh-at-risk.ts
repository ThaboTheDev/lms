/**
 * Rebuilds the at-risk list for every institution. Run nightly from cron or a
 * scheduled container task:
 *
 *   npm run atrisk
 *
 * It is a scheduled job rather than a page-load computation because it reads
 * across a whole cohort, and because support staff work the list over days.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const institutions = await prisma.institution.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  for (const institution of institutions) {
    const { atRiskLearners } = await import('../src/server/services/analytics');

    // A scheduled run has no signed-in person, so it acts as a platform
    // principal scoped to the one institution it is processing.
    const principal = {
      userId: 'system',
      institutionId: institution.id,
      email: 'system@scheduled',
      displayName: 'Scheduled task',
      isSuperAdmin: true,
      grants: [],
      studentId: null,
    };

    const rows = await atRiskLearners(principal as never, 500);

    await prisma.$transaction([
      prisma.atRiskFlag.deleteMany({ where: { institutionId: institution.id, acknowledgedAt: null } }),
      prisma.atRiskFlag.createMany({
        data: rows.map((row) => ({
          institutionId: institution.id,
          studentId: row.studentId,
          score: row.risk.score,
          indicators: {
            level: row.risk.level,
            basis: row.risk.basis,
            indicators: row.risk.indicators,
          } as never,
        })),
      }),
    ]);

    console.log(`${institution.name}: ${rows.length} learners flagged for support`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
