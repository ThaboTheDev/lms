/**
 * Calendar shaping: what a person may see, how a range is grouped, and where
 * two commitments collide. Pure, so the month view, the week view and the
 * reminder job all agree.
 */

export type EventVisibility = 'INSTITUTION' | 'FACULTY' | 'PROGRAMME' | 'COURSE' | 'PRIVATE';

export interface CalendarItem {
  id: string;
  title: string;
  type: string;
  visibility: EventVisibility;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  offeringId: string | null;
  programmeId: string | null;
  facultyId: string | null;
  createdById: string | null;
}

export interface ViewerContext {
  userId: string;
  offeringIds: string[];
  programmeIds: string[];
  facultyIds: string[];
  seesEverything: boolean;
}

/**
 * An event is visible when the viewer belongs to the thing it is scoped to.
 * Institution-wide events reach everyone; a private event reaches only the
 * person who made it.
 */
export function isVisibleTo(item: CalendarItem, viewer: ViewerContext): boolean {
  if (viewer.seesEverything) return true;

  switch (item.visibility) {
    case 'INSTITUTION':
      return true;
    case 'FACULTY':
      return !!item.facultyId && viewer.facultyIds.includes(item.facultyId);
    case 'PROGRAMME':
      return !!item.programmeId && viewer.programmeIds.includes(item.programmeId);
    case 'COURSE':
      return !!item.offeringId && viewer.offeringIds.includes(item.offeringId);
    case 'PRIVATE':
      return item.createdById === viewer.userId;
    default:
      return false;
  }
}

export interface CalendarDay {
  date: Date;
  items: CalendarItem[];
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Groups into days across the whole range, including empty ones, so a week view
 * does not silently skip a quiet Wednesday. An event spanning days appears on
 * each day it covers.
 */
export function groupByDay(items: CalendarItem[], from: Date, to: Date): CalendarDay[] {
  const days: CalendarDay[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const start = new Date(item.startsAt.getFullYear(), item.startsAt.getMonth(), item.startsAt.getDate());
    const end = new Date(item.endsAt.getFullYear(), item.endsAt.getMonth(), item.endsAt.getDate());
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const key = dayKey(day);
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
  }

  while (cursor <= last) {
    const key = dayKey(cursor);
    days.push({
      date: new Date(cursor),
      items: (byDay.get(key) ?? []).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export interface Conflict {
  first: CalendarItem;
  second: CalendarItem;
  overlapMinutes: number;
}

/**
 * Finds overlapping commitments. Useful when scheduling a class or an
 * examination: the clash is far cheaper to find now than on the morning.
 */
export function findConflicts(items: CalendarItem[]): Conflict[] {
  const timed = items
    .filter((item) => !item.allDay)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const conflicts: Conflict[] = [];

  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const first = timed[i]!;
      const second = timed[j]!;
      if (second.startsAt >= first.endsAt) break;

      const overlap = Math.round(
        (Math.min(first.endsAt.getTime(), second.endsAt.getTime()) - second.startsAt.getTime()) / 60_000,
      );
      if (overlap > 0) conflicts.push({ first, second, overlapMinutes: overlap });
    }
  }

  return conflicts;
}

/** The next few things a person needs to know about, for a dashboard. */
export function upcoming(items: CalendarItem[], now: Date = new Date(), limit = 5): CalendarItem[] {
  return items
    .filter((item) => item.endsAt >= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, limit);
}
