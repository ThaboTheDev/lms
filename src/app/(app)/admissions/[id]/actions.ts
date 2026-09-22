'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { enrolAcceptedApplicant, transitionApplication } from '@/server/services/admissions';
import { applicationDecisionSchema } from '@/lib/validation/application';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import type { ApplicationStatus } from '@/server/services/admissions-workflow';

export async function decideApplication(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = applicationDecisionSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const { applicationId, decision, notes, conditions } = parsed.data;

  try {
    await transitionApplication(principal, applicationId, decision as ApplicationStatus, {
      note: notes || undefined,
      conditions: conditions || undefined,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }

  revalidatePath(`/admissions/${applicationId}`);
  revalidatePath('/admissions');
  return { status: 'success', message: 'The application has been updated and the applicant will be notified.' };
}

export async function enrolApplicant(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const applicationId = String(formData.get('applicationId') ?? '');
  const cohortId = String(formData.get('cohortId') ?? '');

  let studentId: string;
  try {
    const result = await enrolAcceptedApplicant(principal, applicationId, {
      cohortId: cohortId || undefined,
    });
    studentId = result.studentId;
  } catch (error) {
    if (error instanceof AppError) {
      return { status: 'error', message: error.message };
    }
    throw error;
  }

  revalidatePath('/admissions');
  revalidatePath('/students');
  redirect(`/students/${studentId}`);
}
