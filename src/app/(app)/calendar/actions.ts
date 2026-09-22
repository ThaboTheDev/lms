'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { createEvent } from '@/server/services/calendar';
import type { FormState } from '@/lib/validation/common';

export async function addEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const title = String(formData.get('title') ?? '').trim();
  const startsAt = new Date(String(formData.get('startsAt') ?? ''));
  const endsAt = new Date(String(formData.get('endsAt') ?? ''));

  if (title.length < 2) {
    return { status: 'error', message: 'Give the event a title.', fieldErrors: { title: 'Too short.' } };
  }
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { status: 'error', message: 'Set both a start and an end.' };
  }

  try {
    await createEvent(principal, {
      title,
      description: String(formData.get('description') ?? '') || undefined,
      type: String(formData.get('type') ?? 'ACADEMIC_EVENT'),
      visibility: String(formData.get('visibility') ?? 'INSTITUTION'),
      startsAt,
      endsAt,
      allDay: formData.get('allDay') === 'on',
      location: String(formData.get('location') ?? '') || undefined,
    });
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath('/calendar');
  return { status: 'success', message: 'Added to the calendar.' };
}
