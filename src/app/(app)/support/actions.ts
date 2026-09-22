'use server';

import { revalidatePath } from 'next/cache';
import type { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { createTicket, replyToTicket, setTicketStatus, assignTicket } from '@/server/services/support';
import type { FormState } from '@/lib/validation/common';

const CATEGORIES: TicketCategory[] = ['TECHNICAL', 'ACADEMIC', 'FINANCE', 'REGISTRATION', 'GENERAL'];
const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'];

function refresh(ticketId?: string) {
  revalidatePath('/support');
  if (ticketId) revalidatePath(`/support/${ticketId}`);
}

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function raiseTicket(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const subject = String(formData.get('subject') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const category = String(formData.get('category') ?? 'GENERAL') as TicketCategory;
  const priority = String(formData.get('priority') ?? 'NORMAL') as TicketPriority;

  if (subject.length < 5) {
    return { status: 'error', message: 'Say what the problem is in a line.', fieldErrors: { subject: 'Too short.' } };
  }
  if (description.length < 10) {
    return { status: 'error', message: 'Give whoever picks this up something to work with.', fieldErrors: { description: 'Too short.' } };
  }

  try {
    const ticket = await createTicket(principal, {
      subject,
      description,
      category: CATEGORIES.includes(category) ? category : 'GENERAL',
      priority: PRIORITIES.includes(priority) ? priority : 'NORMAL',
    });

    refresh(ticket.id);
    return { status: 'success', message: `Logged as ${ticket.number}. Somebody will come back to you.` };
  } catch (error) {
    return fail(error);
  }
}

export async function reply(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const ticketId = String(formData.get('ticketId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const isInternalNote = formData.get('internal') === 'on';

  if (!ticketId) return { status: 'error', message: 'That ticket no longer exists.' };
  if (body.length < 2) {
    return { status: 'error', message: 'Write a reply first.', fieldErrors: { body: 'Too short.' } };
  }

  try {
    await replyToTicket(principal, ticketId, body, isInternalNote);
    refresh(ticketId);
    return { status: 'success', message: isInternalNote ? 'Note added.' : 'Reply sent.' };
  } catch (error) {
    return fail(error);
  }
}

export async function changeStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const ticketId = String(formData.get('ticketId') ?? '');
  const status = String(formData.get('status') ?? '') as TicketStatus;

  if (!ticketId || !STATUSES.includes(status)) {
    return { status: 'error', message: 'Choose a status.' };
  }

  try {
    await setTicketStatus(principal, ticketId, status);
    refresh(ticketId);
    return { status: 'success', message: 'Status updated.' };
  } catch (error) {
    return fail(error);
  }
}

export async function assign(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const ticketId = String(formData.get('ticketId') ?? '');
  const assigneeId = String(formData.get('assigneeId') ?? '');

  if (!ticketId) return { status: 'error', message: 'That ticket no longer exists.' };

  try {
    await assignTicket(principal, ticketId, assigneeId || null);
    refresh(ticketId);
    return { status: 'success', message: assigneeId ? 'Ticket assigned.' : 'Ticket unassigned.' };
  } catch (error) {
    return fail(error);
  }
}
