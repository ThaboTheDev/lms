'use server';

import { registerCohort } from '@/server/services/enrolment';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { addCurriculumItem, addPrerequisite, removeCurriculumItem } from '@/server/services/programmes';
import { curriculumItemSchema } from '@/lib/validation/academic';
import { toFieldErrors, type FormState } from '@/lib/validation/common';

export async function addCourseToCurriculum(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const raw = Object.fromEntries(formData);
  const parsed = curriculumItemSchema.safeParse({
    ...raw,
    isCompulsory: formData.get('isCompulsory') === 'on',
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await addCurriculumItem(principal, parsed.data);
  } catch (error) {
    if (error instanceof AppError) {
      return {
        status: 'error',
        message: error.message,
        fieldErrors: (error.details as Record<string, string>) ?? undefined,
      };
    }
    throw error;
  }

  revalidatePath(`/programmes/${parsed.data.programmeId}`);
  return { status: 'success', message: 'The course has been added to the curriculum.' };
}

export async function removeCourseFromCurriculum(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const itemId = String(formData.get('itemId') ?? '');
  const programmeId = String(formData.get('programmeId') ?? '');
  await removeCurriculumItem(principal, itemId);
  revalidatePath(`/programmes/${programmeId}`);
}

export async function addPrerequisiteRule(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const courseId = String(formData.get('courseId') ?? '');
  const requiredCourseId = String(formData.get('requiredCourseId') ?? '');
  const kind = String(formData.get('kind') ?? 'PREREQUISITE') as
    | 'PREREQUISITE'
    | 'COREQUISITE'
    | 'RECOMMENDED';
  const programmeId = String(formData.get('programmeId') ?? '');

  try {
    await addPrerequisite(principal, { courseId, requiredCourseId, kind });
  } catch (error) {
    if (error instanceof AppError) {
      return {
        status: 'error',
        message: error.message,
        fieldErrors: (error.details as Record<string, string>) ?? undefined,
      };
    }
    throw error;
  }

  revalidatePath(`/programmes/${programmeId}`);
  return { status: 'success', message: 'The rule has been added.' };
}

export async function registerCohortAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const programmeId = String(formData.get('programmeId') ?? '');
  try {
    const result = await registerCohort(principal, {
      programmeId,
      academicTermId: String(formData.get('academicTermId') ?? ''),
      cohortId: String(formData.get('cohortId') ?? '') || undefined,
    });
    revalidatePath(`/programmes/${programmeId}`);
    const skipped = result.skipped.length
      ? ` Not registered: ${result.skipped.slice(0, 5).map((row) => `${row.studentNumber} (${row.reason})`).join('; ')}${result.skipped.length > 5 ? ` and ${result.skipped.length - 5} more` : ''}.`
      : '';
    return { status: result.registered > 0 || result.skipped.length === 0 ? 'success' : 'error', message: `${result.registered} of ${result.learners} learners registered for ${result.courses} course places.${skipped}` };
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
}
