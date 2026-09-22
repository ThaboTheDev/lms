'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { createStudent } from '@/server/services/students';
import { createStudentSchema } from '@/lib/validation/student';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import { AppError } from '@/lib/errors';

export async function registerStudent(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = createStudentSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  let studentId: string;
  try {
    const student = await createStudent(principal, parsed.data);
    studentId = student.id;
  } catch (error) {
    if (error instanceof AppError) {
      return { status: 'error', message: error.message };
    }
    // A duplicate email is the common failure here and deserves a plain answer.
    const message =
      error instanceof Error && error.message.includes('Unique constraint')
        ? 'An account already exists for that email address.'
        : 'The learner could not be registered. Try again.';
    return { status: 'error', message };
  }

  revalidatePath('/students');
  redirect(`/students/${studentId}`);
}
