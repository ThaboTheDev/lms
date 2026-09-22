import 'server-only';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';
import { notifyAudience } from './notifications';
import { describeAudience, type AudienceSpec } from './notification-rules';
import { viewerContext } from './calendar';

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: string;
  offeringId?: string;
  programmeId?: string;
  cohortId?: string;
  roleKey?: string;
  isPinned?: boolean;
  expiresAt?: Date | null;
  publishNow?: boolean;
}

function toSpec(input: AnnouncementInput): AudienceSpec {
  switch (input.audience) {
    case 'COURSE':
      return { kind: 'COURSE', offeringId: input.offeringId! };
    case 'PROGRAMME':
      return { kind: 'PROGRAMME', programmeId: input.programmeId! };
    case 'COHORT':
      return { kind: 'COHORT', cohortId: input.cohortId! };
    case 'ROLE':
      return { kind: 'ROLE', roleKey: input.roleKey! };
    default:
      return { kind: 'INSTITUTION' };
  }
}

/**
 * Publishing an announcement notifies its audience once. Saving it as a draft
 * notifies nobody, so a half-written notice cannot reach twenty thousand
 * people because somebody pressed the wrong button.
 */
export async function publishAnnouncement(principal: Principal, input: AnnouncementInput) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  requirePermission(principal, 'announcement.publish', {
    institutionId,
    ...(input.offeringId ? { courseOfferingId: input.offeringId } : {}),
    ...(input.programmeId ? { programmeId: input.programmeId } : {}),
  });

  const announcement = await prisma.announcement.create({
    data: {
      institutionId,
      title: input.title.trim(),
      body: input.body.trim(),
      audience: input.audience as never,
      offeringId: input.offeringId || null,
      programmeId: input.programmeId || null,
      cohortId: input.cohortId || null,
      roleKey: input.roleKey || null,
      isPinned: input.isPinned ?? false,
      publishedAt: input.publishNow === false ? null : new Date(),
      expiresAt: input.expiresAt ?? null,
      authorId: principal.userId,
    },
  });

  let recipients = 0;
  if (announcement.publishedAt) {
    const spec = toSpec(input);
    const result = await notifyAudience(
      institutionId,
      spec,
      {
        type: 'announcement.published',
        title: input.title.trim(),
        body: input.body.slice(0, 200),
        linkUrl: '/announcements',
      },
      { exceptUserId: principal.userId },
    );
    recipients = result.recipients;

    await recordAudit(principal, {
      action: 'announcement.published',
      entityType: 'Announcement',
      entityId: announcement.id,
      institutionId,
      after: { title: announcement.title, audience: describeAudience(spec), recipients },
    });
  }

  return { announcement, recipients };
}

/**
 * The announcements one person should see: institution-wide, plus anything
 * scoped to a course, programme, cohort or role they actually belong to.
 */
export async function listAnnouncements(principal: Principal, limit = 30) {
  const viewer = await viewerContext(principal);
  const roleKeys = [...new Set(principal.grants.map((grant) => grant.roleKey))];

  const cohorts = principal.studentId
    ? await prisma.programmeEnrolment.findMany({
        where: { studentId: principal.studentId, cohortId: { not: null } },
        select: { cohortId: true },
      })
    : [];

  const announcements = await prisma.announcement.findMany({
    where: {
      institutionId: principal.institutionId ?? undefined,
      publishedAt: { not: null, lte: new Date() },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
      AND: [
        {
          OR: [
            { audience: 'INSTITUTION' },
            { offeringId: { in: viewer.offeringIds } },
            { programmeId: { in: viewer.programmeIds } },
            { cohortId: { in: cohorts.map((row) => row.cohortId).filter(Boolean) as string[] } },
            { roleKey: { in: roleKeys } },
          ],
        },
      ],
    },
    orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
    take: limit,
    select: {
      id: true, title: true, body: true, audience: true, isPinned: true,
      publishedAt: true, expiresAt: true,
      offering: { select: { course: { select: { code: true } } } },
      programme: { select: { code: true } },
    },
  });

  return announcements;
}
