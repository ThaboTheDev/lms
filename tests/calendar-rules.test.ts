import { describe, expect, it } from 'vitest';
import {
  findConflicts,
  groupByDay,
  isVisibleTo,
  upcoming,
  type CalendarItem,
  type ViewerContext,
} from '@/server/services/calendar-rules';

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'e1',
    title: 'Lecture',
    type: 'LECTURE',
    visibility: 'COURSE',
    startsAt: new Date('2026-03-10T09:00:00Z'),
    endsAt: new Date('2026-03-10T10:00:00Z'),
    allDay: false,
    location: 'Room 3',
    offeringId: 'off1',
    programmeId: null,
    facultyId: null,
    createdById: 'usr1',
    ...overrides,
  };
}

const viewer: ViewerContext = {
  userId: 'usr2',
  offeringIds: ['off1'],
  programmeIds: ['prog1'],
  facultyIds: ['fac1'],
  seesEverything: false,
};

describe('visibility', () => {
  it('shows a course event to someone on the course', () => {
    expect(isVisibleTo(item(), viewer)).toBe(true);
    expect(isVisibleTo(item({ offeringId: 'off9' }), viewer)).toBe(false);
  });

  it('shows institution events to everyone', () => {
    expect(isVisibleTo(item({ visibility: 'INSTITUTION', offeringId: null }), viewer)).toBe(true);
  });

  it('keeps a private event to the person who made it', () => {
    expect(isVisibleTo(item({ visibility: 'PRIVATE', createdById: 'usr9' }), viewer)).toBe(false);
    expect(isVisibleTo(item({ visibility: 'PRIVATE', createdById: 'usr2' }), viewer)).toBe(true);
  });

  it('lets an administrator see everything', () => {
    expect(isVisibleTo(item({ offeringId: 'off9' }), { ...viewer, seesEverything: true })).toBe(true);
  });

  it('matches faculty and programme scopes', () => {
    expect(isVisibleTo(item({ visibility: 'FACULTY', facultyId: 'fac1' }), viewer)).toBe(true);
    expect(isVisibleTo(item({ visibility: 'PROGRAMME', programmeId: 'prog9' }), viewer)).toBe(false);
  });
});

describe('grouping', () => {
  it('includes days with nothing on them', () => {
    const days = groupByDay([item()], new Date('2026-03-09T00:00:00Z'), new Date('2026-03-11T00:00:00Z'));
    expect(days).toHaveLength(3);
    expect(days[1]!.items).toHaveLength(1);
    expect(days[0]!.items).toHaveLength(0);
  });

  it('repeats an event across every day it spans', () => {
    const conference = item({
      startsAt: new Date('2026-03-09T08:00:00Z'),
      endsAt: new Date('2026-03-11T17:00:00Z'),
      allDay: true,
    });
    const days = groupByDay([conference], new Date('2026-03-09T00:00:00Z'), new Date('2026-03-11T00:00:00Z'));
    expect(days.every((day) => day.items.length === 1)).toBe(true);
  });

  it('orders a day by start time', () => {
    const later = item({ id: 'e2', startsAt: new Date('2026-03-10T14:00:00Z'), endsAt: new Date('2026-03-10T15:00:00Z') });
    const days = groupByDay([later, item()], new Date('2026-03-10T00:00:00Z'), new Date('2026-03-10T00:00:00Z'));
    expect(days[0]!.items.map((entry) => entry.id)).toEqual(['e1', 'e2']);
  });
});

describe('conflicts', () => {
  it('finds an overlap and says how long it is', () => {
    const conflicts = findConflicts([
      item(),
      item({ id: 'e2', startsAt: new Date('2026-03-10T09:30:00Z'), endsAt: new Date('2026-03-10T10:30:00Z') }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.overlapMinutes).toBe(30);
  });

  it('leaves back to back sessions alone', () => {
    const conflicts = findConflicts([
      item(),
      item({ id: 'e2', startsAt: new Date('2026-03-10T10:00:00Z'), endsAt: new Date('2026-03-10T11:00:00Z') }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('ignores all day events, which overlap everything by nature', () => {
    const conflicts = findConflicts([item(), item({ id: 'e2', allDay: true })]);
    expect(conflicts).toHaveLength(0);
  });
});

describe('upcoming', () => {
  it('drops what has finished and returns the soonest first', () => {
    const past = item({ id: 'past', startsAt: new Date('2026-03-01T09:00:00Z'), endsAt: new Date('2026-03-01T10:00:00Z') });
    const soon = item({ id: 'soon', startsAt: new Date('2026-03-12T09:00:00Z'), endsAt: new Date('2026-03-12T10:00:00Z') });
    const result = upcoming([soon, past, item()], new Date('2026-03-05T00:00:00Z'), 5);
    expect(result.map((entry) => entry.id)).toEqual(['e1', 'soon']);
  });
});
