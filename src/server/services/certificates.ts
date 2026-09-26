import 'server-only';
import { notify } from './notifications';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { hashIp } from '@/lib/crypto';
import { env } from '@/lib/env';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import {
  checkVerificationCode,
  formatCertificateNumber,
  generateVerificationCode,
  verificationUrl,
} from './credential-codes';
import { loadCourseRecords } from './academic-records';
import { checkGraduation } from './progression-rules';

export type CredentialKind =
  | 'QUALIFICATION' | 'SHORT_COURSE' | 'MICRO_CREDENTIAL'
  | 'BADGE' | 'COMPLETION' | 'ATTENDANCE';

export interface IssueInput {
  studentId: string;
  kind: CredentialKind;
  title?: string;
  programmeId?: string;
  offeringId?: string;
  qualificationId?: string;
  templateId?: string;
  completionDate?: Date;
  /** Issue despite an unmet requirement, with the reason recorded. */
  overrideReason?: string;
}

/**
 * Allocates the next certificate number. Held under an advisory lock per
 * institution and year for the same reason student numbers are: two registrars
 * pressing issue at the same moment must not be handed the same number.
 */
async function allocateNumber(institutionId: string, prefix: string, year: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`certificate:${institutionId}:${year}`}))`;

    const search = `${prefix.toUpperCase()}-${year}-`;
    const latest = await tx.certificate.findFirst({
      where: { institutionId, number: { startsWith: search } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const lastSequence = latest ? Number(latest.number.slice(search.length)) : 0;
    return formatCertificateNumber(prefix, year, (Number.isFinite(lastSequence) ? lastSequence : 0) + 1);
  });
}

/**
 * Issues a credential. A qualification certificate is refused unless the
 * learner has actually met the qualification: the whole value of the document
 * rests on that check, and an institution that issues one early cannot take it
 * back from whoever has already seen it. A registrar may override, but the
 * reason is recorded on the certificate and in the audit log.
 */
export async function issueCertificate(principal: Principal, input: IssueInput) {
  const student = await prisma.studentProfile.findUnique({
    where: { id: input.studentId },
    select: {
      id: true,
      institutionId: true,
      studentNumber: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      institution: { select: { certificatePrefix: true, name: true } },
    },
  });
  if (!student) throw new NotFoundError('Student');

  requireSameInstitution(principal, student.institutionId);
  requirePermission(principal, 'certificate.issue', { institutionId: student.institutionId });

  let title = input.title ?? '';

  if (input.kind === 'QUALIFICATION') {
    const enrolment = await prisma.programmeEnrolment.findFirst({
      where: { studentId: input.studentId, ...(input.programmeId ? { programmeId: input.programmeId } : {}) },
      orderBy: { enrolledOn: 'desc' },
      select: {
        programmeId: true,
        programme: {
          select: {
            title: true,
            qualificationId: true,
            qualification: { select: { title: true, minimumCredits: true } },
            curriculum: { select: { courseId: true, isCompulsory: true } },
          },
        },
      },
    });
    if (!enrolment) throw new NotFoundError('Programme enrolment');

    const records = await loadCourseRecords(input.studentId);
    const graduation = checkGraduation(records, {
      minimumCredits: enrolment.programme.qualification.minimumCredits,
      compulsoryCourseIds: enrolment.programme.curriculum
        .filter((item) => item.isCompulsory)
        .map((item) => item.courseId),
    });

    if (!graduation.eligible && !input.overrideReason) {
      throw new AppError(
        `This learner has not met the qualification: ${graduation.missing.join(' ')}`,
        409,
        'not_eligible',
        { missing: graduation.missing },
      );
    }

    title = title || enrolment.programme.qualification.title;
    input.programmeId = input.programmeId ?? enrolment.programmeId;
    input.qualificationId = input.qualificationId ?? enrolment.programme.qualificationId;
  }

  if (!title && input.offeringId) {
    const offering = await prisma.courseOffering.findUnique({
      where: { id: input.offeringId },
      select: { course: { select: { title: true } } },
    });
    title = offering?.course.title ?? 'Course completion';
  }

  const completionDate = input.completionDate ?? new Date();
  const year = completionDate.getFullYear();
  const number = await allocateNumber(student.institutionId, student.institution.certificatePrefix, year);

  // Retried on the vanishingly unlikely collision rather than trusting to luck.
  let certificate = null;
  for (let attempt = 0; attempt < 5 && !certificate; attempt += 1) {
    const verificationCode = generateVerificationCode(randomBytes(11));
    const existing = await prisma.certificate.findUnique({
      where: { verificationCode },
      select: { id: true },
    });
    if (existing) continue;

    certificate = await prisma.certificate.create({
      data: {
        institutionId: student.institutionId,
        studentId: input.studentId,
        templateId: input.templateId || null,
        kind: input.kind as never,
        number,
        verificationCode,
        title,
        programmeId: input.programmeId || null,
        offeringId: input.offeringId || null,
        qualificationId: input.qualificationId || null,
        completionDate,
        issuedById: principal.userId,
        status: 'ISSUED',
        metadata: {
          holder: `${student.user.firstName} ${student.user.lastName}`,
          studentNumber: student.studentNumber,
          institution: student.institution.name,
          ...(input.overrideReason ? { issuedByException: input.overrideReason } : {}),
        } as never,
      },
    });
  }

  if (!certificate) {
    throw new AppError('A verification code could not be allocated. Try again.', 500, 'code_allocation_failed');
  }

  await recordAudit(principal, {
    action: 'certificate.issued',
    entityType: 'Certificate',
    entityId: certificate.id,
    institutionId: student.institutionId,
    after: {
      number: certificate.number,
      kind: input.kind,
      studentNumber: student.studentNumber,
      title,
      issuedByException: input.overrideReason ?? null,
    },
  });

  await notify({
    userId: student.user.id,
    institutionId: student.institutionId,
    type: 'certificate.issued',
    title: `Certificate issued: ${certificate.title}`,
    body: `Certificate ${certificate.number}. Anyone can confirm it at the verification page with code ${certificate.verificationCode}.`,
    linkUrl: `/verify/${certificate.verificationCode}`,
  });
  return certificate;
}

/**
 * Revokes a certificate. Nothing is deleted: the record stays and verification
 * starts answering "revoked", because a document already in circulation has to
 * be answerable.
 */
export async function revokeCertificate(principal: Principal, certificateId: string, reason: string) {
  const certificate = await prisma.certificate.findUnique({
    where: { id: certificateId },
    select: { id: true, institutionId: true, number: true, status: true },
  });
  if (!certificate) throw new NotFoundError('Certificate');

  requireSameInstitution(principal, certificate.institutionId);
  requirePermission(principal, 'certificate.issue', { institutionId: certificate.institutionId });

  if (!reason.trim()) {
    throw new AppError('Record why this certificate is being revoked.', 422, 'reason_required');
  }

  const updated = await prisma.certificate.update({
    where: { id: certificateId },
    data: { status: 'REVOKED', revokedReason: reason.trim() },
  });

  await recordAudit(principal, {
    action: 'certificate.revoked',
    entityType: 'Certificate',
    entityId: certificateId,
    institutionId: certificate.institutionId,
    before: { status: certificate.status },
    after: { status: 'REVOKED', number: certificate.number, reason },
  });

  return updated;
}

export interface VerificationResult {
  outcome: 'VALID' | 'REVOKED' | 'NOT_FOUND' | 'MALFORMED';
  certificate?: {
    number: string;
    holder: string;
    title: string;
    kind: string;
    institution: string;
    completionDate: Date;
    issuedOn: Date;
    nqfLevel: number | null;
    revokedReason: string | null;
  };
}

/**
 * Public verification. Deliberately narrow: whoever holds the code is holding
 * the certificate, so they see the holder's name, what was awarded, by whom and
 * when, and nothing else. No student number, no marks, no transcript, no
 * contact details. Every check is logged, and a malformed code is reported as
 * malformed rather than as "no such certificate", which would make an honest
 * typing mistake look like a forgery.
 */
export async function verifyCertificate(
  rawCode: string,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<VerificationResult> {
  const check = checkVerificationCode(rawCode);
  if (!check.valid) return { outcome: 'MALFORMED' };

  const certificate = await prisma.certificate.findUnique({
    where: { verificationCode: check.code },
    select: {
      id: true,
      number: true,
      title: true,
      kind: true,
      status: true,
      completionDate: true,
      issuedOn: true,
      revokedReason: true,
      metadata: true,
      student: { select: { user: { select: { firstName: true, lastName: true } } } },
      institution: { select: { name: true } },
      qualification: { select: { nqfLevel: true } },
    },
  });

  if (!certificate) return { outcome: 'NOT_FOUND' };

  await prisma.certificateVerification.create({
    data: {
      certificateId: certificate.id,
      ipHash: hashIp(context.ipAddress),
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      outcome: certificate.status === 'REVOKED' ? 'REVOKED' : 'VALID',
    },
  });

  return {
    outcome: certificate.status === 'REVOKED' ? 'REVOKED' : 'VALID',
    certificate: {
      number: certificate.number,
      holder: `${certificate.student.user.firstName} ${certificate.student.user.lastName}`,
      title: certificate.title,
      kind: certificate.kind,
      institution: certificate.institution.name,
      completionDate: certificate.completionDate,
      issuedOn: certificate.issuedOn,
      nqfLevel: certificate.qualification?.nqfLevel ?? null,
      revokedReason: certificate.status === 'REVOKED' ? certificate.revokedReason : null,
    },
  };
}

export async function listCertificates(
  principal: Principal,
  filters: { query?: string; status?: string },
  paging: { skip: number; perPage: number },
) {
  requirePermission(principal, 'certificate.read');

  const where = {
    institutionId: principal.institutionId ?? undefined,
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.query
      ? {
          OR: [
            { number: { contains: filters.query, mode: 'insensitive' as const } },
            { title: { contains: filters.query, mode: 'insensitive' as const } },
            { student: { studentNumber: { contains: filters.query } } },
            { student: { user: { lastName: { contains: filters.query, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  const [total, certificates] = await Promise.all([
    prisma.certificate.count({ where: where as never }),
    prisma.certificate.findMany({
      where: where as never,
      skip: paging.skip,
      take: paging.perPage,
      orderBy: { issuedOn: 'desc' },
      select: {
        id: true, number: true, title: true, kind: true, status: true,
        issuedOn: true, completionDate: true, verificationCode: true,
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
        _count: { select: { verifications: true } },
      },
    }),
  ]);

  return { total, certificates };
}

export async function loadCertificate(principal: Principal, certificateId: string) {
  const certificate = await prisma.certificate.findUnique({
    where: { id: certificateId },
    select: {
      id: true, institutionId: true, number: true, verificationCode: true, title: true,
      kind: true, status: true, issuedOn: true, completionDate: true, revokedReason: true,
      metadata: true,
      student: {
        select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
      },
      institution: {
        select: { name: true, logoFileId: true, primaryColour: true, footerText: true },
      },
      qualification: { select: { title: true, nqfLevel: true, minimumCredits: true } },
      template: { select: { signatoryName: true, signatoryTitle: true, bodyHtml: true } },
      verifications: {
        orderBy: { verifiedAt: 'desc' },
        take: 10,
        select: { verifiedAt: true, outcome: true },
      },
    },
  });
  if (!certificate) throw new NotFoundError('Certificate');

  const isHolder = principal.studentId === certificate.student.id;
  if (!isHolder) {
    requireSameInstitution(principal, certificate.institutionId);
    requirePermission(principal, 'certificate.read', { institutionId: certificate.institutionId });
  }

  return {
    certificate,
    verifyUrl: verificationUrl(env.APP_URL, certificate.verificationCode),
  };
}

/** A learner's own credentials, for their record page. */
export async function myCertificates(principal: Principal) {
  if (!principal.studentId) return [];

  return prisma.certificate.findMany({
    where: { studentId: principal.studentId, status: { in: ['ISSUED', 'REPLACED'] } },
    orderBy: { issuedOn: 'desc' },
    select: {
      id: true, number: true, title: true, kind: true, issuedOn: true,
      completionDate: true, verificationCode: true,
    },
  });
}
