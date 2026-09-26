'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { setInstitutionLogo, updateInstitutionSettings } from '@/server/services/institution-settings';
import type { FormState } from '@/lib/validation/common';

/**
 * Every field is a string on the way in; the service decides what is valid,
 * because the rules belong with the record rather than with the form.
 */
function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  try {
    await updateInstitutionSettings(principal, {
      name: text(formData, 'name'),
      shortName: text(formData, 'shortName'),
      registrationNo: text(formData, 'registrationNo'),
      accreditationNo: text(formData, 'accreditationNo'),
      primaryColour: text(formData, 'primaryColour'),
      secondaryColour: text(formData, 'secondaryColour'),
      contactEmail: text(formData, 'contactEmail'),
      contactPhone: text(formData, 'contactPhone'),
      emailFromName: text(formData, 'emailFromName'),
      emailFromAddress: text(formData, 'emailFromAddress'),
      addressLine1: text(formData, 'addressLine1'),
      addressLine2: text(formData, 'addressLine2'),
      city: text(formData, 'city'),
      province: text(formData, 'province'),
      postalCode: text(formData, 'postalCode'),
      country: text(formData, 'country'),
      timezone: text(formData, 'timezone'),
      locale: text(formData, 'locale'),
      currency: text(formData, 'currency'),
      certificatePrefix: text(formData, 'certificatePrefix'),
      footerText: text(formData, 'footerText'),
      domain: text(formData, 'domain'),
    });

    // Colours and the institution name are read on every signed-in screen.
    revalidatePath('/', 'layout');

    return { status: 'success', message: 'Saved. The change is live from the next page load.' };
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
}

export async function saveLogo(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const remove = formData.get('remove') === '1';
  const fileId = text(formData, 'logoFileId');
  if (!remove && !fileId) return { status: 'error', message: 'Choose an image to upload first.' };
  try {
    await setInstitutionLogo(principal, remove ? null : fileId);
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { status: 'success', message: remove ? 'Logo removed; the built-in crest is back.' : 'Logo saved. It shows from the next page load.' };
}
