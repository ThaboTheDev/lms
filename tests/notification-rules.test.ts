import { describe, expect, it } from 'vitest';
import {
  buildDigests,
  describeAudience,
  resolveChannels,
  MANDATORY_TYPES,
  type PendingNotification,
} from '@/server/services/notification-rules';
import { canMessage, deriveSubject, unreadCount, type Correspondent } from '@/server/services/messaging-rules';

describe('notification channels', () => {
  it('uses the per type default when nobody has set a preference', () => {
    expect(resolveChannels('grade.released')).toEqual(['IN_APP', 'EMAIL']);
    expect(resolveChannels('forum.reply')).toEqual(['IN_APP']);
  });

  it('honours a preference that switches email off', () => {
    const channels = resolveChannels('grade.released', {
      type: 'grade.released', inApp: true, email: false, sms: false, push: false,
    });
    expect(channels).toEqual(['IN_APP']);
  });

  it('will not let someone switch off a notice that carries consequences', () => {
    for (const type of MANDATORY_TYPES) {
      const channels = resolveChannels(type, {
        type, inApp: false, email: false, sms: false, push: false,
      });
      expect(channels).toContain('EMAIL');
    }
  });

  it('always leaves at least one channel', () => {
    const channels = resolveChannels('forum.reply', {
      type: 'forum.reply', inApp: false, email: false, sms: false, push: false,
    });
    expect(channels).toEqual(['IN_APP']);
  });
});

describe('digests', () => {
  const notice = (userId: string, type: PendingNotification['type'], minute: number): PendingNotification => ({
    userId,
    type,
    title: `${type} ${minute}`,
    createdAt: new Date(2026, 2, 10, 9, minute),
  });

  it('batches several ordinary notices for one person', () => {
    const { digests, immediate } = buildDigests([
      notice('u1', 'forum.reply', 1),
      notice('u1', 'forum.reply', 2),
      notice('u1', 'announcement.published', 3),
    ]);
    expect(digests).toHaveLength(1);
    expect(digests[0]!.items).toHaveLength(3);
    expect(immediate).toHaveLength(0);
  });

  it('sends a lone notice on its own rather than as a digest of one', () => {
    const { digests, immediate } = buildDigests([notice('u1', 'forum.reply', 1)]);
    expect(digests).toHaveLength(0);
    expect(immediate).toHaveLength(1);
  });

  it('never buries a mandatory notice in a digest', () => {
    const { digests, immediate } = buildDigests([
      notice('u1', 'forum.reply', 1),
      notice('u1', 'forum.reply', 2),
      notice('u1', 'payment.status', 3),
    ]);
    expect(immediate.map((item) => item.type)).toEqual(['payment.status']);
    expect(digests[0]!.items).toHaveLength(2);
  });

  it('keeps one person out of another person digest', () => {
    const { digests } = buildDigests([
      notice('u1', 'forum.reply', 1),
      notice('u1', 'forum.reply', 2),
      notice('u2', 'forum.reply', 3),
      notice('u2', 'forum.reply', 4),
    ]);
    expect(digests).toHaveLength(2);
    expect(new Set(digests.flatMap((digest) => digest.items.map((item) => item.userId))).size).toBe(2);
  });

  it('describes an audience in words a person would use', () => {
    expect(describeAudience({ kind: 'COURSE', offeringId: 'off1' })).toContain('course');
    expect(describeAudience({ kind: 'ROLE', roleKey: 'FINANCE_OFFICER' })).toContain('finance officer');
  });
});

