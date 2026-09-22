/**
 * Pure rules for a course outline: what is visible, what counts as done, and
 * how items are ordered. Kept free of the database so the builder, the learner
 * view and the progress recalculation job all answer these questions the same
 * way, and so the rules can be tested directly.
 */

export type Viewer = 'staff' | 'learner';

export interface OutlineLessonInput {
  id: string;
  title: string;
  type: string;
  orderIndex: number;
  isPublished: boolean;
  isMandatory: boolean;
  estimatedMinutes: number | null;
  releaseOn: Date | null;
}

export interface OutlineSectionInput {
  id: string;
  title: string;
  summary: string | null;
  orderIndex: number;
  isPublished: boolean;
  availableFrom: Date | null;
  availableUntil: Date | null;
  lessons: OutlineLessonInput[];
}

export interface LessonProgressInput {
  lessonId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  secondsSpent: number;
}

export type Availability =
  | { state: 'open' }
  | { state: 'scheduled'; releasesOn: Date }
  | { state: 'closed'; closedOn: Date }
  | { state: 'draft' };

export interface OutlineLesson extends OutlineLessonInput {
  availability: Availability;
  progress: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  locked: boolean;
}

export interface OutlineSection extends Omit<OutlineSectionInput, 'lessons'> {
  availability: Availability;
  lessons: OutlineLesson[];
  lessonsTotal: number;
  lessonsComplete: number;
}

export interface Outline {
  sections: OutlineSection[];
  lessonsTotal: number;
  lessonsComplete: number;
  percentComplete: number;
  estimatedMinutes: number;
}

function sectionAvailability(section: OutlineSectionInput, now: Date): Availability {
  if (!section.isPublished) return { state: 'draft' };
  if (section.availableFrom && section.availableFrom > now) {
    return { state: 'scheduled', releasesOn: section.availableFrom };
  }
  if (section.availableUntil && section.availableUntil < now) {
    return { state: 'closed', closedOn: section.availableUntil };
  }
  return { state: 'open' };
}

/**
 * A lesson is never more available than the section holding it: a published
 * lesson inside a section that has not opened yet is still scheduled.
 */
export function lessonAvailability(
  lesson: OutlineLessonInput,
  section: OutlineSectionInput,
  now: Date,
): Availability {
  const parent = sectionAvailability(section, now);
  if (parent.state !== 'open') return parent;
  if (!lesson.isPublished) return { state: 'draft' };
  if (lesson.releaseOn && lesson.releaseOn > now) {
    return { state: 'scheduled', releasesOn: lesson.releaseOn };
  }
  return { state: 'open' };
}

/** Staff see their drafts; learners only ever see what is open. */
export function isVisibleTo(availability: Availability, viewer: Viewer): boolean {
  if (viewer === 'staff') return true;
  return availability.state === 'open' || availability.state === 'closed';
}

export function buildOutline(
  sections: OutlineSectionInput[],
  progress: LessonProgressInput[],
  viewer: Viewer,
  now: Date = new Date(),
): Outline {
  const progressByLesson = new Map(progress.map((entry) => [entry.lessonId, entry]));

  const orderedSections = [...sections].sort((a, b) => a.orderIndex - b.orderIndex);

  const built: OutlineSection[] = [];

  for (const section of orderedSections) {
    const availability = sectionAvailability(section, now);
    if (!isVisibleTo(availability, viewer)) continue;

    const lessons: OutlineLesson[] = [...section.lessons]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((lesson) => {
        const lessonState = lessonAvailability(lesson, section, now);
        return {
          ...lesson,
          availability: lessonState,
          progress: progressByLesson.get(lesson.id)?.status ?? 'NOT_STARTED',
          locked: lessonState.state !== 'open',
        };
      })
      .filter((lesson) => isVisibleTo(lesson.availability, viewer));

    built.push({
      id: section.id,
      title: section.title,
      summary: section.summary,
      orderIndex: section.orderIndex,
      isPublished: section.isPublished,
      availableFrom: section.availableFrom,
      availableUntil: section.availableUntil,
      availability,
      lessons,
      lessonsTotal: lessons.filter((lesson) => lesson.isMandatory).length,
      lessonsComplete: lessons.filter((lesson) => lesson.isMandatory && lesson.progress === 'COMPLETED').length,
    });
  }

  const lessonsTotal = built.reduce((sum, section) => sum + section.lessonsTotal, 0);
  const lessonsComplete = built.reduce((sum, section) => sum + section.lessonsComplete, 0);
  const estimatedMinutes = built
    .flatMap((section) => section.lessons)
    .reduce((sum, lesson) => sum + (lesson.estimatedMinutes ?? 0), 0);

  return {
    sections: built,
    lessonsTotal,
    lessonsComplete,
    percentComplete: percentComplete(lessonsComplete, lessonsTotal),
    estimatedMinutes,
  };
}

/**
 * Progress counts mandatory lessons only. Optional reading should not make a
 * learner look behind, and a course of nothing but optional material reads as
 * complete rather than as a divide by zero.
 */
export function percentComplete(complete: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((complete / total) * 1000) / 10;
}

/** Flattens the outline into the order a learner moves through it. */
export function flattenLessons(outline: Outline): OutlineLesson[] {
  return outline.sections.flatMap((section) => section.lessons);
}

export function findNextLesson(outline: Outline, currentLessonId: string): OutlineLesson | null {
  const lessons = flattenLessons(outline).filter((lesson) => !lesson.locked);
  const index = lessons.findIndex((lesson) => lesson.id === currentLessonId);
  if (index === -1) return null;
  return lessons[index + 1] ?? null;
}

export function findPreviousLesson(outline: Outline, currentLessonId: string): OutlineLesson | null {
  const lessons = flattenLessons(outline).filter((lesson) => !lesson.locked);
  const index = lessons.findIndex((lesson) => lesson.id === currentLessonId);
  if (index <= 0) return null;
  return lessons[index - 1] ?? null;
}

/** The first thing a learner should open: where they left off, else the start. */
export function resumeLesson(outline: Outline): OutlineLesson | null {
  const lessons = flattenLessons(outline).filter((lesson) => !lesson.locked);
  return (
    lessons.find((lesson) => lesson.progress === 'IN_PROGRESS') ??
    lessons.find((lesson) => lesson.progress !== 'COMPLETED') ??
    lessons[0] ??
    null
  );
}

export interface Orderable {
  id: string;
  orderIndex: number;
}

/**
 * Moves one item and returns the complete new ordering. Builders reorder by
 * rewriting every index in a transaction rather than swapping two rows, which
 * keeps the sequence gapless after any number of moves.
 */
export function moveItem<T extends Orderable>(items: T[], id: string, direction: 'up' | 'down'): T[] {
  const ordered = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
  const index = ordered.findIndex((item) => item.id === id);
  if (index === -1) return normaliseOrder(ordered);

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return normaliseOrder(ordered);

  const moved = ordered[index]!;
  ordered[index] = ordered[target]!;
  ordered[target] = moved;
  return normaliseOrder(ordered);
}

/** Reorders to an explicit list of ids, ignoring anything unknown. */
export function applyOrder<T extends Orderable>(items: T[], orderedIds: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const moved = orderedIds.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
  const remainder = items
    .filter((item) => !orderedIds.includes(item.id))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  return normaliseOrder([...moved, ...remainder]);
}

export function normaliseOrder<T extends Orderable>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, orderIndex: index }));
}
