import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  buildOutline,
  findNextLesson,
  findPreviousLesson,
  isVisibleTo,
  lessonAvailability,
  moveItem,
  normaliseOrder,
  percentComplete,
  resumeLesson,
  type LessonProgressInput,
  type OutlineLessonInput,
  type OutlineSectionInput,
} from '@/server/services/course-outline';

const NOW = new Date('2026-03-15T09:00:00Z');

const lesson = (overrides: Partial<OutlineLessonInput> = {}): OutlineLessonInput => ({
  id: 'l1',
  title: 'Lesson one',
  type: 'PAGE',
  orderIndex: 0,
  isPublished: true,
  isMandatory: true,
  estimatedMinutes: 20,
  releaseOn: null,
  ...overrides,
});

const section = (overrides: Partial<OutlineSectionInput> = {}): OutlineSectionInput => ({
  id: 's1',
  title: 'Week 1',
  summary: null,
  orderIndex: 0,
  isPublished: true,
  availableFrom: null,
  availableUntil: null,
  lessons: [lesson()],
  ...overrides,
});

describe('availability', () => {
  it('opens a published lesson in an open section', () => {
    expect(lessonAvailability(lesson(), section(), NOW).state).toBe('open');
  });

  it('keeps an unpublished lesson a draft', () => {
    expect(lessonAvailability(lesson({ isPublished: false }), section(), NOW).state).toBe('draft');
  });

  it('holds a lesson until its release date', () => {
    const result = lessonAvailability(
      lesson({ releaseOn: new Date('2026-04-01T00:00:00Z') }),
      section(),
      NOW,
    );
    expect(result.state).toBe('scheduled');
  });

  it('never lets a lesson outrun the section holding it', () => {
    const closedSection = section({ availableFrom: new Date('2026-06-01T00:00:00Z') });
    expect(lessonAvailability(lesson(), closedSection, NOW).state).toBe('scheduled');
  });

  it('marks a section past its closing date as closed', () => {
    const past = section({ availableUntil: new Date('2026-01-01T00:00:00Z') });
    expect(lessonAvailability(lesson(), past, NOW).state).toBe('closed');
  });

  it('shows drafts to staff and hides them from learners', () => {
    expect(isVisibleTo({ state: 'draft' }, 'staff')).toBe(true);
    expect(isVisibleTo({ state: 'draft' }, 'learner')).toBe(false);
    expect(isVisibleTo({ state: 'scheduled', releasesOn: NOW }, 'learner')).toBe(false);
    expect(isVisibleTo({ state: 'closed', closedOn: NOW }, 'learner')).toBe(true);
  });
});

describe('outline for a learner', () => {
  const sections = [
    section({
      id: 's1',
      lessons: [
        lesson({ id: 'l1', orderIndex: 1 }),
        lesson({ id: 'l0', orderIndex: 0, title: 'Introduction' }),
        lesson({ id: 'draft', orderIndex: 2, isPublished: false }),
      ],
    }),
    section({ id: 's2', orderIndex: 1, isPublished: false, lessons: [lesson({ id: 'l2' })] }),
  ];

  const progress: LessonProgressInput[] = [
    { lessonId: 'l0', status: 'COMPLETED', secondsSpent: 600 },
  ];

  it('hides unpublished sections and lessons, and sorts by order', () => {
    const outline = buildOutline(sections, progress, 'learner', NOW);
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0]!.lessons.map((l) => l.id)).toEqual(['l0', 'l1']);
  });

  it('counts progress over the lessons the learner can actually see', () => {
    const outline = buildOutline(sections, progress, 'learner', NOW);
    expect(outline.lessonsTotal).toBe(2);
    expect(outline.lessonsComplete).toBe(1);
    expect(outline.percentComplete).toBe(50);
  });

  it('shows staff everything, drafts included', () => {
    const outline = buildOutline(sections, [], 'staff', NOW);
    expect(outline.sections).toHaveLength(2);
    expect(outline.sections[0]!.lessons).toHaveLength(3);
  });

  it('leaves optional lessons out of the progress denominator', () => {
    const outline = buildOutline(
      [section({ lessons: [lesson({ id: 'a' }), lesson({ id: 'b', orderIndex: 1, isMandatory: false })] })],
      [{ lessonId: 'a', status: 'COMPLETED', secondsSpent: 0 }],
      'learner',
      NOW,
    );
    expect(outline.lessonsTotal).toBe(1);
    expect(outline.percentComplete).toBe(100);
  });

  it('reads a course with nothing required as complete rather than dividing by zero', () => {
    expect(percentComplete(0, 0)).toBe(100);
    expect(percentComplete(1, 3)).toBe(33.3);
  });
});

describe('moving through a course', () => {
  const outline = buildOutline(
    [
      section({
        lessons: [
          lesson({ id: 'a', orderIndex: 0 }),
          lesson({ id: 'b', orderIndex: 1 }),
          lesson({ id: 'c', orderIndex: 2 }),
        ],
      }),
    ],
    [{ lessonId: 'a', status: 'COMPLETED', secondsSpent: 60 }],
    'learner',
    NOW,
  );

  it('finds the next and previous lesson', () => {
    expect(findNextLesson(outline, 'a')?.id).toBe('b');
    expect(findPreviousLesson(outline, 'b')?.id).toBe('a');
    expect(findNextLesson(outline, 'c')).toBeNull();
    expect(findPreviousLesson(outline, 'a')).toBeNull();
  });

  it('resumes at the first lesson that is not finished', () => {
    expect(resumeLesson(outline)?.id).toBe('b');
  });

  it('resumes at a lesson in progress before an untouched one', () => {
    const partial = buildOutline(
      [section({ lessons: [lesson({ id: 'a' }), lesson({ id: 'b', orderIndex: 1 })] })],
      [{ lessonId: 'b', status: 'IN_PROGRESS', secondsSpent: 30 }],
      'learner',
      NOW,
    );
    expect(resumeLesson(partial)?.id).toBe('b');
  });
});

describe('ordering', () => {
  const items = [
    { id: 'a', orderIndex: 0 },
    { id: 'b', orderIndex: 1 },
    { id: 'c', orderIndex: 2 },
  ];

  it('moves an item up and renumbers without gaps', () => {
    expect(moveItem(items, 'c', 'up').map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(moveItem(items, 'c', 'up').map((i) => i.orderIndex)).toEqual([0, 1, 2]);
  });

  it('leaves the ends alone', () => {
    expect(moveItem(items, 'a', 'up').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(moveItem(items, 'c', 'down').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('closes the gap left by a deleted item', () => {
    const withGap = [
      { id: 'a', orderIndex: 0 },
      { id: 'c', orderIndex: 7 },
    ];
    expect(normaliseOrder(withGap).map((i) => i.orderIndex)).toEqual([0, 1]);
  });

  it('applies an explicit order and keeps anything left out at the end', () => {
    const result = applyOrder(items, ['c', 'a']);
    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(result.map((i) => i.orderIndex)).toEqual([0, 1, 2]);
  });

  it('ignores ids that are not in the list', () => {
    expect(applyOrder(items, ['zzz', 'b']).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});
