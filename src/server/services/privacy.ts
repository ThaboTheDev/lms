import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { toCents } from '@/lib/money';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { assessErasure, decideRetention, RETENTION_RULES } from './retention-rules';

/**
 * Everything the institution holds about one person, in a form they can read
 * and take elsewhere. A data subject request answered with a database dump is
 * not an answer, so this is shaped the way the person would describe their own
 * life at the institution.
 */
export async function exportPersonalInformation(principal: Principal, userId: string) {
  const isSelf = principal.userId === userId;
  if (!isSelf) requirePermission(principal, 'user.manage');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, preferredName: true,
      phone: true, status: true, createdAt: true, lastLoginAt: true, institutionId: true,
      studentProfile: {
        select: {
          id: true, studentNumber: true, dateOfBirth: true, nationality: true, homeLanguage: true,
          addressLine1: true, addressLine2: true, city: true, province: true, postalCode: true,
          emergencyName: true, emergencyPhone: true, emergencyRelation: true,
          admissionStatus: true, supportNeeds: true, supportConsentAt: true,
        },
      },
    },
  });
  if (!user) throw new NotFoundError('Person');
  if (!isSelf && user.institutionId) requireSameInstitution(principal, user.institutionId);

  const studentId = user.studentProfile?.id;

  const [enrolments, results, attendance, submissions, certificates, invoices, payments, messages, notifications] =
    await Promise.all([
      studentId
        ? prisma.programmeEnrolment.findMany({
            where: { studentId },
            select: {
              status: true, yearOfStudy: true, enrolledOn: true, completedOn: true,
              programme: { select: { code: true, title: true } },
            },
          })
        : [],
      studentId
        ? prisma.courseEnrolment.findMany({
            where: { studentId },
            select: {
              result: true, finalMark: true, finalGrade: true, creditsAwarded: true,
              offering: { select: { course: { select: { code: true, title: true } } } },
            },
          })
        : [],
      studentId
        ? prisma.attendanceRecord.findMany({
            where: { studentId },
            select: { status: true, markedAt: true, session: { select: { title: true, scheduledStart: true } } },
          })
        : [],
      studentId
        ? prisma.submission.findMany({
            where: { studentId },
            select: {
              status: true, submittedAt: true, finalMark: true, grade: true, feedback: true,
              assessment: { select: { title: true, maxMark: true } },
            },
          })
        : [],
      studentId
        ? prisma.certificate.findMany({
            where: { studentId },
            select: { number: true, title: true, issuedOn: true, status: true },
          })
        : [],
      studentId
        ? prisma.invoice.findMany({
            where: { studentId },
            select: { number: true, issuedOn: true, total: true, balance: true, status: true },
          })
        : [],
      studentId
        ? prisma.payment.findMany({
            where: { studentId },
            select: { amount: true, paidOn: true, method: true, reference: true },
          })
        : [],
      prisma.message.findMany({
        where: { senderId: userId, deletedAt: null },
        select: { body: true, createdAt: true, thread: { select: { subject: true } } },
        take: 1000,
      }),
      prisma.notification.findMany({
        where: { userId },
        select: { type: true, title: true, createdAt: true, readAt: true },
        take: 1000,
      }),
    ]);

  await recordAudit(principal, {
    action: 'privacy.export_generated',
    entityType: 'User',
    entityId: userId,
    institutionId: user.institutionId,
    after: { requestedBySelf: isSelf },
  });

  return {
    generatedAt: new Date().toISOString(),
    aboutThisFile:
      'Everything the institution holds about you that identifies you. Marks and results appear as they stand on your record.',
    profile: user,
    enrolments,
    results,
    attendance,
    submissions,
    certificates,
    finance: {
      invoices,
      payments,
      outstanding: invoices.reduce(
        (total: number, invoice: { balance: unknown }) => total + Math.max(0, toCents(String(invoice.balance))),
        0,
      ),
    },
    messages,
    notifications,
  };
}

