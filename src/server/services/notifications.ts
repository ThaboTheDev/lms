import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { mailer, renderTemplate, wrapEmail, escapeHtml } from '@/lib/mail';
import { queue } from '@/lib/queue';
import type { Principal } from '@/lib/rbac/authorize';
import {
  resolveChannels,
  type AudienceSpec,
  type Channel,
  type NotificationType,
} from './notification-rules';

export interface NotifyInput {
  userId: string;
  institutionId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
  meta?: Record<string, unknown>;
}

/**
 * Writes the in-app notification first and only then attempts any other
 * channel. If email is down the person still finds the notice when they next
 * open the platform, which is the behaviour an institution needs.
 */
export async function notify(input: NotifyInput) {
  const preference = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId: input.userId, type: input.type } },
    select: { type: true, inApp: true, email: true, sms: true, push: true },
  });

  const channels = resolveChannels(
    input.type,
    preference ? { ...preference, type: input.type } : null,
  );

  if (channels.includes('IN_APP')) {
    await prisma.notification.create({
      data: {
        institutionId: input.institutionId ?? null,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        linkUrl: input.linkUrl ?? null,
        channel: 'IN_APP',
        deliveredAt: new Date(),
        meta: (input.meta ?? undefined) as never,
      },
    });
  }

  if (channels.includes('EMAIL')) {
    await queue.enqueue('email.send', { ...input, channels });
  }

  // TODO(phase-9): SMS and push, behind the same channel resolution.
  return { channels };
}

