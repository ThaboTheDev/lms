'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { markNotificationsRead, savePreference } from '@/server/services/notifications';
import { MANDATORY_TYPES, type NotificationType } from '@/server/services/notification-rules';
import type { FormState } from '@/lib/validation/common';

export async function markAllRead(): Promise<void> {
  const principal = await requirePrincipal();
  await markNotificationsRead(principal);
  revalidatePath('/notifications');
}

export async function updatePreference(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const type = String(formData.get('type') ?? '') as NotificationType;

  await savePreference(principal, type, {
    inApp: formData.get('inApp') === 'on',
    email: formData.get('email') === 'on',
    sms: formData.get('sms') === 'on',
    push: formData.get('push') === 'on',
  });

  revalidatePath('/notifications');

  return {
    status: 'success',
    message: MANDATORY_TYPES.includes(type)
      ? 'Saved. This kind of notice is always sent, because it carries consequences whether or not it is read.'
      : 'Saved.',
  };
}
