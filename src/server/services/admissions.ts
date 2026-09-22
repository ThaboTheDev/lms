import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/password';
import { randomToken } from '@/lib/crypto';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { allocateApplicationReference, allocateStudentNumber } from './student-numbers';
import {
  findTransition,
  type ApplicationStatus,
} from './admissions-workflow';
import type { ApplicationSubmission } from '@/lib/validation/application';

/**
 * Public intake. An applicant does not need an account: the application is
 * keyed by its reference number, and an account is created only if an offer is
 * accepted. That keeps the admissions funnel open without seeding the user
 * table with people who never enrol.
 */
export async function submitApplication(institutionId: string, input: ApplicationSubmission) {
  const programme = await prisma.programme.findFirst({
    where: { id: input.programmeId, institutionId, isActive: true },
    select: { id: true },
  });
  if (!programme) throw new ValidationError({ programmeId: 'That programme is not open for applications.' });

  const referenceNumber = await allocateApplicationReference(institutionId);

  const application = await prisma.application.create({
    data: {
      institutionId,
      referenceNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone || null,
      dateOfBirth: input.dateOfBirth ?? null,
      nationality: input.nationality || null,
      programmeId: input.programmeId,
      academicYearId: input.academicYearId,
      intakeTermId: input.intakeTermId || null,
      status: 'SUBMITTED',
      submittedAt: new Date(),
      answers: {
        highestQualification: input.highestQualification || null,
        schoolOrInstitution: input.schoolOrInstitution || null,
        yearCompleted: input.yearCompleted || null,
        popiaConsentAt: new Date().toISOString(),
      },
      events: {
        create: { toStatus: 'SUBMITTED', note: 'Application submitted online.' },
      },
    },
    select: { id: true, referenceNumber: true },
  });

  // TODO(phase-6): queue the acknowledgement email carrying the reference number.
  return application;
}

/**
 * Moves an application along the pipeline. The transition table decides what is
 * allowed; this function enforces the permission attached to the move and
 * writes the event history that the admissions audit depends on.
 */
export async function transitionApplication(
  principal: Principal,
  applicationId: string,
  to: ApplicationStatus,
  options: { note?: string; conditions?: string } = {},
) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, institutionId: true, status: true, referenceNumber: true },
  });
  if (!application) throw new NotFoundError('Application');

  requireSameInstitution(principal, application.institutionId);

  const from = application.status as ApplicationStatus;
  const rule = findTransition(from, to);
  if (!rule) {
    throw new AppError(
      `An application that is ${from.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}.`,
      409,
      'invalid_transition',
    );
  }

  if (rule.permission) {
    requirePermission(principal, rule.permission, { institutionId: application.institutionId });
  }
  if (rule.requiresDecision && !options.note) {
    throw new ValidationError({ notes: 'Record the reason for this decision.' });
  }

  const isDecision = ['OFFER', 'CONDITIONAL_OFFER', 'REJECTED'].includes(to);

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.application.update({
      where: { id: applicationId },
      data: {
        status: to,
        decisionNotes: options.note ?? undefined,
        conditions: to === 'CONDITIONAL_OFFER' ? options.conditions ?? null : undefined,
        ...(isDecision ? { decidedAt: new Date(), decidedById: principal.userId } : {}),
      },
    });

    await tx.applicationEvent.create({
      data: {
        applicationId,
        fromStatus: from,
        toStatus: to,
        actorId: principal.userId,
        note: options.note ?? null,
      },
    });

    return next;
  });

  await recordAudit(principal, {
    action: 'application.transitioned',
    entityType: 'Application',
    entityId: applicationId,
    institutionId: application.institutionId,
    before: { status: from },
    after: { status: to, reference: application.referenceNumber },
  });

  // TODO(phase-6): queue the applicant notification for this status change.
  return updated;
}

/**
 * Turns an accepted application into a registered learner: user account,
 * student profile with an allocated student number, and the programme
 * enrolment. Idempotent, because a registration clerk clicking twice must not
 * create two learners.
 */
export async function enrolAcceptedApplicant(
  principal: Principal,
  applicationId: string,
  options: { cohortId?: string } = {},
) {
  requirePermission(principal, 'enrolment.manage');

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true, institutionId: true, status: true, email: true, firstName: true, lastName: true,
      phone: true, dateOfBirth: true, nationality: true, programmeId: true, academicYearId: true,
      createdStudentId: true, referenceNumber: true,
    },
  });
  if (!application) throw new NotFoundError('Application');
  requireSameInstitution(principal, application.institutionId);

  if (application.createdStudentId) {
    return { studentId: application.createdStudentId, alreadyEnrolled: true };
  }
  if (application.status !== 'ACCEPTED') {
    throw new AppError('Only an accepted offer can be enrolled.', 409, 'invalid_transition');
  }

  const institutionId = application.institutionId;
  const studentNumber = await allocateStudentNumber(institutionId);
  const placeholderPassword = await hashPassword(randomToken(24));

  const studentId = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { email: application.email } });

    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          institutionId,
          email: application.email,
          firstName: application.firstName,
          lastName: application.lastName,
          phone: application.phone,
          passwordHash: placeholderPassword,
          status: 'INVITED',
        },
      }));

    const studentRole = await tx.role.findUnique({
      where: { institutionId_key: { institutionId, key: 'STUDENT' } },
      select: { id: true },
    });
    if (studentRole) {
      await tx.userRole.upsert({
        where: {
          userId_roleId_scopeType_scopeId: {
            userId: user.id,
            roleId: studentRole.id,
            scopeType: 'INSTITUTION',
            scopeId: null as never,
          },
        },
        update: {},
        create: { userId: user.id, roleId: studentRole.id, scopeType: 'INSTITUTION', institutionId },
      });
    }

    const profile = await tx.studentProfile.upsert({
      where: { userId: user.id },
      update: { admissionStatus: 'REGISTERED' },
      create: {
        institutionId,
        userId: user.id,
        studentNumber,
        dateOfBirth: application.dateOfBirth,
        nationality: application.nationality,
        admissionStatus: 'REGISTERED',
      },
    });

    await tx.programmeEnrolment.upsert({
      where: {
        studentId_programmeId_academicYearId: {
          studentId: profile.id,
          programmeId: application.programmeId,
          academicYearId: application.academicYearId,
        },
      },
      update: { status: 'ACTIVE' },
      create: {
        institutionId,
        studentId: profile.id,
        programmeId: application.programmeId,
        academicYearId: application.academicYearId,
        cohortId: options.cohortId ?? null,
        status: 'ACTIVE',
      },
    });

    await tx.application.update({
      where: { id: applicationId },
      data: { status: 'ENROLLED', createdStudentId: profile.id },
    });

    await tx.applicationEvent.create({
      data: {
        applicationId,
        fromStatus: 'ACCEPTED',
        toStatus: 'ENROLLED',
        actorId: principal.userId,
        note: `Enrolled as student ${profile.studentNumber}.`,
      },
    });

    return profile.id;
  });

  await recordAudit(principal, {
    action: 'application.enrolled',
    entityType: 'Application',
    entityId: applicationId,
    institutionId,
    after: { studentId, studentNumber, reference: application.referenceNumber },
  });

  return { studentId, alreadyEnrolled: false };
}