/** What can actually be done if this person asks to be erased. */
export async function assessErasureRequest(principal: Principal, userId: string) {
  requirePermission(principal, 'user.manage');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, institutionId: true,
      studentProfile: {
        select: {
          id: true,
          programmeEnrolments: { where: { status: 'ACTIVE' }, select: { id: true } },
          courseEnrolments: { where: { result: { not: 'PENDING' } }, select: { id: true } },
          invoices: { select: { balance: true } },
          certificates: { select: { id: true } },
        },
      },
    },
  });
  if (!user) throw new NotFoundError('Person');
  if (user.institutionId) requireSameInstitution(principal, user.institutionId);

  const profile = user.studentProfile;
  const outstanding = (profile?.invoices ?? []).reduce(
    (total: number, invoice: { balance: unknown }) => total + Math.max(0, toCents(String(invoice.balance))),
    0,
  );

  return assessErasure({
    hasAcademicRecord: (profile?.courseEnrolments.length ?? 0) > 0 || (profile?.certificates.length ?? 0) > 0,
    hasOutstandingBalance: outstanding > 0,
    hasActiveEnrolment: (profile?.programmeEnrolments.length ?? 0) > 0,
  });
}

/**
 * Carries out an erasure. Anonymising detaches the academic record from the
 * person rather than destroying it: the qualification stays verifiable, which
 * protects the learner as much as the institution, and everything that
 * identifies them beyond that record goes.
 */
export async function eraseSubject(principal: Principal, userId: string, reason: string) {
  requirePermission(principal, 'user.manage');

  if (!reason.trim()) {
    throw new AppError('Record the request this erasure answers.', 422, 'reason_required');
  }

  const assessment = await assessErasureRequest(principal, userId);
  if (!assessment.canErase) {
    throw new AppError(assessment.explanation, 409, 'erasure_refused');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, institutionId: true, studentProfile: { select: { id: true } } },
  });
  if (!user) throw new NotFoundError('Person');

  const studentId = user.studentProfile?.id;
  const anonymousEmail = `erased-${user.id.slice(-8)}@removed.invalid`;

  await prisma.$transaction(async (tx) => {
    if (studentId) {
      await tx.studentProfile.update({
        where: { id: studentId },
        data: {
          nationalIdRef: null,
          passportNumber: null,
          dateOfBirth: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          province: null,
          postalCode: null,
          emergencyName: null,
          emergencyPhone: null,
          emergencyRelation: null,
          supportNeeds: null,
          supportConsentAt: null,
        },
      });

      await tx.proofOfPayment.deleteMany({ where: { studentId } });
      await tx.submissionFile.deleteMany({ where: { submission: { studentId } } });
    }

    await tx.message.updateMany({
      where: { senderId: userId },
      data: { body: '[removed at the sender\'s request]', deletedAt: new Date() },
    });
    await tx.forumPost.updateMany({
      where: { authorId: userId },
      data: { body: '[removed at the author\'s request]', isHidden: true },
    });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.authToken.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymousEmail,
        firstName: 'Removed',
        lastName: 'Record',
        preferredName: null,
        phone: null,
        avatarFileId: null,
        passwordHash: null,
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryHashes: [],
        status: 'DEACTIVATED',
        deletedAt: new Date(),
      },
    });
  });

  await recordAudit(principal, {
    action: 'privacy.subject_erased',
    entityType: 'User',
    entityId: userId,
    institutionId: user.institutionId,
    after: { approach: assessment.approach, reason: reason.trim(), kept: assessment.keep },
  });

  return assessment;
}

export interface RetentionCandidateSummary {
  category: string;
  label: string;
  action: string;
  basis: string;
  due: number;
  total: number;
}

/**
 * What is past its retention date. Reported before anything is deleted, because
 * an institution should see what a sweep is about to remove.
 */
