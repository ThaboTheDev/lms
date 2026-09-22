'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { publishAnnouncement } from '@/server/services/announcements';
import type { FormState } from '@/lib/validation/common';

export async function publish(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const audience = String(formData.get('audience') ?? 'INSTITUTION');

  if (title.length < 3) {
    return { status: 'error', message: 'Give the announcement a title.', fieldErrors: { title: 'Too short.' } };
  }
  if (body.length < 3) {
    return { status: 'error', message: 'Write the announcement first.', fieldErrors: { body: 'Too short.' } };
  }

  try {
    const result = await publishAnnouncement(principal, {
      title,
      body,
      audience,
      offeringId: String(formData.get('offeringId') ?? '') || undefined,
      programmeId: String(formData.get('programmeId') ?? '') || undefined,
      isPinned: formData.get('isPinned') === 'on',
      publishNow: formData.get('draft') !== 'on',
    });

    revalidatePath('/announcements');
    revalidatePath('/dashboard');

    return {
      status: 'success',
      message: result.announcement.publishedAt
        ? `Published to ${result.recipients} people.`
        : 'Saved as a draft. Nobody has been notified.',
    };
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
}
