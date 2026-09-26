/**
 * src/server/services/academic-setup.ts
 *
 * Creating the academic structure an institution runs on: years and terms,
 * faculties and departments, qualifications, programmes, courses, the
 * deliveries of a course in a term and who teaches them, cohorts, grading
 * schemes and email templates. Until this existed only the development seed
 * could create any of it, so a real deployment could not run a single course.
 *
 * Every function checks a permission, keeps to the caller's institution,
 * turns duplicate codes into a sentence rather than a database error, and
 * writes an audit entry.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { AppError, AuthorisationError, NotFoundError } from '@/lib/errors';
import { canAny, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import type { PermissionKey } from '@/lib/rbac/permissions';
import { findRoleForInstitution, grantRoleOnce } from './role-grants';
import {
  STAFF_ROLE_GRANTS,
  termProblems,
  type Band,
  type academicYearSchema,
  type cohortSchema,
  type courseSchema,
  type departmentSchema,
  type emailTemplateSchema,
  type facultySchema,
  type offeringSchema,
  type programmeSchema,
  type qualificationSchema,
  type staffAssignmentSchema,
  type termSchema,
} from './academic-setup-rules';
import type { z } from 'zod';

const CALENDAR: PermissionKey[] = ['programme.manage', 'settings.manage', 'enrolment.manage'];
const STRUCTURE: PermissionKey[] = ['programme.manage'];
const COURSES: PermissionKey[] = ['course.manage'];
const COHORTS: PermissionKey[] = ['programme.manage', 'enrolment.manage'];
const GRADING: PermissionKey[] = ['settings.manage', 'academic_record.manage', 'programme.manage'];
const TEMPLATES: PermissionKey[] = ['settings.manage'];

function institutionOf(principal: Principal, permissions: PermissionKey[]): string {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  if (!canAny(principal, permissions, { institutionId })) throw new AuthorisationError();
  return institutionId;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function unique<T>(work: () => Promise<T>, message: string, field = 'code'): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(message, 409, 'duplicate', { [field]: message });
    throw error;
  }
}

/* ------------------------------------------------------- years and terms -- */

export async function createAcademicYear(principal: Principal, input: z.output<typeof academicYearSchema>) {
  const institutionId = institutionOf(principal, CALENDAR);
  const year = await unique(
    () =>
      prisma.$transaction(async (tx) => {
        const count = await tx.academicYear.count({ where: { institutionId } });
        const current = input.isCurrent || count === 0;
        if (current) await tx.academicYear.updateMany({ where: { institutionId }, data: { isCurrent: false } });
        return tx.academicYear.create({
          data: { institutionId, year: input.year, label: input.label, startsOn: input.startsOn, endsOn: input.endsOn, isCurrent: current },
        });
      }),
    `There is already a ${input.year} academic year.`,
    'year',
  );
  await recordAudit(principal, { action: 'academic.year_created', entityType: 'AcademicYear', entityId: year.id, after: { year: year.year, label: year.label, isCurrent: year.isCurrent } });
  return year;
}

export async function setCurrentAcademicYear(principal: Principal, academicYearId: string) {
  const institutionId = institutionOf(principal, CALENDAR);
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, institutionId }, select: { id: true, label: true } });
  if (!year) throw new NotFoundError('Academic year');
  await prisma.$transaction([
    prisma.academicYear.updateMany({ where: { institutionId }, data: { isCurrent: false } }),
    prisma.academicYear.update({ where: { id: year.id }, data: { isCurrent: true } }),
  ]);
  await recordAudit(principal, { action: 'academic.year_made_current', entityType: 'AcademicYear', entityId: year.id, after: { label: year.label } });
}

