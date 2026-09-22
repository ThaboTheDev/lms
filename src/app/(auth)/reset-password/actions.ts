'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { AppError } from '@/lib/errors';
import { completePasswordReset } from '@/server/services/password-reset';
import type { FormState } from '@/lib/validation/common';

export async function choosePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('confirmation') ?? '');

  if (password !== confirmation) {
    return {
      status: 'error',
      message: 'The two passwords do not match.',
      fieldErrors: { confirmation: 'Type it again to match.' },
    };
  }

  try {
    await completePasswordReset(token, password);
  } catch (error) {
    if (error instanceof AppError) {
      return { status: 'error', message: error.message, fieldErrors: { password: error.message } };
    }
    throw error;
  }

  // Carries the person to the form they were probably trying to reach first.
  redirect('/login?reset=1' as Route);
}
