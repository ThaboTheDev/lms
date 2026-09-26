'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { FormState } from '@/lib/validation/common';
import {
  deleteCertificateTemplate,
  saveCertificateTemplate,
  type CredentialKindValue,
} from '@/server/services/certificate-templates';

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

export async function saveTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const templateId = text(formData, 'templateId') || null;
  // An empty upload field keeps the image; "clear" removes it.
  const image = (name: string) => (formData.get(`${name}Clear`) === 'on' ? null : text(formData, name) || undefined);
  try {
    await saveCertificateTemplate(principal, templateId, {
      name: text(formData, 'name'),
      kind: text(formData, 'kind') as CredentialKindValue,
      bodyHtml: String(formData.get('bodyHtml') ?? ''),
      signatoryName: text(formData, 'signatoryName'),
      signatoryTitle: text(formData, 'signatoryTitle'),
      signatureFileId: image('signatureFileId'),
      backgroundFileId: image('backgroundFileId'),
      isDefault: formData.get('isDefault') === 'on',
    });
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/admin/certificate-templates');
  return { status: 'success', message: templateId ? 'Template saved.' : 'Template created.' };
}

export async function removeTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await deleteCertificateTemplate(principal, text(formData, 'templateId'));
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/admin/certificate-templates');
  return { status: 'success', message: 'Template removed.' };
}