export async function createTerm(principal: Principal, input: z.output<typeof termSchema>) {
  const institutionId = institutionOf(principal, CALENDAR);
  const year = await prisma.academicYear.findFirst({ where: { id: input.academicYearId, institutionId }, select: { id: true, startsOn: true, endsOn: true, label: true } });
  if (!year) throw new NotFoundError('Academic year');
  const problems = termProblems(input, year);
  if (problems.length > 0) {
    throw new AppError(problems[0]!.message, 422, 'validation_failed', Object.fromEntries(problems.map((p) => [p.field, p.message])));
  }

  const term = await unique(
    () =>
      prisma.$transaction(async (tx) => {
        if (input.isCurrent) {
          await tx.academicTerm.updateMany({ where: { academicYear: { institutionId } }, data: { isCurrent: false } });
        }
        return tx.academicTerm.create({
          data: {
            academicYearId: year.id,
            code: input.code,
            name: input.name,
            type: input.type,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            registrationOpensOn: input.registrationOpensOn ?? null,
            registrationClosesOn: input.registrationClosesOn ?? null,
            isCurrent: input.isCurrent,
          },
        });
      }),
    `${year.label} already has a term with the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.term_created', entityType: 'AcademicTerm', entityId: term.id, after: { code: term.code, name: term.name, year: year.label } });
  return term;
}

export async function setCurrentTerm(principal: Principal, termId: string) {
  const institutionId = institutionOf(principal, CALENDAR);
  const term = await prisma.academicTerm.findFirst({ where: { id: termId, academicYear: { institutionId } }, select: { id: true, name: true } });
  if (!term) throw new NotFoundError('Term');
  await prisma.$transaction([
    prisma.academicTerm.updateMany({ where: { academicYear: { institutionId } }, data: { isCurrent: false } }),
    prisma.academicTerm.update({ where: { id: term.id }, data: { isCurrent: true } }),
  ]);
  await recordAudit(principal, { action: 'academic.term_made_current', entityType: 'AcademicTerm', entityId: term.id, after: { name: term.name } });
}

/* ------------------------------------------------------------- structure -- */

export async function createFaculty(principal: Principal, input: z.output<typeof facultySchema>) {
  const institutionId = institutionOf(principal, STRUCTURE);
  const faculty = await unique(
    () => prisma.faculty.create({ data: { institutionId, code: input.code, name: input.name, description: input.description ?? null } }),
    `A faculty already uses the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.faculty_created', entityType: 'Faculty', entityId: faculty.id, after: { code: faculty.code, name: faculty.name } });
  return faculty;
}

export async function createDepartment(principal: Principal, input: z.output<typeof departmentSchema>) {
  const institutionId = institutionOf(principal, STRUCTURE);
  const faculty = await prisma.faculty.findFirst({ where: { id: input.facultyId, institutionId }, select: { id: true } });
  if (!faculty) throw new NotFoundError('Faculty');
  const department = await unique(
    () => prisma.department.create({ data: { institutionId, facultyId: faculty.id, code: input.code, name: input.name } }),
    `A department already uses the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.department_created', entityType: 'Department', entityId: department.id, after: { code: department.code, name: department.name } });
  return department;
}

export async function createQualification(principal: Principal, input: z.output<typeof qualificationSchema>) {
  const institutionId = institutionOf(principal, STRUCTURE);
  const qualification = await unique(
    () =>
      prisma.qualification.create({
        data: {
          institutionId,
          code: input.code,
          title: input.title,
          type: input.type,
          nqfLevel: input.nqfLevel ?? null,
          minimumCredits: input.minimumCredits ?? null,
          saqaId: input.saqaId ?? null,
          accreditationRef: input.accreditationRef ?? null,
        },
      }),
    `A qualification already uses the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.qualification_created', entityType: 'Qualification', entityId: qualification.id, after: { code: qualification.code, title: qualification.title } });
  return qualification;
}

async function assertProgrammeParents(institutionId: string, departmentId: string, qualificationId: string) {
  const [department, qualification] = await Promise.all([
    prisma.department.findFirst({ where: { id: departmentId, institutionId }, select: { id: true } }),
    prisma.qualification.findFirst({ where: { id: qualificationId, institutionId }, select: { id: true } }),
  ]);
  if (!department) throw new AppError('Choose a department.', 422, 'validation_failed', { departmentId: 'Choose a department.' });
  if (!qualification) throw new AppError('Choose a qualification.', 422, 'validation_failed', { qualificationId: 'Choose a qualification.' });
}

export async function createProgramme(principal: Principal, input: z.output<typeof programmeSchema>) {
  const institutionId = institutionOf(principal, STRUCTURE);
  await assertProgrammeParents(institutionId, input.departmentId, input.qualificationId);
  const programme = await unique(
    () =>
      prisma.programme.create({
        data: {
          institutionId,
          code: input.code,
          title: input.title,
          departmentId: input.departmentId,
          qualificationId: input.qualificationId,
          description: input.description ?? null,
          durationMonths: input.durationMonths ?? null,
          entryRequirements: input.entryRequirements ?? null,
          deliveryModes: input.deliveryModes,
          isActive: input.isActive,
        },
      }),
    `A programme already uses the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.programme_created', entityType: 'Programme', entityId: programme.id, after: { code: programme.code, title: programme.title } });
  return programme;
}

export async function updateProgramme(principal: Principal, programmeId: string, input: z.output<typeof programmeSchema>) {
  const institutionId = institutionOf(principal, STRUCTURE);
  const before = await prisma.programme.findFirst({ where: { id: programmeId, institutionId } });
  if (!before) throw new NotFoundError('Programme');
  await assertProgrammeParents(institutionId, input.departmentId, input.qualificationId);
  const programme = await unique(
    () =>
      prisma.programme.update({
        where: { id: programmeId },
        data: {
          code: input.code,
          title: input.title,
          departmentId: input.departmentId,
          qualificationId: input.qualificationId,
          description: input.description ?? null,
          durationMonths: input.durationMonths ?? null,
          entryRequirements: input.entryRequirements ?? null,
          deliveryModes: input.deliveryModes,
          isActive: input.isActive,
        },
      }),
    `A programme already uses the code ${input.code}.`,
  );
  await recordAudit(principal, {
    action: 'academic.programme_updated',
    entityType: 'Programme',
    entityId: programme.id,
    before: { code: before.code, title: before.title, isActive: before.isActive },
    after: { code: programme.code, title: programme.title, isActive: programme.isActive },
  });
  return programme;
}

/* --------------------------------------------------------------- courses -- */

async function assertDepartment(institutionId: string, departmentId?: string) {
  if (!departmentId) return;
  const department = await prisma.department.findFirst({ where: { id: departmentId, institutionId }, select: { id: true } });
  if (!department) throw new AppError('Choose a department.', 422, 'validation_failed', { departmentId: 'Choose a department.' });
}

export async function createCourse(principal: Principal, input: z.output<typeof courseSchema>) {
  const institutionId = institutionOf(principal, COURSES);
  await assertDepartment(institutionId, input.departmentId);
  const course = await unique(
    () =>
      prisma.course.create({
        data: {
          institutionId,
          code: input.code,
          title: input.title,
          departmentId: input.departmentId ?? null,
          credits: input.credits,
          notionalHours: input.notionalHours ?? null,
          nqfLevel: input.nqfLevel ?? null,
          description: input.description ?? null,
          isActive: input.isActive,
        },
      }),
    `A course already uses the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.course_created', entityType: 'Course', entityId: course.id, after: { code: course.code, title: course.title, credits: course.credits } });
  return course;
}

export async function updateCourse(principal: Principal, courseId: string, input: z.output<typeof courseSchema>) {
  const institutionId = institutionOf(principal, COURSES);
  const before = await prisma.course.findFirst({ where: { id: courseId, institutionId } });
  if (!before) throw new NotFoundError('Course');
  await assertDepartment(institutionId, input.departmentId);
  const course = await unique(
    () =>
      prisma.course.update({
        where: { id: courseId },
        data: {
          code: input.code,
          title: input.title,
          departmentId: input.departmentId ?? null,
          credits: input.credits,
          notionalHours: input.notionalHours ?? null,
          nqfLevel: input.nqfLevel ?? null,
          description: input.description ?? null,
          isActive: input.isActive,
        },
      }),
    `A course already uses the code ${input.code}.`,
  );
  await recordAudit(principal, {
    action: 'academic.course_updated',
    entityType: 'Course',
    entityId: course.id,
    before: { code: before.code, title: before.title, credits: before.credits, isActive: before.isActive },
    after: { code: course.code, title: course.title, credits: course.credits, isActive: course.isActive },
  });
  return course;
}

/**
 * Schedules a course into a term. Its discussion forum is created with it, so
 * learners have somewhere to ask questions from the first day.
 */
export async function createOffering(principal: Principal, input: z.output<typeof offeringSchema>) {
  const institutionId = institutionOf(principal, COURSES);
  const [course, term] = await Promise.all([
    prisma.course.findFirst({ where: { id: input.courseId, institutionId }, select: { id: true, code: true, title: true } }),
    prisma.academicTerm.findFirst({ where: { id: input.academicTermId, academicYear: { institutionId } }, select: { id: true, name: true, academicYear: { select: { year: true } } } }),
  ]);
  if (!course) throw new NotFoundError('Course');
  if (!term) throw new AppError('Choose a term.', 422, 'validation_failed', { academicTermId: 'Choose a term.' });

  const existing = await prisma.courseOffering.findFirst({
    where: { courseId: course.id, academicTermId: term.id, sectionCode: input.sectionCode },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(`${course.code} section ${input.sectionCode} is already scheduled in ${term.name} ${term.academicYear.year}.`, 409, 'duplicate', { sectionCode: 'Already scheduled in that term.' });
  }

  const offering = await prisma.$transaction(async (tx) => {
    const created = await tx.courseOffering.create({
      data: {
        institutionId,
        courseId: course.id,
        academicTermId: term.id,
        sectionCode: input.sectionCode,
        deliveryMode: input.deliveryMode,
        capacity: input.capacity ?? null,
        status: input.status,
      },
    });
    await tx.forum.create({
      data: {
        institutionId,
        offeringId: created.id,
        title: `${course.code} discussion`,
        description: 'Questions and discussion for everyone taking this course.',
      },
    });
    return created;
  });

  await recordAudit(principal, {
    action: 'academic.offering_created',
    entityType: 'CourseOffering',
    entityId: offering.id,
    after: { course: course.code, term: `${term.name} ${term.academicYear.year}`, section: offering.sectionCode, status: offering.status },
  });
  return offering;
}

export async function setOfferingStatus(principal: Principal, offeringId: string, status: z.output<typeof offeringSchema>['status']) {
  const institutionId = institutionOf(principal, COURSES);
  const before = await prisma.courseOffering.findFirst({ where: { id: offeringId, institutionId }, select: { id: true, status: true } });
  if (!before) throw new NotFoundError('Course delivery');
  await prisma.courseOffering.update({ where: { id: offeringId }, data: { status } });
  await recordAudit(principal, { action: 'academic.offering_status', entityType: 'CourseOffering', entityId: offeringId, before: { status: before.status }, after: { status } });
}

/**
 * Puts somebody on a course's teaching team. The matching role is granted at
 * course scope as well: without it the person would be on the team but hold
 * none of the permissions the course screens check.
 */
export async function assignOfferingStaff(principal: Principal, input: z.output<typeof staffAssignmentSchema>) {
  const institutionId = institutionOf(principal, COURSES);
  const [offering, person] = await Promise.all([
    prisma.courseOffering.findFirst({ where: { id: input.offeringId, institutionId }, select: { id: true, course: { select: { code: true } } } }),
    prisma.user.findFirst({ where: { id: input.userId, institutionId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, status: true } }),
  ]);
  if (!offering) throw new NotFoundError('Course delivery');
  if (!person) throw new AppError('Choose a member of staff.', 422, 'validation_failed', { userId: 'Choose a member of staff.' });

  const roleKey = STAFF_ROLE_GRANTS[input.role];
  const role = await findRoleForInstitution(prisma, institutionId, roleKey);
  if (!role) throw new AppError(`The ${roleKey.toLowerCase()} role is missing. Run the role sync first.`, 500, 'roles_missing');

  await unique(
    () =>
      prisma.$transaction(async (tx) => {
        await tx.offeringStaff.create({ data: { offeringId: offering.id, userId: person.id, role: input.role } });
        await grantRoleOnce(tx, { userId: person.id, roleId: role.id, institutionId, scopeType: 'COURSE', scopeId: offering.id, grantedById: principal.userId });
      }),
    `${person.firstName} ${person.lastName} is already on this course as ${input.role.toLowerCase().replace(/_/g, ' ')}.`,
    'userId',
  );

  await recordAudit(principal, {
    action: 'academic.offering_staff_assigned',
    entityType: 'CourseOffering',
    entityId: offering.id,
    after: { course: offering.course.code, person: `${person.firstName} ${person.lastName}`, role: input.role },
  });
}

export async function removeOfferingStaff(principal: Principal, offeringStaffId: string) {
  const institutionId = institutionOf(principal, COURSES);
  const assignment = await prisma.offeringStaff.findUnique({
    where: { id: offeringStaffId },
    select: { id: true, role: true, userId: true, offeringId: true, offering: { select: { institutionId: true, course: { select: { code: true } } } }, user: { select: { firstName: true, lastName: true } } },
  });
  if (!assignment) throw new NotFoundError('Teaching assignment');
  requireSameInstitution(principal, assignment.offering.institutionId);

  const roleKey = STAFF_ROLE_GRANTS[assignment.role as keyof typeof STAFF_ROLE_GRANTS];
  const role = await findRoleForInstitution(prisma, institutionId, roleKey);
  // Other assignments on the same course that rest on the same system role
  // (a tutor and a facilitator both hold FACILITATOR) keep the grant alive.
  const sameGrant = Object.entries(STAFF_ROLE_GRANTS)
    .filter(([, key]) => key === roleKey)
    .map(([staffRole]) => staffRole as keyof typeof STAFF_ROLE_GRANTS);

  await prisma.$transaction(async (tx) => {
    await tx.offeringStaff.delete({ where: { id: assignment.id } });
    const stillNeeds = await tx.offeringStaff.count({
      where: { offeringId: assignment.offeringId, userId: assignment.userId, role: { in: sameGrant } },
    });
    if (role && stillNeeds === 0) {
      await tx.userRole.deleteMany({ where: { userId: assignment.userId, roleId: role.id, scopeType: 'COURSE', scopeId: assignment.offeringId } });
    }
  });

  await recordAudit(principal, {
    action: 'academic.offering_staff_removed',
    entityType: 'CourseOffering',
    entityId: assignment.offeringId,
    before: { course: assignment.offering.course.code, person: `${assignment.user.firstName} ${assignment.user.lastName}`, role: assignment.role },
  });
}

/* --------------------------------------------------------------- cohorts -- */

export async function createCohort(principal: Principal, input: z.output<typeof cohortSchema>) {
  const institutionId = institutionOf(principal, COHORTS);
  const [programme, year] = await Promise.all([
    prisma.programme.findFirst({ where: { id: input.programmeId, institutionId }, select: { id: true } }),
    prisma.academicYear.findFirst({ where: { id: input.academicYearId, institutionId }, select: { id: true } }),
  ]);
  if (!programme) throw new AppError('Choose a programme.', 422, 'validation_failed', { programmeId: 'Choose a programme.' });
  if (!year) throw new AppError('Choose an academic year.', 422, 'validation_failed', { academicYearId: 'Choose an academic year.' });
  const cohort = await unique(
    () =>
      prisma.cohort.create({
        data: { institutionId, programmeId: programme.id, academicYearId: year.id, code: input.code, name: input.name, startsOn: input.startsOn ?? null, endsOn: input.endsOn ?? null },
      }),
    `A cohort already uses the code ${input.code}.`,
  );
  await recordAudit(principal, { action: 'academic.cohort_created', entityType: 'Cohort', entityId: cohort.id, after: { code: cohort.code, name: cohort.name } });
  return cohort;
}

/* ------------------------------------------------------- grading schemes -- */

function bandRows(bands: Band[]) {
  return bands.map((band) => ({
    label: band.label,
    minPercent: band.minPercent,
    maxPercent: band.maxPercent,
    gradePoint: band.gradePoint,
    isPass: band.isPass,
    descriptor: band.descriptor ?? null,
  }));
}

/** The first scheme an institution creates becomes its default, which the gradebook and transcripts read. */
export async function createGradingScheme(
  principal: Principal,
  input: { name: string; type: 'PERCENTAGE' | 'LETTER' | 'PASS_FAIL' | 'COMPETENCY' | 'GPA'; isDefault: boolean; bands: Band[] },
) {
  const institutionId = institutionOf(principal, GRADING);
  const scheme = await unique(
    () =>
      prisma.$transaction(async (tx) => {
        const count = await tx.gradingScheme.count({ where: { institutionId } });
        const isDefault = input.isDefault || count === 0;
        if (isDefault) await tx.gradingScheme.updateMany({ where: { institutionId }, data: { isDefault: false } });
        return tx.gradingScheme.create({
          data: { institutionId, name: input.name, type: input.type, isDefault, bands: { create: bandRows(input.bands) } },
        });
      }),
    `A grading scheme is already called ${input.name}.`,
    'name',
  );
  await recordAudit(principal, { action: 'academic.grading_scheme_created', entityType: 'GradingScheme', entityId: scheme.id, after: { name: scheme.name, isDefault: scheme.isDefault, bands: input.bands.map((band) => band.label) } });
  return scheme;
}

export async function updateGradingBands(principal: Principal, schemeId: string, bands: Band[]) {
  const institutionId = institutionOf(principal, GRADING);
  const scheme = await prisma.gradingScheme.findFirst({ where: { id: schemeId, institutionId }, select: { id: true, name: true, bands: { select: { label: true, minPercent: true, maxPercent: true } } } });
  if (!scheme) throw new NotFoundError('Grading scheme');
  await prisma.$transaction([
    prisma.gradeBand.deleteMany({ where: { schemeId } }),
    prisma.gradeBand.createMany({ data: bandRows(bands).map((row) => ({ ...row, schemeId })) }),
  ]);
  await recordAudit(principal, {
    action: 'academic.grading_bands_updated',
    entityType: 'GradingScheme',
    entityId: schemeId,
    before: { bands: scheme.bands.map((band) => `${band.label} ${Number(band.minPercent)}-${Number(band.maxPercent)}`) },
    after: { bands: bands.map((band) => `${band.label} ${band.minPercent}-${band.maxPercent}`) },
  });
}

export async function setDefaultGradingScheme(principal: Principal, schemeId: string) {
  const institutionId = institutionOf(principal, GRADING);
  const scheme = await prisma.gradingScheme.findFirst({ where: { id: schemeId, institutionId }, select: { id: true, name: true } });
  if (!scheme) throw new NotFoundError('Grading scheme');
  await prisma.$transaction([
    prisma.gradingScheme.updateMany({ where: { institutionId }, data: { isDefault: false } }),
    prisma.gradingScheme.update({ where: { id: schemeId }, data: { isDefault: true } }),
  ]);
  await recordAudit(principal, { action: 'academic.grading_scheme_default', entityType: 'GradingScheme', entityId: schemeId, after: { name: scheme.name } });
}

/* ------------------------------------------------------- email templates -- */

export async function saveEmailTemplate(principal: Principal, input: z.output<typeof emailTemplateSchema> & { name: string }) {
  const institutionId = institutionOf(principal, TEMPLATES);
  const variables = ['firstName', 'title', 'body', 'institution', 'link'];
  const template = await prisma.emailTemplate.upsert({
    where: { institutionId_key: { institutionId, key: input.key } },
    update: { subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText ?? null, isActive: input.isActive },
    create: { institutionId, key: input.key, name: input.name, subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText ?? null, variables, isActive: input.isActive },
  });
  await recordAudit(principal, { action: 'settings.email_template_saved', entityType: 'EmailTemplate', entityId: template.id, after: { key: template.key, isActive: template.isActive } });
  return template;
}

/* ---------------------------------------------------------------- status -- */

/** What an institution has set up so far, for the setup checklist. */
export async function setupProgress(institutionId: string) {
  const [years, currentYears, terms, faculties, departments, qualifications, programmes, courses, offerings, staffed, schemes] = await Promise.all([
    prisma.academicYear.count({ where: { institutionId } }),
    prisma.academicYear.count({ where: { institutionId, isCurrent: true } }),
    prisma.academicTerm.count({ where: { academicYear: { institutionId } } }),
    prisma.faculty.count({ where: { institutionId } }),
    prisma.department.count({ where: { institutionId } }),
    prisma.qualification.count({ where: { institutionId } }),
    prisma.programme.count({ where: { institutionId } }),
    prisma.course.count({ where: { institutionId } }),
    prisma.courseOffering.count({ where: { institutionId } }),
    prisma.courseOffering.count({ where: { institutionId, staff: { some: {} } } }),
    prisma.gradingScheme.count({ where: { institutionId, isDefault: true } }),
  ]);
  return { years, currentYears, terms, faculties, departments, qualifications, programmes, courses, offerings, staffed, schemes };
}
