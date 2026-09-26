/**
 * Which notifications reach a person, and by which channel. Pure, so the rules
 * can be reasoned about in one place: a system that emails people too much gets
 * muted, and then the one message that mattered is missed too.
 */

export type NotificationType =
  | 'course.published'
  | 'assessment.published'
  | 'assessment.due_soon'
  | 'grade.released'
  | 'announcement.published'
  | 'message.received'
  | 'forum.reply'
  | 'attendance.flagged'
  | 'admission.decision'
  | 'payment.status'
  | 'certificate.issued'
  | 'ticket.raised'
  | 'live.scheduled'
  | 'system.notice';

export type Channel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';

export interface ChannelPreference {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
}

/**
 * Defaults are chosen per type rather than globally. A released result or an
 * admission decision is worth an email; a forum reply is not, until someone
 * asks for it.
 */
export const CHANNEL_DEFAULTS: Record<NotificationType, Channel[]> = {
  'course.published': ['IN_APP'],
  'assessment.published': ['IN_APP', 'EMAIL'],
  'assessment.due_soon': ['IN_APP', 'EMAIL'],
  'grade.released': ['IN_APP', 'EMAIL'],
  'announcement.published': ['IN_APP'],
  'message.received': ['IN_APP'],
  'forum.reply': ['IN_APP'],
  'attendance.flagged': ['IN_APP'],
  'admission.decision': ['IN_APP', 'EMAIL'],
  'payment.status': ['IN_APP', 'EMAIL'],
  'certificate.issued': ['IN_APP', 'EMAIL'],
  'ticket.raised': ['IN_APP', 'EMAIL'],
  'live.scheduled': ['IN_APP', 'EMAIL'],
  'system.notice': ['IN_APP', 'EMAIL'],
};

/**
 * Some notices are not optional. A learner cannot switch off the fact that
 * their admission was decided or that money moved on their account, because
 * those carry consequences whether or not they were read.
 */
export const MANDATORY_TYPES: NotificationType[] = [
  'admission.decision',
  'payment.status',
  'system.notice',
];

export function resolveChannels(
  type: NotificationType,
  preference?: ChannelPreference | null,
): Channel[] {
  const defaults = CHANNEL_DEFAULTS[type] ?? ['IN_APP'];
  if (!preference) return defaults;

  const chosen: Channel[] = [];
  if (preference.inApp) chosen.push('IN_APP');
  if (preference.email) chosen.push('EMAIL');
  if (preference.sms) chosen.push('SMS');
  if (preference.push) chosen.push('PUSH');

  if (MANDATORY_TYPES.includes(type)) {
    // The person can still choose extra channels, but not fewer than the
    // default for a notice that carries consequences.
    for (const channel of defaults) {
      if (!chosen.includes(channel)) chosen.push(channel);
    }
  }

  return chosen.length > 0 ? chosen : ['IN_APP'];
}

export interface PendingNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
  createdAt: Date;
}

export interface Digest {
  userId: string;
  items: PendingNotification[];
  subject: string;
}

/**
 * Groups queued email notifications per person so that twelve forum replies
 * arrive as one message rather than twelve. Anything mandatory is left out of
 * the digest and sent on its own.
 */
export function buildDigests(pending: PendingNotification[]): {
  digests: Digest[];
  immediate: PendingNotification[];
} {
  const immediate = pending.filter((item) => MANDATORY_TYPES.includes(item.type));
  const batchable = pending.filter((item) => !MANDATORY_TYPES.includes(item.type));

  const byUser = new Map<string, PendingNotification[]>();
  for (const item of batchable) {
    byUser.set(item.userId, [...(byUser.get(item.userId) ?? []), item]);
  }

  const digests: Digest[] = [];
  for (const [userId, items] of byUser) {
    if (items.length === 1) {
      immediate.push(items[0]!);
      continue;
    }
    digests.push({
      userId,
      items: items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      subject: `${items.length} updates from your institution`,
    });
  }

  return { digests, immediate };
}

export type AudienceSpec =
  | { kind: 'INSTITUTION' }
  | { kind: 'PROGRAMME'; programmeId: string }
  | { kind: 'COURSE'; offeringId: string }
  | { kind: 'COHORT'; cohortId: string }
  | { kind: 'ROLE'; roleKey: string };

export function describeAudience(spec: AudienceSpec): string {
  switch (spec.kind) {
    case 'INSTITUTION':
      return 'Everyone at the institution';
    case 'PROGRAMME':
      return 'Everyone on the programme';
    case 'COURSE':
      return 'Everyone taking the course';
    case 'COHORT':
      return 'The cohort';
    case 'ROLE':
      return `Everyone with the ${spec.roleKey.toLowerCase().replace(/_/g, ' ')} role`;
    default:
      return 'Selected people';
  }
}
