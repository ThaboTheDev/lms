import 'server-only';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import {
  findPrerequisiteCycle,
  validateCurriculum,
  type CurriculumEntry,
  type PrerequisiteEdge,
} from './curriculum-rules';

export async function getProgrammeWithCurriculum(principal: Principal, programmeId: string) {
  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: {
      id: true,
      institutionId: true,
      code: true,
      title: true,
      description: true,
      durationMonths: true,
      deliveryModes: true,
      entryRequirements: true,
      isActive: true,
      department: { select: { id: true, name: true, faculty: { select: { name: true } } } },
      qualification: {
        select: { id: true, code: true, title: true, type: true, nqfLevel: true, minimumCredits: true },
      },
      coordinator: { select: { firstName: true, lastName: true, email: true } },
      outcomes: { orderBy: { orderIndex: 'asc' }, select: { id: true, code: true, statement: true } },
      curriculum: {
        orderBy: [{ yearOfStudy: 'asc' }, { termNumber: 'asc' }, { orderIndex: 'asc' }],
        select: {
          id: true,
          yearOfStudy: true,
          termNumber: true,
          isCompulsory: true,
          credits: true,
          course: {
            select: {
              id: true,
              code: true,
              title: true,
              credits: true,
              prerequisites: {
                select: {
                  kind: true,
                  requiredCourse: { select: { id: true, code: true, title: true } },
                },
              },
            },
          },
        },
      },
      _count: { select: { enrolments: true } },
    },
  });

  if (!programme) throw new NotFoundError('Programme');
  requireSameInstitution(principal, programme.institutionId);
  requirePermission(principal, 'programme.read', { institutionId: programme.institutionId });

  const entries: CurriculumEntry[] = programme.curriculum.map((item) => ({
    courseId: item.course.id,
    courseCode: item.course.code,
    yearOfStudy: item.yearOfStudy,
    termNumber: item.termNumber,
    isCompulsory: item.isCompulsory,
    credits: item.credits ?? item.course.credits,
  }));

  const problems = validateCurriculum(entries, {
    minimumCredits: programme.qualification.minimumCredits,
    durationMonths: programme.durationMonths,
  });

  const totalCredits = entries.reduce((total, entry) => total + entry.credits, 0);

  return { programme, problems, totalCredits };
}

/** Adds a course to a programme's curriculum at a given year and term. */
export async function addCurriculumItem(
  principal: Principal,
  input: {
    programmeId: string;
    courseId: string;
    yearOfStudy: number;
    termNumber: number;
    isCompulsory: boolean;
    credits?: number;
  },
) {
  const programme = await prisma.programme.findUnique({
    where: { id: input.programmeId },
    select: { id: true, institutionId: true, code: true },
  });
  if (!programme) throw new NotFoundError('Programme');
  requireSameInstitution(principal, programme.institutionId);
  requirePermission(principal, 'programme.manage', { institutionId: programme.institutionId });

  const course = await prisma.course.findFirst({
    where: { id: input.courseId, institutionId: programme.institutionId },
    select: { id: true, code: true },
  });
  if (!course) throw new ValidationError({ courseId: 'That course belongs to another institution.' });

  const duplicate = await prisma.curriculumItem.findFirst({
    where: { programmeId: input.programmeId, courseId: input.courseId },
    select: { yearOfStudy: true, termNumber: true },
  });
  if (duplicate) {
    throw new ValidationError({
      courseId: `${course.code} is already in this curriculum, in year ${duplicate.yearOfStudy} term ${duplicate.termNumber}.`,
    });
  }

  const item = await prisma.curriculumItem.create({
    data: {
      programmeId: input.programmeId,
      courseId: input.courseId,
      yearOfStudy: input.yearOfStudy,
      termNumber: input.termNumber,
      isCompulsory: input.isCompulsory,
      credits: input.credits,
    },
  });

  await recordAudit(principal, {
    action: 'curriculum.item_added',
    entityType: 'Programme',
    entityId: input.programmeId,
    institutionId: programme.institutionId,
    after: { course: course.code, year: input.yearOfStudy, term: input.termNumber },
  });

  return item;
}

export async function removeCurriculumItem(principal: Principal, itemId: string) {
  const item = await prisma.curriculumItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      programme: { select: { id: true, institutionId: true } },
      course: { select: { code: true } },
    },
  });
  if (!item) throw new NotFoundError('Curriculum entry');
  requireSameInstitution(principal, item.programme.institutionId);
  requirePermission(principal, 'programme.manage', { institutionId: item.programme.institutionId });

  await prisma.curriculumItem.delete({ where: { id: itemId } });
  await recordAudit(principal, {
    action: 'curriculum.item_removed',
    entityType: 'Programme',
    entityId: item.programme.id,
    institutionId: item.programme.institutionId,
    before: { course: item.course.code },
  });
}

/**
 * Adds a prerequisite rule, refusing any rule that would make the graph
 * circular. The check runs against the proposed graph, not the stored one, so a
 * cycle is never written in the first place.
 */
export async function addPrerequisite(
  principal: Principal,
  input: { courseId: string; requiredCourseId: string; kind: 'PREREQUISITE' | 'COREQUISITE' | 'RECOMMENDED' },
) {
  if (input.courseId === input.requiredCourseId) {
    throw new ValidationError({ requiredCourseId: 'A course cannot be its own prerequisite.' });
  }

  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    select: { id: true, institutionId: true, code: true },
  });
  if (!course) throw new NotFoundError('Course');
  requireSameInstitution(principal, course.institutionId);
  requirePermission(principal, 'programme.manage', { institutionId: course.institutionId });

  const existing = await prisma.coursePrerequisite.findMany({
    where: { course: { institutionId: course.institutionId } },
    select: { courseId: true, requiredCourseId: true, kind: true },
  });

  const proposed: PrerequisiteEdge[] = [
    ...existing.map((edge) => ({ ...edge, kind: edge.kind as PrerequisiteEdge['kind'] })),
    input,
  ];

  const cycle = findPrerequisiteCycle(proposed);
  if (cycle) {
    const codes = await prisma.course.findMany({
      where: { id: { in: cycle } },
      select: { id: true, code: true },
    });
    const byId = new Map(codes.map((c) => [c.id, c.code]));
    throw new ValidationError({
      requiredCourseId: `That rule would create a loop: ${cycle.map((id) => byId.get(id) ?? id).join(' needs ')}.`,
    });
  }

  const rule = await prisma.coursePrerequisite.create({
    data: {
      courseId: input.courseId,
      requiredCourseId: input.requiredCourseId,
      kind: input.kind,
    },
  });

  await recordAudit(principal, {
    action: 'course.prerequisite_added',
    entityType: 'Course',
    entityId: input.courseId,
    institutionId: course.institutionId,
    after: { kind: input.kind, requiredCourseId: input.requiredCourseId },
  });

  return rule;
}