/** Sends the email for one notification, called by the queue handler. */
export async function deliverNotificationEmail(input: NotifyInput) {
  const [user, institution, template] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, firstName: true, status: true },
    }),
    input.institutionId
      ? prisma.institution.findUnique({
          where: { id: input.institutionId },
          select: { name: true, emailFromAddress: true, emailFromName: true, footerText: true },
        })
      : Promise.resolve(null),
    input.institutionId
      ? prisma.emailTemplate.findUnique({
          where: { institutionId_key: { institutionId: input.institutionId, key: input.type } },
          select: { subject: true, bodyHtml: true, bodyText: true, isActive: true },
        })
      : Promise.resolve(null),
  ]);

  if (!user || user.status !== 'ACTIVE') return;

  const variables = {
    firstName: user.firstName,
    title: input.title,
    body: input.body ?? '',
    institution: institution?.name ?? env.APP_NAME,
    link: input.linkUrl ? `${env.APP_URL}${input.linkUrl}` : env.APP_URL,
  };

  // An institution can edit the template; the built-in wording is the fallback.
  const subject = template?.isActive
    ? renderTemplate(template.subject, variables)
    : `${input.title} · ${variables.institution}`;

  const bodyHtml = template?.isActive
    ? renderTemplate(template.bodyHtml, variables)
    : wrapEmail(
        variables.institution,
        input.title,
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(input.body ?? '')}</p>
         ${input.linkUrl ? `<p style="margin:0"><a href="${variables.link}" style="color:#0e5c4a">Open it in the platform</a></p>` : ''}`,
        institution?.footerText ?? undefined,
      );

  await mailer.send({
    to: user.email,
    subject,
    html: bodyHtml,
    text: template?.bodyText ? renderTemplate(template.bodyText, variables) : input.body,
    from:
      institution?.emailFromAddress && institution.emailFromName
        ? `${institution.emailFromName} <${institution.emailFromAddress}>`
        : undefined,
  });
}

/**
 * Resolves an audience to user ids. Done in one query per audience kind rather
 * than per person, because an institution-wide announcement at twenty thousand
 * learners is a normal Tuesday.
 */
export async function resolveAudience(institutionId: string, spec: AudienceSpec): Promise<string[]> {
  switch (spec.kind) {
    case 'INSTITUTION': {
      const users = (await prisma.user.findMany({
        where: { institutionId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      })) as { id: string }[];
      return users.map((user) => user.id);
    }
    case 'COURSE': {
      const [enrolled, staff] = await Promise.all([
        prisma.courseEnrolment.findMany({
          where: { offeringId: spec.offeringId, status: 'ACTIVE' },
          select: { student: { select: { userId: true } } },
        }),
        prisma.offeringStaff.findMany({
          where: { offeringId: spec.offeringId },
          select: { userId: true },
        }),
      ]);
      const recipients = new Set<string>();
      for (const row of enrolled as { student: { userId: string } }[]) recipients.add(row.student.userId);
      for (const row of staff as { userId: string }[]) recipients.add(row.userId);
      return [...recipients];
    }
    case 'PROGRAMME': {
      const enrolled = (await prisma.programmeEnrolment.findMany({
        where: { programmeId: spec.programmeId, status: 'ACTIVE' },
        select: { student: { select: { userId: true } } },
      })) as { student: { userId: string } }[];
      return enrolled.map((row) => row.student.userId);
    }
    case 'COHORT': {
      const enrolled = (await prisma.programmeEnrolment.findMany({
        where: { cohortId: spec.cohortId, status: 'ACTIVE' },
        select: { student: { select: { userId: true } } },
      })) as { student: { userId: string } }[];
      return enrolled.map((row) => row.student.userId);
    }
    case 'ROLE': {
      const holders = (await prisma.userRole.findMany({
        where: { institutionId, role: { key: spec.roleKey } },
        select: { userId: true },
      })) as { userId: string }[];
      return [...new Set(holders.map((row) => row.userId))];
    }
    default:
      return [];
  }
}

/**
 * Fans a notice out to an audience. In-app rows are written in bulk; emails go
 * through the queue so a large audience does not hold a request open.
 */
export async function notifyAudience(
  institutionId: string,
  spec: AudienceSpec,
  notice: Omit<NotifyInput, 'userId' | 'institutionId'>,
  options: { exceptUserId?: string } = {},
) {
  const userIds = (await resolveAudience(institutionId, spec)).filter(
    (userId) => userId !== options.exceptUserId,
  );
  if (userIds.length === 0) return { recipients: 0 };

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      institutionId,
      userId,
      type: notice.type,
      title: notice.title,
      body: notice.body ?? null,
      linkUrl: notice.linkUrl ?? null,
      channel: 'IN_APP' as const,
      deliveredAt: new Date(),
    })),
  });

  await queue.enqueue('notification.fanout', { institutionId, userIds, notice });
  return { recipients: userIds.length };
}

/**
 * Notifies an explicit list of people, in bulk: in-app rows now, email through
 * the queue (which checks each person's preferences before sending).
 */
export async function notifyUsers(
  institutionId: string,
  userIds: string[],
  notice: Omit<NotifyInput, 'userId' | 'institutionId'>,
) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (recipients.length === 0) return { recipients: 0 };

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      institutionId,
      userId,
      type: notice.type,
      title: notice.title,
      body: notice.body ?? null,
      linkUrl: notice.linkUrl ?? null,
      channel: 'IN_APP' as const,
      deliveredAt: new Date(),
    })),
  });

  await queue.enqueue('notification.fanout', { institutionId, userIds: recipients, notice });
  return { recipients: recipients.length };
}

export async function listNotifications(principal: Principal, options: { unreadOnly?: boolean } = {}) {
  return prisma.notification.findMany({
    where: {
      userId: principal.userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, type: true, title: true, body: true, linkUrl: true, readAt: true, createdAt: true },
  });
}

export async function unreadNotificationCount(principal: Principal) {
  return prisma.notification.count({ where: { userId: principal.userId, readAt: null } });
}

export async function markNotificationsRead(principal: Principal, ids?: string[]) {
  await prisma.notification.updateMany({
    where: { userId: principal.userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

export async function loadPreferences(principal: Principal) {
  return prisma.notificationPreference.findMany({
    where: { userId: principal.userId },
    select: { type: true, inApp: true, email: true, sms: true, push: true },
  });
}

export async function savePreference(
  principal: Principal,
  type: NotificationType,
  channels: { inApp: boolean; email: boolean; sms: boolean; push: boolean },
) {
  return prisma.notificationPreference.upsert({
    where: { userId_type: { userId: principal.userId, type } },
    create: { userId: principal.userId, type, ...channels },
    update: channels,
  });
}