export async function retentionReport(principal: Principal): Promise<RetentionCandidateSummary[]> {
  requirePermission(principal, 'settings.manage');
  const institutionId = principal.institutionId ?? undefined;
  const now = new Date();

  const cutoff = (months: number) => {
    const date = new Date(now);
    date.setMonth(date.getMonth() - months);
    return date;
  };

  const summaries: RetentionCandidateSummary[] = [];

  for (const rule of RETENTION_RULES) {
    if (rule.retainMonths === null) {
      summaries.push({
        category: rule.category,
        label: rule.label,
        action: rule.action,
        basis: rule.basis,
        due: 0,
        total: 0,
      });
      continue;
    }

    const before = cutoff(rule.retainMonths);
    let due = 0;
    let total = 0;

    switch (rule.category) {
      case 'PROOF_OF_PAYMENT':
        [total, due] = await Promise.all([
          prisma.proofOfPayment.count({ where: { institutionId } }),
          prisma.proofOfPayment.count({ where: { institutionId, submittedAt: { lt: before } } }),
        ]);
        break;
      case 'SESSIONS':
        [total, due] = await Promise.all([
          prisma.session.count(),
          prisma.session.count({ where: { createdAt: { lt: before } } }),
        ]);
        break;
      case 'MESSAGES':
        [total, due] = await Promise.all([
          prisma.message.count(),
          prisma.message.count({ where: { createdAt: { lt: before } } }),
        ]);
        break;
      case 'APPLICATION_UNSUCCESSFUL':
        [total, due] = await Promise.all([
          prisma.application.count({ where: { institutionId, status: { in: ['REJECTED', 'DECLINED', 'WITHDRAWN'] } } }),
          prisma.application.count({
            where: {
              institutionId,
              status: { in: ['REJECTED', 'DECLINED', 'WITHDRAWN'] },
              createdAt: { lt: before },
            },
          }),
        ]);
        break;
      default:
        break;
    }

    summaries.push({
      category: rule.category,
      label: rule.label,
      action: rule.action,
      basis: rule.basis,
      due,
      total,
    });
  }

  return summaries;
}

/** Runs the sweep for one category. Deliberately one category at a time. */
export async function runRetentionSweep(principal: Principal, category: string) {
  requirePermission(principal, 'settings.manage');
  const institutionId = principal.institutionId ?? undefined;

  const rule = RETENTION_RULES.find((entry) => entry.category === category);
  if (!rule || rule.retainMonths === null || rule.action === 'RETAIN') {
    throw new AppError('That category is kept rather than swept.', 409, 'retained');
  }

  const before = new Date();
  before.setMonth(before.getMonth() - rule.retainMonths);

  let removed = 0;

  switch (category) {
    case 'PROOF_OF_PAYMENT': {
      const result = await prisma.proofOfPayment.deleteMany({
        where: { institutionId, submittedAt: { lt: before }, status: { in: ['APPROVED', 'REJECTED', 'DUPLICATE'] } },
      });
      removed = result.count;
      break;
    }
    case 'SESSIONS': {
      const [sessions, attempts] = await Promise.all([
        prisma.session.deleteMany({ where: { createdAt: { lt: before } } }),
        prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: before } } }),
      ]);
      removed = sessions.count + attempts.count;
      break;
    }
    case 'MESSAGES': {
      const result = await prisma.message.deleteMany({ where: { createdAt: { lt: before } } });
      removed = result.count;
      break;
    }
    case 'APPLICATION_UNSUCCESSFUL': {
      const result = await prisma.application.deleteMany({
        where: {
          institutionId,
          status: { in: ['REJECTED', 'DECLINED', 'WITHDRAWN'] },
          createdAt: { lt: before },
        },
      });
      removed = result.count;
      break;
    }
    default:
      throw new AppError('No sweep is implemented for that category yet.', 501, 'not_implemented');
  }

  await recordAudit(principal, {
    action: 'privacy.retention_swept',
    entityType: 'Institution',
    entityId: institutionId ?? null,
    after: { category, removed, olderThan: before.toISOString(), basis: rule.basis },
  });

  return { removed, before };
}
