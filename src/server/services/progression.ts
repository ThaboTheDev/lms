import 'server-only';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { loadCourseRecords } from './academic-records';
import {
  DEFAULT_PROGRESSION_POLICY,
  checkGraduation,
  determineProgression,
  type AcademicStanding,
  type ProgressionDecision,
  type ProgressionPolicy,
} from './progression-rules';

/**
 * Institutions set their own thresholds, so the policy is stored as data and
 * read per institution. A changed threshold applies to future evaluations only:
 * decisions already recorded keep the numbers they were made on.
 */
export async function loadPolicy(institutionId: string): Promise<ProgressionPolicy> {
  const setting = await prisma.systemSetting.findFirst({
    where: { institutionId, key: 'progression.policy' },
    select: { value: true },
  });
  if (!setting) return DEFAULT_PROGRESSION_POLICY;
  return { ...DEFAULT_PROGRESSION_POLICY, ...(setting.value as Partial<ProgressionPolicy>) };
}

export interface EvaluationContext {
  studentId: string;
  programmeId: string;
  academicYearId: string;
}

/** Works out the recommendation without recording anything. */
export async function evaluateProgression(
  principal: Principal,
  context: EvaluationContext,
): Promise<ProgressionDecision & { previousStanding: AcademicStanding | null; finalYear: boolean }> {
  const enrolment = await prisma.programmeEnrolment.findFirst({
    where: {
      studentId: context.studentId,
      programmeId: context.programmeId,
      academicYearId: context.academicYearId,
    },
    select: {
      institutionId: true,
      yearOfStudy: true,
      programme: {
        select: {
          durationMonths: true,
          qualification: { select: { minimumCredits: true } },
          curriculum: { select: { courseId: true, isCompulsory: true } },
        },
      },
    },
  });
  if (!enrolment) throw new NotFoundError('Programme enrolment');

  requireSameInstitution(principal, enrolment.institutionId);
  requirePermission(principal, 'academic_record.read', { institutionId: enrolment.institutionId });

  const [records, previous, policy] = await Promise.all([
    loadCourseRecords(context.studentId),
    prisma.progressionDecision.findFirst({
      where: { studentId: context.studentId, programmeId: context.programmeId },
      orderBy: { decidedOn: 'desc' },
      select: { standing: true },
    }),
    loadPolicy(enrolment.institutionId),
  ]);

  const expectedYears = Math.max(1, Math.ceil((enrolment.programme.durationMonths ?? 12) / 12));
  const finalYear = enrolment.yearOfStudy >= expectedYears;

  const decision = determineProgression(
    records,
    {
      yearOfStudy: enrolment.yearOfStudy,
      finalYear,
      previousStanding: (previous?.standing as AcademicStanding) ?? null,
      minimumCredits: enrolment.programme.qualification.minimumCredits,
      compulsoryCourseIds: enrolment.programme.curriculum
        .filter((item) => item.isCompulsory)
        .map((item) => item.courseId),
    },
    policy,
  );

  return {
    ...decision,
    previousStanding: (previous?.standing as AcademicStanding) ?? null,
    finalYear,
  };
}

/**
 * Records the decision. The recommendation is a starting point: a registrar or
 * a senate committee may record a different outcome, and the reason they gave
 * is stored with it, because that note is what an appeal turns on.
 */
