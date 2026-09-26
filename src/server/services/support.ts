import 'server-only';
import { claimUploads } from './attachments';
import { notifyAudience } from './notifications';
import type { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { can, requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { parseSequence } from './reference-format';

/**
 * Support tickets.
 *
 * Learner problems arrive by email and get lost, so they are captured here
 * instead: a number the requester can quote, a thread everyone can read, and an
 * SLA clock that says how long the institution has to answer. Whether a person
 * sees one ticket or the whole queue depends on `ticket.read`, not on where
 * they sit in the navigation.
 */

/** Ticket numbers are human-quotable: TKT-2026-00014. */
const PREFIX = 'TKT';

/**
 * How long the institution has to respond before the ticket is overdue. Urgent
 * means somebody cannot work; low means it can wait for the weekly sweep.
 */
const RESPONSE_HOURS: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 8,
  NORMAL: 24,
  LOW: 72,
};

const OPEN_STATES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'];

export type TicketFilter = 'ALL' | 'OPEN' | 'RESOLVED' | 'CLOSED';

export interface TicketFilters {
  status?: TicketFilter;
  mine?: boolean;
}

async function allocateTicketNumber(
  institutionId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // Serialised per institution and year, so two tickets raised at the same
    // moment cannot be handed the same number.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ticket:${institutionId}:${year}`}))`;

    const prefix = `${PREFIX}-${year}-`;
    const latest = await tx.supportTicket.findFirst({
      where: { institutionId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const sequence = latest ? parseSequence(latest.number, prefix) : 0;
    return `${prefix}${String(sequence + 1).padStart(5, '0')}`;
  });
}

export async function listTickets(principal: Principal, filters: TicketFilters = {}) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const seesQueue = can(principal, 'ticket.read', { institutionId });
  const onlyMine = filters.mine === true || !seesQueue;

  // "Open" means anything still in play, which is three statuses rather than
  // one: waiting on the requester is not closed, it is merely paused.
  const status =
    filters.status === 'OPEN'
      ? { status: { in: OPEN_STATES } }
      : filters.status === 'RESOLVED'
        ? { status: 'RESOLVED' as TicketStatus }
        : filters.status === 'CLOSED'
          ? { status: 'CLOSED' as TicketStatus }
          : {};

  const tickets = await prisma.supportTicket.findMany({
    where: {
      institutionId,
      ...status,
      ...(onlyMine ? { requesterId: principal.userId } : {}),
    },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      number: true,
      subject: true,
      category: true,
      status: true,
      priority: true,
      slaDueAt: true,
      createdAt: true,
      requester: { select: { firstName: true, lastName: true, email: true } },
      assignee: { select: { firstName: true, lastName: true } },
      _count: { select: { messages: true } },
    },
  });

  return { tickets, seesQueue };
}

export async function getTicket(principal: Principal, ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      institutionId: true,
      number: true,
      subject: true,
      description: true,
      category: true,
      status: true,
      priority: true,
      slaDueAt: true,
      resolvedAt: true,
      closedAt: true,
      createdAt: true,
      requesterId: true,
      requester: { select: { firstName: true, lastName: true, email: true } },
      assigneeId: true,
      assignee: { select: { firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          isInternalNote: true,
          createdAt: true,
          author: { select: { firstName: true, lastName: true } },
        },
      },
      attachments: { select: { fileId: true, file: { select: { originalName: true, sizeBytes: true } } } },
    },
  });

  if (!ticket) throw new NotFoundError('Ticket');
  requireSameInstitution(principal, ticket.institutionId);

  const seesQueue = can(principal, 'ticket.read', { institutionId: ticket.institutionId });
  const involved = ticket.requesterId === principal.userId || ticket.assigneeId === principal.userId;
  if (!seesQueue && !involved) throw new NotFoundError('Ticket');

  return { ticket, seesQueue };
}

