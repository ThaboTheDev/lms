'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { replyToThread, startThread } from '@/server/services/messaging';
import type { FormState } from '@/lib/validation/common';

export async function newConversation(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const recipientId = String(formData.get('recipientId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  const subject = String(formData.get('subject') ?? '').trim();

  if (!recipientId) return { status: 'error', message: 'Choose who this is for.' };
  if (body.length < 2) return { status: 'error', message: 'Write your message first.' };

  let threadId: string;
  try {
    const thread = await startThread(principal, { recipientId, subject, body, fileIds: [String(formData.get('fileId') ?? '')].filter(Boolean) });
    threadId = thread.id;
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath('/messages');
  redirect(`/messages/${threadId}`);
}

export async function sendReply(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const threadId = String(formData.get('threadId') ?? '');
  const body = String(formData.get('body') ?? '').trim();

  if (body.length < 1) return { status: 'error', message: 'Write something first.' };

  try {
    await replyToThread(principal, threadId, body, [String(formData.get('fileId') ?? '')].filter(Boolean));
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath(`/messages/${threadId}`);
  revalidatePath('/messages');
  return { status: 'success', message: '' };
}
