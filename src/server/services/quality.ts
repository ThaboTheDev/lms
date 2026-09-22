import 'server-only';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';
import { checkEvidence, complianceSignals, reviewStage } from './qa-rules';

export async function listQaDocuments(principal: Principal, filters: { programmeId?: string } = {}) {
  requirePermission(principal, 'qa.manage');

  return prisma.qaDocument.findMany({
    where: {
      institutionId: principal.institutionId ?? undefined,
      ...(filters.programmeId ? { programmeId: filters.programmeId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true, title: true, category: true, status: true, periodStart: true, periodEnd: true,
      updatedAt: true,
      programme: { select: { code: true } },
      course: { select: { code: true } },
      file: { select: { id: true, originalName: true } },
    },
  });
}

export async function addQaDocument(
  principal: Principal,
  input: { title: string; category: string; fileId?: string; programmeId?: string; courseId?: string },
) {
  requirePermission(principal, 'qa.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const document = await prisma.qaDocument.create({
    data: {
      institutionId,
      title: input.title.trim(),
      category: input.category,
      fileId: input.fileId || null,
      programmeId: input.programmeId || null,
      courseId: input.courseId || null,
      ownerId: principal.userId,
      status: 'DRAFT',
    },
    select: { id: true },
  });

  await recordAudit(principal, {
    action: 'qa.document_added',
    entityType: 'QaDocument',
    entityId: document.id,
    institutionId,
    after: { title: input.title, category: input.category },
  });

  return document;
}

/** Programme reviews with their stage and their evidence gaps worked out. */
export async function listReviews(principal: Principal) {
  requirePermission(principal, 'qa.manage');
  const institutionId = principal.institutionId ?? undefined;

  const [reviews, documents] = await Promise.all([
    prisma.programmeReview.findMany({
      where: { institutionId },
      orderBy: [{ dueOn: 'asc' }],
      select: {
        id: true, cycle: true, status: true, findings: true, actions: true,
        dueOn: true, completedOn: true,
        programme: { select: { id: true, code: true, title: true } },
      },
    }),
    prisma.qaDocument.findMany({
      where: { institutionId },
      select: { programmeId: true, category: true },
    }),
  ]);

  const byProgramme = new Map<string, string[]>();
  for (const document of documents as { programmeId: string | null; category: string }[]) {
    if (!document.programmeId) continue;
    byProgramme.set(document.programmeId, [
      ...(byProgramme.get(document.programmeId) ?? []),
      document.category,
    ]);
  }

  return reviews.map((review) => {
    const categories = byProgramme.get(review.programme.id) ?? [];
    const evidence = checkEvidence(categories);

    return {
      ...review,
      evidence,
      stage: reviewStage({
        status: review.status,
        dueOn: review.dueOn,
        completedOn: review.completedOn,
        hasFindings: Boolean(review.findings),
        hasActions: Boolean(review.actions),
        evidenceCount: categories.length,
      }),
    };
  });
}

export async function startReview(
  principal: Principal,
  input: { programmeId: string; cycle: string; dueOn?: Date },
) {
  requirePermission(principal, 'qa.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  return prisma.programmeReview.create({
    data: {
      institutionId,
      programmeId: input.programmeId,
      cycle: input.cycle.trim(),
      dueOn: input.dueOn ?? null,
      status: 'PLANNED',
      reviewerId: principal.userId,
    },
    select: { id: true },
  });
}

export async function completeReview(
  principal: Principal,
  reviewId: string,
  input: { findings: string; actions: string },
) {
  requirePermission(principal, 'qa.manage');

  const review = await prisma.programmeReview.findUnique({
    where: { id: reviewId },
    select: { id: true, institutionId: true, cycle: true, programme: { select: { code: true } } },
  });
  if (!review) throw new NotFoundError('Review');

  const updated = await prisma.programmeReview.update({
    where: { id: reviewId },
    data: {
      findings: input.findings.trim(),
      actions: input.actions.trim(),
      status: 'COMPLETE',
      completedOn: new Date(),
    },
  });

  await recordAudit(principal, {
    action: 'qa.review_completed',
    entityType: 'ProgrammeReview',
    entityId: reviewId,
    institutionId: review.institutionId,
    after: { programme: review.programme.code, cycle: review.cycle },
  });

  return updated;
}

/**
 * The compliance picture an academic board asks for. Every figure is counted
 * from the records rather than entered by hand, so the board is reading the
 * system rather than somebody's summary of it.
 */
export async function complianceOverview(principal: Principal) {
  requirePermission(principal, 'qa.manage');
  const institutionId = principal.institutionId ?? undefined;

  const [published, moderated, releasedWithout, programmes, reviewedProgrammes, overdue, certificates] =
    await Promise.all([
      prisma.assessment.count({ where: { institutionId, status: { in: ['PUBLISHED', 'CLOSED'] } } }),
      prisma.assessment.count({
        where: { institutionId, status: { in: ['PUBLISHED', 'CLOSED'] }, moderations: { some: {} } },
      }),
      prisma.assessment.count({
        where: { institutionId, releaseResultsAt: { not: null }, moderations: { none: {} } },
      }),
      prisma.programme.count({ where: { institutionId } }),
      prisma.programme.count({ where: { institutionId, reviews: { some: {} } } }),
      prisma.programmeReview.count({
        where: { institutionId, completedOn: null, dueOn: { lt: new Date() } },
      }),
      prisma.certificate.findMany({
        where: { institutionId, status: { in: ['ISSUED', 'REPLACED'] } },
        select: { metadata: true },
      }),
    ]);

  const byException = (certificates as { metadata: unknown }[]).filter((certificate) => {
    const metadata = (certificate.metadata ?? {}) as { issuedByException?: string };
    return Boolean(metadata.issuedByException);
  }).length;

  return complianceSignals({
    assessmentsPublished: published,
    assessmentsModerated: moderated,
    resultsReleasedWithoutModeration: releasedWithout,
    programmesWithoutReview: programmes - reviewedProgrammes,
    programmesTotal: programmes,
    certificatesIssuedByException: byException,
    overdueReviews: overdue,
  });
}
