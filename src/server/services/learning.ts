import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { queue } from '@/lib/queue';
import type { Principal } from '@/lib/rbac/authorize';
import { assertCanViewOffering } from './course-builder';
import {
  buildOutline,
  findNextLesson,
  findPreviousLesson,
  percentComplete,
  resumeLesson,
  type Outline,
  type Viewer,
} from './course-outline';

/** Loads the outline for one delivery, shaped for whoever is looking at it. */
export async function loadCourse(principal: Principal, offeringId: string) {
  const { offering, viewer } = await assertCanViewOffering(principal, offeringId);

  const [sections, progress] = await Promise.all([
    prisma.courseSection.findMany({
      where: { offeringId },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        title: true,
        summary: true,
        orderIndex: true,
        isPublished: true,
        availableFrom: true,
        availableUntil: true,
        lessons: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            type: true,
            orderIndex: true,
            isPublished: true,
            isMandatory: true,
            estimatedMinutes: true,
            releaseOn: true,
          },
        },
      },
    }),
    principal.studentId
      ? prisma.lessonProgress.findMany({
          where: { studentId: principal.studentId, lesson: { section: { offeringId } } },
          select: { lessonId: true, status: true, secondsSpent: true },
        })
      : Promise.resolve([]),
  ]);

  const outline = buildOutline(sections as never, progress as never, viewer as Viewer);
  return { offering, viewer, outline, resume: resumeLesson(outline) };
}

/**
 * Opens a lesson. A learner cannot read a lesson that is still a draft or has
 * not been released, even by typing its id into the address bar: the outline is
 * rebuilt for them and the lesson looked up inside it.
 */
export async function loadLesson(principal: Principal, offeringId: string, lessonId: string) {
  const { offering, viewer, outline } = await loadCourse(principal, offeringId);

  const visible = outline.sections
    .flatMap((section) => section.lessons)
    .find((lesson) => lesson.id === lessonId);

  if (!visible) throw new NotFoundError('Lesson');
  if (visible.locked && viewer === 'learner') {
    throw new AppError('This lesson has not been released yet.', 403, 'lesson_locked');
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      title: true,
      summary: true,
      type: true,
      estimatedMinutes: true,
      isMandatory: true,
      isPublished: true,
      externalRef: true,
      section: { select: { id: true, title: true } },
      blocks: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          kind: true,
          orderIndex: true,
          richText: true,
          url: true,
          settings: true,
          file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true } },
        },
      },
    },
  });
  if (!lesson) throw new NotFoundError('Lesson');

  const progress = principal.studentId
    ? await prisma.lessonProgress.findUnique({
        where: { studentId_lessonId: { studentId: principal.studentId, lessonId } },
        select: { status: true, secondsSpent: true, lastPositionSec: true, completedAt: true },
      })
    : null;

  return {
    offering,
    viewer,
    lesson,
    progress,
    outline,
    next: findNextLesson(outline, lessonId),
    previous: findPreviousLesson(outline, lessonId),
  };
}

export interface ProgressUpdate {
  lessonId: string;
  status?: 'IN_PROGRESS' | 'COMPLETED';
  secondsSpent?: number;
  lastPositionSec?: number;
}

/**
 * Records learner progress. Called when a lesson opens, periodically while a
 * video plays, and when the learner marks a lesson done. Progress only ever
 * moves forward: a replayed or out of order update cannot un-complete a lesson.
 */
