/**
 * src/server/services/live-sessions.ts
 *
 * Live classes on Zoom, Teams, Meet or anything else with a link. The meeting
 * itself is created in the provider; this records it against the course, puts
 * it on the calendar, tells the learners, and can open an attendance register
 * for it so an online class counts like a lecture hall.
 */
import 'server-only';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { AppError, NotFoundError } from '@/lib/errors';
import { canAny, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { assertCanViewOffering } from './course-builder';
import { notifyUsers } from './notifications';

export const LIVE_PROVIDERS = ['ZOOM', 'MICROSOFT_TEAMS', 'GOOGLE_MEET', 'OTHER'] as const;

function checkUrl(value: string | undefined, field: string, required: boolean) {
  if (!value) {
    if (required) throw new AppError('Paste the link learners use to join.', 422, 'validation_failed', { [field]: 'Paste the join link.' });
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('not https');
    return url.toString();
  } catch {
    throw new AppError('Use the full https:// link from the meeting invitation.', 422, 'validation_failed', { [field]: 'Use the full https:// link.' });
  }
}

export async function scheduleLiveSession(
  principal: Principal,
  input: {
    offeringId: string;
    title: string;
    provider: (typeof LIVE_PROVIDERS)[number];
    joinUrl?: string;
    hostUrl?: string;
    passcode?: string;
    startsAt: Date;
    endsAt: Date;
    register: boolean;
  },
) {
  const { offering, viewer } = await assertCanViewOffering(principal, input.offeringId);
  const scope = { institutionId: offering.institutionId, courseOfferingId: offering.id };
  if (viewer !== 'staff' || !canAny(principal, ['course.teach', 'attendance.manage', 'course.manage'], scope)) {
    throw new AppError('Only the teaching team can schedule a live class.', 403, 'forbidden');
  }
  if (input.title.trim().length < 3) throw new AppError('Give the class a title.', 422, 'validation_failed', { title: 'Give the class a title.' });
  if (!(input.endsAt > input.startsAt)) throw new AppError('The class has to end after it starts.', 422, 'validation_failed', { endsAt: 'End after the start.' });
  const joinUrl = checkUrl(input.joinUrl, 'joinUrl', true);
  const hostUrl = checkUrl(input.hostUrl, 'hostUrl', false);

  const live = await prisma.$transaction(async (tx) => {
    const created = await tx.liveSession.create({
      data: {
        institutionId: offering.institutionId,
        offeringId: offering.id,
        provider: input.provider,
        title: input.title.trim(),
        joinUrl,
        hostUrl,
        passcode: input.passcode?.trim() || null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdById: principal.userId,
      },
    });
    await tx.calendarEvent.create({
      data: {
        institutionId: offering.institutionId,
        title: `${offering.course.code}: ${created.title} (live)`,
        type: 'LECTURE',
        visibility: 'COURSE',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: joinUrl,
        offeringId: offering.id,
        createdById: principal.userId,
      },
    });
    if (input.register) {
      await tx.attendanceSession.create({
        data: {
          institutionId: offering.institutionId,
          offeringId: offering.id,
          title: `${created.title} (live)`,
          mode: 'ONLINE',
          scheduledStart: input.startsAt,
          scheduledEnd: input.endsAt,
          liveSessionId: created.id,
          selfCheckInEnabled: true,
          checkInCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
          createdById: principal.userId,
        },
      });
    }
    return created;
  });

  const learners = (await prisma.courseEnrolment.findMany({
    where: { offeringId: offering.id, status: 'ACTIVE' },
    select: { student: { select: { userId: true } } },
  })) as { student: { userId: string } }[];
  await notifyUsers(offering.institutionId, learners.map((row) => row.student.userId), {
    type: 'live.scheduled',
    title: `Live class: ${live.title}`,
    body: `${offering.course.code}, ${input.startsAt.toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' })}.`,
    linkUrl: `/courses/${offering.id}`,
  });

  await recordAudit(principal, { action: 'course.live_session_scheduled', entityType: 'LiveSession', entityId: live.id, institutionId: offering.institutionId, after: { title: live.title, provider: live.provider, startsAt: live.startsAt.toISOString() } });
  return live;
}

export async function setRecording(principal: Principal, liveSessionId: string, recordingUrl: string) {
  const live = await prisma.liveSession.findUnique({ where: { id: liveSessionId }, select: { id: true, institutionId: true, offeringId: true } });
  if (!live || !live.offeringId) throw new NotFoundError('Live class');
  requireSameInstitution(principal, live.institutionId);
  const { viewer } = await assertCanViewOffering(principal, live.offeringId);
  if (viewer !== 'staff') throw new AppError('Only the teaching team can add the recording.', 403, 'forbidden');
  const url = checkUrl(recordingUrl, 'recordingUrl', true);
  await prisma.liveSession.update({ where: { id: live.id }, data: { recordingUrl: url } });
  await recordAudit(principal, { action: 'course.live_session_recording', entityType: 'LiveSession', entityId: live.id, after: { recordingUrl: url } });
}
