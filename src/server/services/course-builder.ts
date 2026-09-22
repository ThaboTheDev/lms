import 'server-only';
import { prisma, type Prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { can, requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { applyOrder, moveItem, normaliseOrder } from './course-outline';

/**
 * Teaching staff author against the offering they are assigned to. Holding
 * course.teach institution-wide is not enough on its own: a lecturer edits the
 * deliveries they run, and only a course administrator edits any of them.
 */
export async function assertCanEditOffering(principal: Principal, offeringId: string) {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      institutionId: true,
      status: true,
      course: { select: { id: true, code: true, title: true, departmentId: true } },
      staff: { select: { userId: true, role: true } },
    },
  });
  if (!offering) throw new NotFoundError('Course delivery');
  requireSameInstitution(principal, offering.institutionId);

  const scope = { institutionId: offering.institutionId, courseOfferingId: offering.id };
  const assigned = offering.staff.some(
    (member) => member.userId === principal.userId && ['LECTURER', 'FACILITATOR', 'TUTOR'].includes(member.role),
  );

  if (assigned && can(principal, 'course.teach', scope)) return offering;

  requirePermission(principal, 'course.manage', scope);
  return offering;
}

export async function assertCanViewOffering(principal: Principal, offeringId: string) {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      institutionId: true,
      status: true,
      sectionCode: true,
      deliveryMode: true,
      course: { select: { code: true, title: true, description: true, credits: true } },
      academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
      staff: {
        select: { userId: true, role: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
    },
  });
  if (!offering) throw new NotFoundError('Course delivery');
  requireSameInstitution(principal, offering.institutionId);

  const teaches = offering.staff.some((member) => member.userId === principal.userId);
  if (teaches) return { offering, viewer: 'staff' as const };

  if (principal.studentId) {
    const enrolled = await prisma.courseEnrolment.count({
      where: { offeringId, studentId: principal.studentId, status: { in: ['ACTIVE', 'COMPLETED'] } },
    });
    if (enrolled > 0) return { offering, viewer: 'learner' as const };
  }

  requirePermission(principal, 'course.manage', {
    institutionId: offering.institutionId,
    courseOfferingId: offering.id,
  });
  return { offering, viewer: 'staff' as const };
}

/* ------------------------------------------------------------- sections -- */

export async function createSection(
  principal: Principal,
  offeringId: string,
  input: { title: string; summary?: string },
) {
  const offering = await assertCanEditOffering(principal, offeringId);

  const last = await prisma.courseSection.findFirst({
    where: { offeringId },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  });

  const section = await prisma.courseSection.create({
    data: {
      offeringId,
      title: input.title,
      summary: input.summary || null,
      orderIndex: (last?.orderIndex ?? -1) + 1,
    },
  });

  await recordAudit(principal, {
    action: 'course.section_created',
    entityType: 'CourseOffering',
    entityId: offeringId,
    institutionId: offering.institutionId,
    after: { title: input.title },
  });

  return section;
}

export async function updateSection(
  principal: Principal,
  sectionId: string,
  input: { title?: string; summary?: string | null; isPublished?: boolean; availableFrom?: Date | null; availableUntil?: Date | null },
) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, offeringId: true, title: true, isPublished: true },
  });
  if (!section) throw new NotFoundError('Section');
  const offering = await assertCanEditOffering(principal, section.offeringId);

  if (input.availableFrom && input.availableUntil && input.availableFrom > input.availableUntil) {
    throw new AppError('The closing date cannot be before the opening date.', 422, 'invalid_window');
  }

  const updated = await prisma.courseSection.update({ where: { id: sectionId }, data: input });

  await recordAudit(principal, {
    action: 'course.section_updated',
    entityType: 'CourseSection',
    entityId: sectionId,
    institutionId: offering.institutionId,
    before: { title: section.title, isPublished: section.isPublished },
    after: { title: updated.title, isPublished: updated.isPublished },
  });

  return updated;
}

export async function deleteSection(principal: Principal, sectionId: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, offeringId: true, title: true, _count: { select: { lessons: true } } },
  });
  if (!section) throw new NotFoundError('Section');
  await assertCanEditOffering(principal, section.offeringId);

  // Deleting a section with work in it is almost always a misclick.
  if (section._count.lessons > 0) {
    throw new AppError(
      `Move or delete the ${section._count.lessons} lessons in this section first.`,
      409,
      'section_not_empty',
    );
  }

  await prisma.courseSection.delete({ where: { id: sectionId } });
  await renumberSections(section.offeringId);
}

/* -------------------------------------------------------------- lessons -- */

export async function createLesson(
  principal: Principal,
  sectionId: string,
  input: { title: string; type: string; summary?: string; estimatedMinutes?: number; isMandatory?: boolean },
) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, offeringId: true },
  });
  if (!section) throw new NotFoundError('Section');
  const offering = await assertCanEditOffering(principal, section.offeringId);

  const last = await prisma.lesson.findFirst({
    where: { sectionId },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  });

  const lesson = await prisma.lesson.create({
    data: {
      sectionId,
      title: input.title,
      summary: input.summary || null,
      type: input.type as never,
      estimatedMinutes: input.estimatedMinutes ?? null,
      isMandatory: input.isMandatory ?? true,
      orderIndex: (last?.orderIndex ?? -1) + 1,
    },
  });

  await recordAudit(principal, {
    action: 'course.lesson_created',
    entityType: 'CourseOffering',
    entityId: section.offeringId,
    institutionId: offering.institutionId,
    after: { title: input.title, type: input.type },
  });

  return lesson;
}

