import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { can, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { canMessage, deriveSubject, type Correspondent } from './messaging-rules';
import { notify } from './notifications';

const ADMINISTRATIVE_ROLES = [
  'REGISTRAR', 'INSTITUTION_ADMIN', 'ACADEMIC_ADMIN', 'FINANCE_OFFICER',
  'SUPPORT_STAFF', 'PROGRAMME_COORDINATOR',
];

async function describeCorrespondent(userId: string, studentId?: string | null): Promise<Correspondent> {
  const [teaching, roles, student] = await Promise.all([
    prisma.offeringStaff.findMany({ where: { userId }, select: { offeringId: true } }),
    prisma.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } }),
    studentId !== undefined
      ? Promise.resolve(studentId)
      : prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } }).then((row) => row?.id ?? null),
  ]);

  const roleKeys = roles.map((row) => row.role.key);
  const enrolled = student
    ? await prisma.courseEnrolment.findMany({
        where: { studentId: student, status: 'ACTIVE' },
        select: { offeringId: true },
      })
    : [];

  return {
    userId,
    isStaff: roleKeys.some((key) => key !== 'STUDENT'),
    isAdministrative: roleKeys.some((key) => ADMINISTRATIVE_ROLES.includes(key)),
    offeringIds: [...new Set([...teaching.map((r) => r.offeringId), ...enrolled.map((r) => r.offeringId)])],
    programmeIds: [],
  };
}

export async function listThreads(principal: Principal) {
  const threads = await prisma.messageThread.findMany({
    where: { participants: { some: { userId: principal.userId } } },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    select: {
      id: true, subject: true, scope: true, lastMessageAt: true,
      offering: { select: { course: { select: { code: true } } } },
      participants: {
        select: { userId: true, lastReadAt: true, user: { select: { firstName: true, lastName: true } } },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { body: true, senderId: true, createdAt: true },
      },
      _count: { select: { messages: true } },
    },
  });

  return threads.map((thread) => {
    const me = thread.participants.find((entry) => entry.userId === principal.userId);
    const latest = thread.messages[0];
    return {
      ...thread,
      others: thread.participants.filter((entry) => entry.userId !== principal.userId),
      preview: latest?.body.slice(0, 120) ?? '',
      unread: Boolean(
        latest && latest.senderId !== principal.userId && (!me?.lastReadAt || latest.createdAt > me.lastReadAt),
      ),
    };
  });
}

export async function unreadThreadCount(principal: Principal) {
  const participants = await prisma.messageParticipant.findMany({
    where: { userId: principal.userId },
    select: {
      lastReadAt: true,
      thread: { select: { lastMessageAt: true, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { senderId: true } } } },
    },
  });

  return participants.filter((participant) => {
    const latest = participant.thread.messages[0];
    if (!latest || latest.senderId === principal.userId) return false;
    return !participant.lastReadAt || participant.thread.lastMessageAt > participant.lastReadAt;
  }).length;
}

export async function loadThread(principal: Principal, threadId: string) {
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    select: {
      id: true, institutionId: true, subject: true, scope: true,
      offering: { select: { id: true, course: { select: { code: true, title: true } } } },
      participants: {
        select: { userId: true, lastReadAt: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, body: true, createdAt: true, editedAt: true,
          sender: { select: { id: true, firstName: true, lastName: true } },
          attachments: { select: { fileId: true, file: { select: { originalName: true } } } },
        },
      },
    },
  });
  if (!thread) throw new NotFoundError('Conversation');

  const participant = thread.participants.find((entry) => entry.userId === principal.userId);
  if (!participant) {
    throw new AppError('This conversation is not yours.', 403, 'forbidden');
  }
  requireSameInstitution(principal, thread.institutionId);

  await prisma.messageParticipant.updateMany({
    where: { threadId, userId: principal.userId },
    data: { lastReadAt: new Date() },
  });

  return thread;
}

/**
 * Starts a conversation. Who may write to whom is decided by the rules in
 * messaging-rules, so a learner cannot open a thread with four hundred
 * classmates, and a lecturer is not cold-messaged by learners they never teach.
 */
export async function startThread(
  principal: Principal,
  input: { recipientId: string; subject?: string; body: string },
) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const recipient = await prisma.user.findFirst({
    where: { id: input.recipientId, institutionId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!recipient) throw new NotFoundError('Recipient');

  const [sender, target] = await Promise.all([
    describeCorrespondent(principal.userId, principal.studentId),
    describeCorrespondent(input.recipientId),
  ]);

  const decision = canMessage(sender, target);
  if (!decision.allowed) throw new AppError(decision.reason, 403, 'messaging_not_allowed');

  const thread = await prisma.messageThread.create({
    data: {
      institutionId,
      subject: input.subject?.trim() || deriveSubject(input.body, 'DIRECT'),
      scope: 'DIRECT',
      createdById: principal.userId,
      lastMessageAt: new Date(),
      participants: {
        create: [
          { userId: principal.userId, lastReadAt: new Date() },
          { userId: input.recipientId },
        ],
      },
      messages: { create: { senderId: principal.userId, body: input.body.trim() } },
    },
    select: { id: true, subject: true },
  });

  await notify({
    userId: input.recipientId,
    institutionId,
    type: 'message.received',
    title: `New message: ${thread.subject}`,
    body: input.body.slice(0, 160),
    linkUrl: `/messages/${thread.id}`,
  });

  return thread;
}

export async function replyToThread(principal: Principal, threadId: string, body: string) {
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    select: {
      id: true, institutionId: true, subject: true,
      participants: { select: { userId: true } },
    },
  });
  if (!thread) throw new NotFoundError('Conversation');
  if (!thread.participants.some((entry) => entry.userId === principal.userId)) {
    throw new AppError('This conversation is not yours.', 403, 'forbidden');
  }

  const message = await prisma.message.create({
    data: { threadId, senderId: principal.userId, body: body.trim() },
    select: { id: true },
  });

  await prisma.messageThread.update({
    where: { id: threadId },
    data: { lastMessageAt: new Date() },
  });

  for (const participant of thread.participants) {
    if (participant.userId === principal.userId) continue;
    await notify({
      userId: participant.userId,
      institutionId: thread.institutionId,
      type: 'message.received',
      title: `Reply: ${thread.subject}`,
      body: body.slice(0, 160),
      linkUrl: `/messages/${threadId}`,
    });
  }

  return message;
}

/** People this principal is allowed to start a conversation with. */
export async function messageableUsers(principal: Principal) {
  const institutionId = principal.institutionId;
  if (!institutionId) return [];

  const sender = await describeCorrespondent(principal.userId, principal.studentId);

  if (sender.isStaff || can(principal, 'user.read')) {
    return prisma.user.findMany({
      where: { institutionId, status: 'ACTIVE', deletedAt: null, id: { not: principal.userId } },
      orderBy: [{ lastName: 'asc' }],
      take: 500,
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }

  const [teachers, administrators] = await Promise.all([
    prisma.offeringStaff.findMany({
      where: { offeringId: { in: sender.offeringIds } },
      select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
    prisma.userRole.findMany({
      where: { institutionId, role: { key: { in: ADMINISTRATIVE_ROLES } } },
      select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
  ]);

  const byId = new Map<string, { id: string; firstName: string; lastName: string; email: string }>();
  for (const row of [...teachers, ...administrators]) {
    if (row.user.id !== principal.userId) byId.set(row.user.id, row.user);
  }
  return [...byId.values()].sort((a, b) => a.lastName.localeCompare(b.lastName));
}