export async function recordProgress(principal: Principal, update: ProgressUpdate) {
  if (!principal.studentId) {
    throw new AppError('Only a learner records progress.', 403, 'not_a_learner');
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: update.lessonId },
    select: { id: true, section: { select: { offeringId: true } } },
  });
  if (!lesson) throw new NotFoundError('Lesson');

  const offeringId = lesson.section.offeringId;
  await assertCanViewOffering(principal, offeringId);

  const existing = await prisma.lessonProgress.findUnique({
    where: { studentId_lessonId: { studentId: principal.studentId, lessonId: update.lessonId } },
    select: { status: true, secondsSpent: true },
  });

  const alreadyComplete = existing?.status === 'COMPLETED';
  const status = alreadyComplete ? 'COMPLETED' : update.status ?? existing?.status ?? 'IN_PROGRESS';

  await prisma.lessonProgress.upsert({
    where: { studentId_lessonId: { studentId: principal.studentId, lessonId: update.lessonId } },
    create: {
      studentId: principal.studentId,
      lessonId: update.lessonId,
      status,
      secondsSpent: update.secondsSpent ?? 0,
      lastPositionSec: update.lastPositionSec ?? null,
      startedAt: new Date(),
      completedAt: status === 'COMPLETED' ? new Date() : null,
    },
    update: {
      status,
      // Seconds accumulate; a tab reopened at zero must not reset the total.
      secondsSpent: Math.max(existing?.secondsSpent ?? 0, update.secondsSpent ?? 0),
      lastPositionSec: update.lastPositionSec ?? undefined,
      completedAt: status === 'COMPLETED' && !alreadyComplete ? new Date() : undefined,
    },
  });

  await recalculateCourseProgress(principal.studentId, offeringId);
  return { status };
}

/**
 * Rolls lesson progress up to the course. Cheap enough to run inline today; it
 * is queued for the nightly recalculation as well so a missed update self heals.
 */
export async function recalculateCourseProgress(studentId: string, offeringId: string) {
  const [lessons, completed, totals] = await Promise.all([
    prisma.lesson.count({ where: { section: { offeringId }, isPublished: true, isMandatory: true } }),
    prisma.lessonProgress.count({
      where: {
        studentId,
        status: 'COMPLETED',
        lesson: { section: { offeringId }, isPublished: true, isMandatory: true },
      },
    }),
    prisma.lessonProgress.aggregate({
      where: { studentId, lesson: { section: { offeringId } } },
      _sum: { secondsSpent: true },
    }),
  ]);

  const percent = percentComplete(completed, lessons);

  await prisma.courseProgress.upsert({
    where: { studentId_offeringId: { studentId, offeringId } },
    create: {
      studentId,
      offeringId,
      percentComplete: percent,
      lessonsTotal: lessons,
      lessonsComplete: completed,
      learningMinutes: Math.round((totals._sum.secondsSpent ?? 0) / 60),
      lastActivityAt: new Date(),
    },
    update: {
      percentComplete: percent,
      lessonsTotal: lessons,
      lessonsComplete: completed,
      learningMinutes: Math.round((totals._sum.secondsSpent ?? 0) / 60),
      lastActivityAt: new Date(),
    },
  });

  // TODO(phase-9): feed the at-risk indicators from this rollup.
  await queue.enqueue('analytics.recalculate', { studentId, offeringId });
  return percent;
}

/** The learner's own course list, with progress, for their dashboard. */
export async function listMyCourses(principal: Principal) {
  if (!principal.studentId) return [];

  const enrolments = await prisma.courseEnrolment.findMany({
    where: { studentId: principal.studentId, status: { in: ['ACTIVE', 'COMPLETED'] } },
    select: {
      id: true,
      status: true,
      offering: {
        select: {
          id: true,
          sectionCode: true,
          course: { select: { code: true, title: true, credits: true } },
          academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
          staff: {
            where: { role: 'LECTURER' },
            take: 1,
            select: { user: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  });

  const progress = await prisma.courseProgress.findMany({
    where: { studentId: principal.studentId },
    select: { offeringId: true, percentComplete: true, lessonsComplete: true, lessonsTotal: true },
  });
  const byOffering = new Map(progress.map((row) => [row.offeringId, row]));

  return enrolments.map((enrolment) => ({
    ...enrolment,
    progress: byOffering.get(enrolment.offering.id) ?? null,
  }));
}

export type { Outline };
