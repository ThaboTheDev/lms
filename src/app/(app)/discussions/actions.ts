'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { hidePost, moderateThread, reply, reportPost, startThread, resolveReport } from '@/server/services/forums';
import type { FormState } from '@/lib/validation/common';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function newThread(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const forumId = String(formData.get('forumId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (title.length < 3) return { status: 'error', message: 'Give your question a title.' };
  if (body.length < 3) return { status: 'error', message: 'Write your question first.' };

  let threadId: string;
  try {
    const thread = await startThread(principal, forumId, { title, body });
    threadId = thread.id;
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/discussions');
  redirect(`/discussions/${threadId}`);
}

export async function postReply(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const threadId = String(formData.get('threadId') ?? '');
  const body = String(formData.get('body') ?? '').trim();

  if (body.length < 1) return { status: 'error', message: 'Write something first.' };

  try {
    await reply(principal, threadId, { body, parentId: String(formData.get('parentId') ?? '') || undefined });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/discussions/${threadId}`);
  return { status: 'success', message: '' };
}

export async function moderate(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const threadId = String(formData.get('threadId') ?? '');
  const action = String(formData.get('action') ?? '') as 'pin' | 'unpin' | 'lock' | 'unlock';
  await moderateThread(principal, threadId, action);
  revalidatePath(`/discussions/${threadId}`);
  revalidatePath('/discussions');
}

export async function togglePostVisibility(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const postId = String(formData.get('postId') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  await hidePost(principal, postId, formData.get('hidden') === 'true');
  revalidatePath(`/discussions/${threadId}`);
}

export async function report(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const postId = String(formData.get('postId') ?? '');
  const reason = String(formData.get('reason') ?? '');

  try {
    await reportPost(principal, postId, reason);
  } catch (error) {
    return fail(error);
  }

  return {
    status: 'success',
    message: 'Reported. A moderator will look at it; the post stays up until they do.',
  };
}

export async function resolveReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const outcome = String(formData.get('outcome') ?? '') === 'hide' ? 'hide' : 'dismiss';
  try {
    await resolveReport(principal, String(formData.get('reportId') ?? ''), outcome);
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/discussions/reports');
  return { status: 'success', message: outcome === 'hide' ? 'Post hidden.' : 'Report dismissed.' };
}
