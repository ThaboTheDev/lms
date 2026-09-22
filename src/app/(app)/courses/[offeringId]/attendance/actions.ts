'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { createSession, markRegister, selfCheckIn } from '@/server/services/attendance';
import type { FormState } from '@/lib/validation/common';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function addSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const scheduledStart = new Date(String(formData.get('scheduledStart') ?? ''));
  const scheduledEnd = new Date(String(formData.get('scheduledEnd') ?? ''));
  const title = String(formData.get('title') ?? '').trim();

  if (title.length < 2) return { status: 'error', message: 'Give the session a title.' };
  if (Number.isNaN(scheduledStart.getTime()) || Number.isNaN(scheduledEnd.getTime())) {
    return { status: 'error', message: 'Set when the session starts and ends.' };
  }

  try {
    await createSession(principal, offeringId, {
      title,
      mode: String(formData.get('mode') ?? 'IN_PERSON'),
      scheduledStart,
      scheduledEnd,
      venue: String(formData.get('venue') ?? '') || undefined,
      selfCheckInEnabled: formData.get('selfCheckInEnabled') === 'on',
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/courses/${offeringId}/attendance`);
  return { status: 'success', message: 'Session added. The register is ready to take.' };
}

/**
 * Takes the whole register in one submission. Everyone on the list is written,
 * including the learners left unmarked, so a half-taken register is visible as
 * such rather than looking like a room of absentees.
 */
export async function takeRegister(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const sessionId = String(formData.get('sessionId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');

  const marks = [...formData.entries()]
    .filter(([key]) => key.startsWith('status['))
    .map(([key, value]) => ({
      studentId: key.slice('status['.length, -1),
      status: String(value),
    }))
    .filter((mark) => mark.status && mark.status !== 'NOT_MARKED');

  if (marks.length === 0) {
    return { status: 'error', message: 'Nothing was marked.' };
  }

  try {
    const result = await markRegister(principal, sessionId, marks);
    revalidatePath(`/courses/${offeringId}/attendance/${sessionId}`);
    revalidatePath(`/courses/${offeringId}/attendance`);
    return { status: 'success', message: `Register taken for ${result.marked} learners.` };
  } catch (error) {
    return fail(error);
  }
}

export async function checkIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const sessionId = String(formData.get('sessionId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');
  const code = String(formData.get('code') ?? '');

  try {
    const result = await selfCheckIn(principal, sessionId, code);
    revalidatePath(`/courses/${offeringId}/attendance/${sessionId}`);
    return {
      status: 'success',
      message:
        result.status === 'LATE'
          ? 'Checked in. You have been marked late.'
          : 'Checked in. You have been marked present.',
    };
  } catch (error) {
    return fail(error);
  }
}
