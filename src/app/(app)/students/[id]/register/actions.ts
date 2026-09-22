'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { registerForCourses } from '@/server/services/enrolment';
import type { FormState } from '@/lib/validation/common';

export async function registerCourses(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const studentId = String(formData.get('studentId') ?? '');
  const academicTermId = String(formData.get('academicTermId') ?? '');
  const offeringIds = formData.getAll('offeringIds').map(String).filter(Boolean);

  if (offeringIds.length === 0) {
    return { status: 'error', message: 'Choose at least one course.' };
  }

  try {
    await registerForCourses(principal, studentId, academicTermId, offeringIds);
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath(`/students/${studentId}`);
  redirect(`/students/${studentId}?tab=results`);
}
