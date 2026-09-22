'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { readSession, markSessionVerified } from '@/lib/auth/session';
import { verifySecondFactor } from '@/lib/auth/mfa';
import { rateLimit } from '@/lib/rate-limit';
import type { FormState } from '@/lib/validation/common';

export async function verifyCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await readSession();
  if (!session) return { status: 'error', message: 'Your sign in expired. Start again.' };

  // Guessing a six digit code is cheap without a limit, and this is the last
  // door between a stolen password and somebody's records.
  const limit = await rateLimit(`mfa:${session.userId}`, 6, 300);
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many attempts. Wait a few minutes and try again.' };
  }

  const token = String(formData.get('token') ?? '').trim();
  const next = String(formData.get('next') ?? '/dashboard');

  const passed = await verifySecondFactor(session.userId, token);
  if (!passed) {
    return { status: 'error', message: 'That code did not match. Check your app, or use a recovery code.' };
  }

  await markSessionVerified();
  // As in the sign-in action: a path inside this application only, so the
  // redirect cannot be pointed somewhere else.
  redirect((next.startsWith('/') ? next : '/dashboard') as Route);
}
