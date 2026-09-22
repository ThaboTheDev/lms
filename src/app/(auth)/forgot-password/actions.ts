'use server';

import { emailSchema } from '@/lib/validation/common';
import { requestPasswordReset } from '@/server/services/password-reset';
import type { FormState } from '@/lib/validation/common';

/**
 * Always answers the same way. Whether or not the address is registered here is
 * exactly what this form must not reveal.
 */
export async function sendResetLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(String(formData.get('email') ?? '').trim());
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter the email address your account uses.',
      fieldErrors: { email: 'That does not look like an email address.' },
    };
  }

  await requestPasswordReset(parsed.data);

  return {
    status: 'success',
    message: 'If that address belongs to an account here, a link is on its way. It works for an hour.',
  };
}