describe('who may message whom', () => {
  const learner = (overrides: Partial<Correspondent> = {}): Correspondent => ({
    userId: 'stu1', isStaff: false, offeringIds: ['off1'], programmeIds: ['prog1'],
    isAdministrative: false, ...overrides,
  });

  const lecturer = (overrides: Partial<Correspondent> = {}): Correspondent => ({
    userId: 'staff1', isStaff: true, offeringIds: ['off1'], programmeIds: [],
    isAdministrative: false, ...overrides,
  });

  it('lets a learner write to staff who teach them', () => {
    expect(canMessage(learner(), lecturer()).allowed).toBe(true);
  });

  it('stops a learner cold-messaging staff who do not teach them', () => {
    const decision = canMessage(learner(), lecturer({ userId: 'staff9', offeringIds: ['off9'] }));
    expect(decision.allowed).toBe(false);
  });

  it('always lets a learner reach the administration', () => {
    const registry = lecturer({ userId: 'reg1', offeringIds: [], isAdministrative: true });
    expect(canMessage(learner(), registry).allowed).toBe(true);
  });

  it('sends learners to the course discussion rather than each other inbox', () => {
    const decision = canMessage(learner(), learner({ userId: 'stu2' }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('discussions');
  });

  it('lets staff reach anyone', () => {
    expect(canMessage(lecturer(), learner({ offeringIds: ['off9'] })).allowed).toBe(true);
  });

  it('refuses a message to yourself', () => {
    expect(canMessage(learner(), learner()).allowed).toBe(false);
  });
});

describe('thread helpers', () => {
  it('counts only unread messages from other people', () => {
    const input = {
      participants: [{ userId: 'u1', lastReadAt: new Date('2026-03-10T09:00:00Z') }],
      lastMessageAt: new Date('2026-03-10T12:00:00Z'),
      messages: [
        { senderId: 'u2', createdAt: new Date('2026-03-10T08:00:00Z') },
        { senderId: 'u2', createdAt: new Date('2026-03-10T10:00:00Z') },
        { senderId: 'u1', createdAt: new Date('2026-03-10T11:00:00Z') },
      ],
    };
    expect(unreadCount(input, 'u1')).toBe(1);
  });

  it('counts everything for someone who has never opened the thread', () => {
    const input = {
      participants: [{ userId: 'u1', lastReadAt: null }],
      lastMessageAt: new Date(),
      messages: [
        { senderId: 'u2', createdAt: new Date('2026-03-10T08:00:00Z') },
        { senderId: 'u2', createdAt: new Date('2026-03-10T09:00:00Z') },
      ],
    };
    expect(unreadCount(input, 'u1')).toBe(2);
  });

  it('derives a subject from the first line and trims a long one', () => {
    expect(deriveSubject('Question about the assignment\nDetails follow', 'DIRECT')).toBe(
      'Question about the assignment',
    );
    expect(deriveSubject('x'.repeat(100), 'DIRECT')).toHaveLength(70);
    expect(deriveSubject('   ', 'ADMINISTRATION')).toBe('Enquiry');
  });
});

describe('digests', async () => {
  const { digestContent, digestDue, waitsForDigest } = await import('@/server/services/notification-rules');
  const at = new Date('2026-09-26T08:05:00Z');

  it('holds ordinary notices for the digest, never mandatory ones', () => {
    expect(waitsForDigest('DAILY', 'forum.reply')).toBe(true);
    expect(waitsForDigest('WEEKLY', 'grade.released')).toBe(true);
    expect(waitsForDigest('DAILY', 'payment.status')).toBe(false);
    expect(waitsForDigest('OFF', 'forum.reply')).toBe(false);
  });

  it('is due once a period has passed, allowing for the hourly job', () => {
    expect(digestDue('DAILY', null, at).due).toBe(true);
    expect(digestDue('DAILY', new Date('2026-09-25T08:05:00Z'), at).due).toBe(true);
    expect(digestDue('DAILY', new Date('2026-09-25T08:10:00Z'), at).due).toBe(true);
    expect(digestDue('DAILY', new Date('2026-09-25T09:00:00Z'), at).due).toBe(false);
    expect(digestDue('WEEKLY', new Date('2026-09-22T08:05:00Z'), at).due).toBe(false);
    expect(digestDue('OFF', null, at).due).toBe(false);
  });

  it('collects from the last digest, or one period back the first time', () => {
    expect(digestDue('WEEKLY', null, at).since.toISOString()).toBe('2026-09-19T08:05:00.000Z');
  });

  it('lists the newest first and says how many more there are', () => {
    const items = Array.from({ length: 32 }, (_, index) => ({ title: `Notice ${index}`, createdAt: new Date(at.getTime() - index * 60_000) }));
    const content = digestContent(items, 'DAILY', 'MSRI');
    expect(content.subject).toBe('32 updates today · MSRI');
    expect(content.lines[0]!.title).toBe('Notice 0');
    expect(content.lines).toHaveLength(30);
    expect(content.more).toBe(2);
    expect(digestContent(items.slice(0, 1), 'WEEKLY', 'MSRI').subject).toBe('1 update this week · MSRI');
  });
});
