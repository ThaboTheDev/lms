'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { createAsset, createFolder, replaceAsset } from '@/server/services/content-library';
import { toFieldErrors, type FormState } from '@/lib/validation/common';

const assetSchema = z.object({
  fileId: z.string().min(1, 'Upload a file first.'),
  title: z.string().trim().min(2, 'Give it a title.').max(160),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  tags: z.string().trim().max(200).optional().or(z.literal('')),
  folderId: z.string().optional().or(z.literal('')),
  isRestricted: z.coerce.boolean().default(false),
});

export async function addAsset(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = assetSchema.safeParse({
    ...Object.fromEntries(formData),
    isRestricted: formData.get('isRestricted') === 'on',
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await createAsset(principal, {
      ...parsed.data,
      folderId: parsed.data.folderId || undefined,
      tags: (parsed.data.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
    });
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath('/content');
  return { status: 'success', message: 'Added to the library.' };
}

export async function addFolder(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const name = String(formData.get('name') ?? '').trim();
  const parentId = String(formData.get('parentId') ?? '');

  if (name.length < 2) {
    return { status: 'error', message: 'Give the folder a name.', fieldErrors: { name: 'Too short.' } };
  }

  try {
    await createFolder(principal, { name, parentId: parentId || undefined });
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath('/content');
  return { status: 'success', message: 'Folder created.' };
}

export async function publishNewVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assetId = String(formData.get('assetId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');
  const note = String(formData.get('note') ?? '');

  if (!fileId) {
    return { status: 'error', message: 'Upload the replacement file first.' };
  }

  try {
    await replaceAsset(principal, assetId, { fileId, note: note || undefined });
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath('/content');
  return { status: 'success', message: 'New version published. The previous one is kept in the history.' };
}
