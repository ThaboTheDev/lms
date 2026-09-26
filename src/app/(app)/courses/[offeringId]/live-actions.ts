'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { FormState } from '@/lib/validation/common';
import { LIVE_PROVIDERS, scheduleLiveSession, setRecording } from '@/server/services/live-sessions';

function failure(error: unknown): FormState {
  if (error instanceof AppError) {
    const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, string>) : undefined;
    return { status: 'error', message: error.message, fieldErrors: details };
  }
  throw error;
}

export async function scheduleLive(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const provider = String(formData.get('provider') ?? 'OTHER') as (typeof LIVE_PROVIDERS)[number];
  const startsAt = new Date(String(formData.get('startsAt') ?? ''));
  const endsAt = new Date(String(formData.get('endsAt') ?? ''));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { status: 'error', message: 'Enter when the class starts and ends.' };
  try {
    await scheduleLiveSession(principal, {
      offeringId,
      title: String(formData.get('title') ?? ''),
      provider: LIVE_PROVIDERS.includes(provider) ? provider : 'OTHER',
      joinUrl: String(formData.get('joinUrl') ?? '').trim() || undefined,
      hostUrl: String(formData.get('hostUrl') ?? '').trim() || undefined,
      passcode: String(formData.get('passcode') ?? ''),
      startsAt,
      endsAt,
      register: formData.get('register') === 'on',
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/courses/${offeringId}`);
  return { status: 'success', message: 'Scheduled. Learners have been told and it is on their calendar.' };
}

export async function addRecording(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await setRecording(principal, String(formData.get('liveSessionId') ?? ''), String(formData.get('recordingUrl') ?? '').trim());
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/courses/${String(formData.get('offeringId') ?? '')}`);
  return { status: 'success', message: 'Recording added.' };
}