export async function updateLesson(
  principal: Principal,
  lessonId: string,
  input: Record<string, unknown>,
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, title: true, isPublished: true, section: { select: { offeringId: true } } },
  });
  if (!lesson) throw new NotFoundError('Lesson');
  const offering = await assertCanEditOffering(principal, lesson.section.offeringId);

  const updated = await prisma.lesson.update({ where: { id: lessonId }, data: input as never });

  await recordAudit(principal, {
    action: 'course.lesson_updated',
    entityType: 'Lesson',
    entityId: lessonId,
    institutionId: offering.institutionId,
    before: { title: lesson.title, isPublished: lesson.isPublished },
    after: { title: updated.title, isPublished: updated.isPublished },
  });

  return updated;
}

export async function deleteLesson(principal: Principal, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, sectionId: true, section: { select: { offeringId: true } } },
  });
  if (!lesson) throw new NotFoundError('Lesson');
  await assertCanEditOffering(principal, lesson.section.offeringId);

  await prisma.lesson.delete({ where: { id: lessonId } });
  await renumberLessons(lesson.sectionId);
}

/* --------------------------------------------------------------- blocks -- */

export async function addBlock(
  principal: Principal,
  lessonId: string,
  input: { kind: string; richText?: unknown; fileId?: string; url?: string; settings?: unknown },
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, section: { select: { offeringId: true } } },
  });
  if (!lesson) throw new NotFoundError('Lesson');
  const offering = await assertCanEditOffering(principal, lesson.section.offeringId);

  if (input.fileId) {
    const file = await prisma.fileObject.findUnique({
      where: { id: input.fileId },
      select: { institutionId: true },
    });
    if (!file || file.institutionId !== offering.institutionId) {
      throw new AppError('That file belongs to another institution.', 403, 'forbidden');
    }
  }

  const last = await prisma.lessonBlock.findFirst({
    where: { lessonId },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  });

  return prisma.lessonBlock.create({
    data: {
      lessonId,
      kind: input.kind as never,
      richText: (input.richText ?? undefined) as never,
      fileId: input.fileId || null,
      url: input.url || null,
      settings: (input.settings ?? undefined) as never,
      orderIndex: (last?.orderIndex ?? -1) + 1,
    },
  });
}

export async function deleteBlock(principal: Principal, blockId: string) {
  const block = await prisma.lessonBlock.findUnique({
    where: { id: blockId },
    select: { id: true, lessonId: true, lesson: { select: { section: { select: { offeringId: true } } } } },
  });
  if (!block) throw new NotFoundError('Block');
  await assertCanEditOffering(principal, block.lesson.section.offeringId);

  await prisma.lessonBlock.delete({ where: { id: blockId } });
  const remaining = await prisma.lessonBlock.findMany({
    where: { lessonId: block.lessonId },
    select: { id: true, orderIndex: true },
  });
  await writeOrder('lessonBlock', normaliseOrder(remaining));
}

/* ------------------------------------------------------------ ordering --- */

type OrderableTable = 'courseSection' | 'lesson' | 'lessonBlock';

async function writeOrder(table: OrderableTable, items: { id: string; orderIndex: number }[]) {
  if (items.length === 0) return;
  // One transaction, every index rewritten: the sequence stays gapless and two
  // concurrent reorders cannot interleave into a half-applied order.
  await prisma.$transaction(
    items.map((item) =>
      // Typed as a PrismaPromise rather than a plain Promise: `$transaction`
      // batches the array into one round trip, and only Prisma's own promises
      // can be told apart from one another to do that.
      (prisma[table] as unknown as {
        update: (args: {
          where: { id: string };
          data: { orderIndex: number };
        }) => Prisma.PrismaPromise<unknown>;
      }).update({ where: { id: item.id }, data: { orderIndex: item.orderIndex } }),
    ),
  );
}

export async function moveSection(principal: Principal, sectionId: string, direction: 'up' | 'down') {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { offeringId: true },
  });
  if (!section) throw new NotFoundError('Section');
  await assertCanEditOffering(principal, section.offeringId);

  const sections = await prisma.courseSection.findMany({
    where: { offeringId: section.offeringId },
    select: { id: true, orderIndex: true },
  });
  await writeOrder('courseSection', moveItem(sections, sectionId, direction));
}

export async function moveLesson(principal: Principal, lessonId: string, direction: 'up' | 'down') {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { sectionId: true, section: { select: { offeringId: true } } },
  });
  if (!lesson) throw new NotFoundError('Lesson');
  await assertCanEditOffering(principal, lesson.section.offeringId);

  const lessons = await prisma.lesson.findMany({
    where: { sectionId: lesson.sectionId },
    select: { id: true, orderIndex: true },
  });
  await writeOrder('lesson', moveItem(lessons, lessonId, direction));
}

/** Used by the drag and drop handle, which posts the full new order. */
export async function reorderLessons(principal: Principal, sectionId: string, orderedIds: string[]) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: { offeringId: true },
  });
  if (!section) throw new NotFoundError('Section');
  await assertCanEditOffering(principal, section.offeringId);

  const lessons = await prisma.lesson.findMany({
    where: { sectionId },
    select: { id: true, orderIndex: true },
  });
  await writeOrder('lesson', applyOrder(lessons, orderedIds));
}

async function renumberSections(offeringId: string) {
  const sections = await prisma.courseSection.findMany({
    where: { offeringId },
    select: { id: true, orderIndex: true },
    orderBy: { orderIndex: 'asc' },
  });
  await writeOrder('courseSection', normaliseOrder(sections));
}

async function renumberLessons(sectionId: string) {
  const lessons = await prisma.lesson.findMany({
    where: { sectionId },
    select: { id: true, orderIndex: true },
    orderBy: { orderIndex: 'asc' },
  });
  await writeOrder('lesson', normaliseOrder(lessons));
}
