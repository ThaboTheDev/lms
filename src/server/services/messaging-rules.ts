/**
 * Who may write to whom. An internal messaging system inside an institution is
 * a channel between a learner and the staff responsible for them, not an open
 * directory: a learner should not be able to cold-message four hundred
 * classmates, and a lecturer should not have to field messages from learners
 * they do not teach.
 */

export type MessageScope = 'DIRECT' | 'GROUP' | 'COURSE' | 'PROGRAMME' | 'ADMINISTRATION';

export interface Correspondent {
  userId: string;
  isStaff: boolean;
  /** Offerings the person teaches, or is enrolled in. */
  offeringIds: string[];
  programmeIds: string[];
  /** Staff who handle enquiries: registry, finance, support. */
  isAdministrative: boolean;
}

export type MessageDecision = { allowed: true } | { allowed: false; reason: string };

export function canMessage(sender: Correspondent, recipient: Correspondent): MessageDecision {
  if (sender.userId === recipient.userId) {
    return { allowed: false, reason: 'You cannot message yourself.' };
  }

  // Staff can reach anyone in the institution: that is the job.
  if (sender.isStaff) return { allowed: true };

  if (recipient.isAdministrative) return { allowed: true };

  if (recipient.isStaff) {
    const shared = sender.offeringIds.some((id) => recipient.offeringIds.includes(id));
    if (shared) return { allowed: true };
    return {
      allowed: false,
      reason: 'You can message staff who teach you, or the administration.',
    };
  }

  return {
    allowed: false,
    reason: 'Learners message each other in course discussions rather than privately.',
  };
}

export interface ThreadSummaryInput {
  participants: { userId: string; lastReadAt: Date | null }[];
  lastMessageAt: Date;
  messages: { senderId: string; createdAt: Date }[];
}

/** Unread count for one participant, counting only messages they did not send. */
export function unreadCount(input: ThreadSummaryInput, userId: string): number {
  const participant = input.participants.find((entry) => entry.userId === userId);
  if (!participant) return 0;

  return input.messages.filter(
    (message) =>
      message.senderId !== userId &&
      (!participant.lastReadAt || message.createdAt > participant.lastReadAt),
  ).length;
}

/** Subject line for a thread that was started without one. */
export function deriveSubject(body: string, scope: MessageScope): string {
  const firstLine = body.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine.length > 0) {
    return firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;
  }
  return scope === 'ADMINISTRATION' ? 'Enquiry' : 'Message';
}