export async function recordProgressionDecision(
  principal: Principal,
  context: EvaluationContext,
  input: { outcome?: string; standing?: string; notes?: string },
) {
  const evaluation = await evaluateProgression(principal, context);

  const enrolment = await prisma.programmeEnrolment.findFirst({
    where: {
      studentId: context.studentId,
      programmeId: context.programmeId,
      academicYearId: context.academicYearId,
    },
    select: { id: true, institutionId: true, yearOfStudy: true },
  });
  if (!enrolment) throw new NotFoundError('Programme enrolment');

  requirePermission(principal, 'academic_record.manage', { institutionId: enrolment.institutionId });

  const outcome = (input.outcome ?? evaluation.outcome) as never;
  const standing = (input.standing ?? evaluation.standing) as never;
  const overridden = Boolean(input.outcome && input.outcome !== evaluation.outcome);

  const notes = [
    ...evaluation.reasons,
    ...(overridden ? [`Recorded as ${input.outcome} rather than the recommended ${evaluation.outcome}.`] : []),
    ...(input.notes ? [input.notes] : []),
  ].join(' ');

  const decision = await prisma.progressionDecision.upsert({
    where: {
      studentId_programmeId_academicYearId: {
        studentId: context.studentId,
        programmeId: context.programmeId,
        academicYearId: context.academicYearId,
      },
    },
    create: {
      institutionId: enrolment.institutionId,
      studentId: context.studentId,
      programmeId: context.programmeId,
      academicYearId: context.academicYearId,
      creditsEarned: evaluation.summary.earned,
      creditsOutstanding: evaluation.summary.outstanding + evaluation.carryCredits,
      standing,
      outcome,
      decidedById: principal.userId,
      notes,
    },
    update: {
      creditsEarned: evaluation.summary.earned,
      creditsOutstanding: evaluation.summary.outstanding + evaluation.carryCredits,
      standing,
      outcome,
      decidedById: principal.userId,
      decidedOn: new Date(),
      notes,
    },
  });

  // The decision moves the learner: a graduate completes, an exclusion ends the
  // enrolment, and a progression advances the year of study.
  const enrolmentUpdate =
    outcome === 'GRADUATE'
      ? { status: 'COMPLETED' as const, completedOn: new Date() }
      : outcome === 'EXCLUDE'
        ? { status: 'EXCLUDED' as const, exitReason: 'Academic exclusion.' }
        : outcome === 'REPEAT_YEAR'
          ? {}
          : { yearOfStudy: enrolment.yearOfStudy + 1 };

  if (Object.keys(enrolmentUpdate).length > 0) {
    await prisma.programmeEnrolment.update({ where: { id: enrolment.id }, data: enrolmentUpdate });
  }

  if (outcome === 'GRADUATE') {
    await prisma.studentProfile.update({
      where: { id: context.studentId },
      data: { admissionStatus: 'ALUMNUS' },
    });
  }

  await recordAudit(principal, {
    action: 'progression.recorded',
    entityType: 'ProgressionDecision',
    entityId: decision.id,
    institutionId: enrolment.institutionId,
    before: { recommended: evaluation.outcome, previousStanding: evaluation.previousStanding },
    after: { outcome, standing, creditsEarned: evaluation.summary.earned, overridden },
  });

  return decision;
}

/** The progression board for one cohort or programme year. */
export async function progressionBoard(
  principal: Principal,
  programmeId: string,
  academicYearId: string,
) {
  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: {
      id: true,
      institutionId: true,
      code: true,
      title: true,
      durationMonths: true,
      qualification: { select: { minimumCredits: true } },
      curriculum: { select: { courseId: true, isCompulsory: true } },
    },
  });
  if (!programme) throw new NotFoundError('Programme');
  requireSameInstitution(principal, programme.institutionId);
  requirePermission(principal, 'academic_record.read', { institutionId: programme.institutionId });

  const [enrolments, policy] = await Promise.all([
    prisma.programmeEnrolment.findMany({
      where: { programmeId, academicYearId, status: { in: ['ACTIVE', 'ON_HOLD'] } },
      select: {
        id: true,
        yearOfStudy: true,
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    loadPolicy(programme.institutionId),
  ]);

  const decisions = await prisma.progressionDecision.findMany({
    where: { programmeId, academicYearId },
    select: { studentId: true, outcome: true, standing: true, decidedOn: true },
  });
  const decided = new Map(decisions.map((decision) => [decision.studentId, decision]));

  const compulsoryCourseIds = programme.curriculum
    .filter((item) => item.isCompulsory)
    .map((item) => item.courseId);
  const expectedYears = Math.max(1, Math.ceil((programme.durationMonths ?? 12) / 12));

  const rows = await Promise.all(
    enrolments.map(async (enrolment) => {
      const records = await loadCourseRecords(enrolment.student.id);
      const recommendation = determineProgression(
        records,
        {
          yearOfStudy: enrolment.yearOfStudy,
          finalYear: enrolment.yearOfStudy >= expectedYears,
          minimumCredits: programme.qualification.minimumCredits,
          compulsoryCourseIds,
        },
        policy,
      );

      return {
        enrolmentId: enrolment.id,
        student: enrolment.student,
        yearOfStudy: enrolment.yearOfStudy,
        recommendation,
        recorded: decided.get(enrolment.student.id) ?? null,
        graduation: checkGraduation(records, {
          minimumCredits: programme.qualification.minimumCredits,
          compulsoryCourseIds,
        }),
      };
    }),
  );

  return { programme, rows, policy };
}