export async function createTicket(
  principal: Principal,
  input: {
    subject: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    fileIds?: string[];
  },
) {
  requirePermission(principal, 'ticket.submit');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const number = await allocateTicketNumber(institutionId);
  const slaDueAt = new Date(Date.now() + RESPONSE_HOURS[input.priority] * 3_600_000);

  const attach = await claimUploads(principal, input.fileIds ?? []);
  const ticket = await prisma.supportTicket.create({
    data: {
      ...(attach.length ? { attachments: { create: attach.map((fileId) => ({ fileId })) } } : {}),
      institutionId,
      number,
      requesterId: principal.userId,
      category: input.category,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      slaDueAt,
    },
    select: { id: true, number: true, subject: true },
  });

  await recordAudit(principal, {
    action: 'ticket.created',
    entityType: 'SupportTicket',
    entityId: ticket.id,
    institutionId,
    after: { number: ticket.number, category: input.category, priority: input.priority },
  });

  const notice = {
    type: 'ticket.raised' as const,
    title: `New ${input.priority.toLowerCase()} priority ticket ${ticket.number}`,
    body: ticket.subject,
    linkUrl: `/support/${ticket.id}`,
  };
  const reached = await notifyAudience(institutionId, { kind: 'ROLE', roleKey: 'SUPPORT_STAFF' }, notice, { exceptUserId: principal.userId });
  if (reached.recipients === 0) {
    // No support desk yet: the institution's administrators hold ticket.manage.
    await notifyAudience(institutionId, { kind: 'ROLE', roleKey: 'INSTITUTION_ADMIN' }, notice, { exceptUserId: principal.userId });
  }

  return ticket;
}

/**
 * Adds to the thread. A staff reply also wakes the ticket up: an answer that
 * leaves it waiting on the requester would be a lie about where the ball is.
 */
export async function replyToTicket(
  principal: Principal,
  ticketId: string,
  body: string,
  isInternalNote = false,
  fileIds: string[] = [],
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, institutionId: true, number: true, status: true, requesterId: true, assigneeId: true },
  });
  if (!ticket) throw new NotFoundError('Ticket');
  requireSameInstitution(principal, ticket.institutionId);

  const seesQueue = can(principal, 'ticket.read', { institutionId: ticket.institutionId });
  const involved = ticket.requesterId === principal.userId || ticket.assigneeId === principal.userId;
  if (!seesQueue && !involved) throw new NotFoundError('Ticket');

  if (isInternalNote && !seesQueue) {
    throw new AppError('Only support staff can leave an internal note.', 403, 'forbidden');
  }
  if (ticket.status === 'CLOSED') {
    throw new AppError('This ticket is closed. Open a new one for a new problem.', 409, 'ticket_closed');
  }

  const attach = await claimUploads(principal, fileIds);
  const message = await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: principal.userId, body, isInternalNote },
    select: { id: true },
  });
  if (attach.length) {
    await prisma.ticketAttachment.createMany({ data: attach.map((fileId) => ({ ticketId: ticket.id, fileId })) });
  }

  if (seesQueue && !isInternalNote && ticket.status === 'OPEN') {
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: 'IN_PROGRESS' },
    });
  }

  await recordAudit(principal, {
    action: isInternalNote ? 'ticket.note_added' : 'ticket.replied',
    entityType: 'TicketMessage',
    entityId: message.id,
    institutionId: ticket.institutionId,
    after: { ticketNumber: ticket.number, internal: isInternalNote },
  });

  return message;
}

export async function setTicketStatus(principal: Principal, ticketId: string, status: TicketStatus) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, institutionId: true, number: true, status: true },
  });
  if (!ticket) throw new NotFoundError('Ticket');
  requireSameInstitution(principal, ticket.institutionId);
  requirePermission(principal, 'ticket.manage', { institutionId: ticket.institutionId });

  const now = new Date();
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status,
      resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? now : null,
      closedAt: status === 'CLOSED' ? now : null,
    },
    select: { id: true, status: true },
  });

  await recordAudit(principal, {
    action: 'ticket.status_changed',
    entityType: 'SupportTicket',
    entityId: ticket.id,
    institutionId: ticket.institutionId,
    before: { status: ticket.status },
    after: { status: updated.status },
  });

  return updated;
}

/** Assigns the ticket to a member of staff in the same institution. */
export async function assignTicket(principal: Principal, ticketId: string, assigneeId: string | null) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, institutionId: true, number: true, assigneeId: true },
  });
  if (!ticket) throw new NotFoundError('Ticket');
  requireSameInstitution(principal, ticket.institutionId);
  requirePermission(principal, 'ticket.manage', { institutionId: ticket.institutionId });

  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, institutionId: ticket.institutionId, deletedAt: null },
      select: { id: true },
    });
    if (!assignee) throw new AppError('That person is not at this institution.', 404, 'not_found');
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { assigneeId },
    select: { id: true, assigneeId: true },
  });

  await recordAudit(principal, {
    action: 'ticket.assigned',
    entityType: 'SupportTicket',
    entityId: ticket.id,
    institutionId: ticket.institutionId,
    before: { assigneeId: ticket.assigneeId },
    after: { assigneeId: updated.assigneeId },
  });

  return updated;
}

export { OPEN_STATES };
