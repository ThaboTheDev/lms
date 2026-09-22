import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { requirePermission, can, type Principal } from '@/lib/rbac/authorize';
import { groupByDay, isVisibleTo, upcoming, type CalendarItem, type ViewerContext } from './calendar-rules';

/**
 * What this person belongs to. Visibility is decided from membership rather
 * than from a role, so a lecturer sees the courses they teach and a learner the
 * ones they take, without either needing an extra permission.
 */
export async function viewerContext(principal: Principal): Promise<ViewerContext> {
  const [teaching, enrolled, programmes] = await Promise.all([
    prisma.offeringStaff.findMany({
      where: { userId: principal.userId },
      select: { offeringId: true },
    }),
    principal.studentId
      ? prisma.courseEnrolment.findMany({
          where: { studentId: principal.studentId, status: { in: ['ACTIVE', 'COMPLETED'] } },
          select: { offeringId: true },
        })
      : Promise.resolve([]),
    principal.studentId
      ? prisma.programmeEnrolment.findMany({
          where: { studentId: principal.studentId },
          select: { programmeId: true, programme: { select: { department: { select: { facultyId: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  const offeringIds = new Set<string>();
  for (const row of teaching as { offeringId: string }[]) offeringIds.add(row.offeringId);
  for (const row of enrolled as { offeringId: string }[]) offeringIds.add(row.offeringId);

  const programmeRows = programmes as {
    programmeId: string;
    programme: { department: { facultyId: string } };
  }[];

  return {
    userId: principal.userId,
    offeringIds: [...offeringIds],
    programmeIds: programmeRows.map((row) => row.programmeId),
    facultyIds: [...new Set(programmeRows.map((row) => row.programme.department.facultyId))],
    seesEverything: can(principal, 'calendar.manage') || can(principal, 'report.read'),
  };
}

export async function loadCalendar(
  principal: Principal,
  range: { from: Date; to: Date },
  filters: { offeringId?: string; programmeId?: string; type?: string } = {},
) {
  const viewer = await viewerContext(principal);

  const events = await prisma.calendarEvent.findMany({
    where: {
      institutionId: principal.institutionId ?? undefined,
      startsAt: { lte: range.to },
      endsAt: { gte: range.from },
      ...(filters.offeringId ? { offeringId: filters.offeringId } : {}),
      ...(filters.programmeId ? { programmeId: filters.programmeId } : {}),
      ...(filters.type ? { type: filters.type as never } : {}),
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true, title: true, description: true, type: true, visibility: true,
      startsAt: true, endsAt: true, allDay: true, location: true,
      offeringId: true, programmeId: true, facultyId: true, createdById: true,
      offering: { select: { course: { select: { code: true } } } },
    },
  });

  const items = events.filter((event) => isVisibleTo(event as never as CalendarItem, viewer));

  return {
    items,
    days: groupByDay(items as never as CalendarItem[], range.from, range.to),
    next: upcoming(items as never as CalendarItem[]),
  };
}

export async function createEvent(
  principal: Principal,
  input: {
    title: string;
    description?: string;
    type: string;
    visibility: string;
    startsAt: Date;
    endsAt: Date;
    allDay?: boolean;
    location?: string;
    offeringId?: string;
    programmeId?: string;
    facultyId?: string;
  },
) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  // A private note needs no permission; anything other people will see does.
  if (input.visibility !== 'PRIVATE') {
    requirePermission(principal, 'calendar.manage', { institutionId });
  }

  if (input.endsAt < input.startsAt) {
    throw new AppError('The event has to end after it starts.', 422, 'invalid_window');
  }

  return prisma.calendarEvent.create({
    data: {
      institutionId,
      title: input.title,
      description: input.description || null,
      type: input.type as never,
      visibility: input.visibility as never,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay ?? false,
      location: input.location || null,
      offeringId: input.offeringId || null,
      programmeId: input.programmeId || null,
      facultyId: input.facultyId || null,
      createdById: principal.userId,
    },
  });
}

/** The next few commitments, for the dashboard. */
export async function upcomingForPrincipal(principal: Principal, days = 14) {
  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);
  const { next } = await loadCalendar(principal, { from, to });
  return next;
}
