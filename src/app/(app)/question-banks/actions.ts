'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { questionSchema } from '@/lib/validation/assessment';
import { optionsForType, settingsForType } from '@/lib/validation/question-form';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import { addQuestion, createBank } from '@/server/services/question-bank';

export async function newBank(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const name = String(formData.get('name') ?? '').trim();
  const courseId = String(formData.get('courseId') ?? '');

  if (name.length < 2) {
    return { status: 'error', message: 'Give the bank a name.', fieldErrors: { name: 'Too short.' } };
  }

  let bankId: string;
  try {
    const bank = await createBank(principal, {
      name,
      courseId: courseId || undefined,
      description: String(formData.get('description') ?? '') || undefined,
    });
    bankId = bank.id;
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }

  revalidatePath('/question-banks');
  redirect(`/question-banks/${bankId}`);
}

export async function newQuestion(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = questionSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const data = parsed.data;
  const fields = {
    options: data.options,
    correctValue: String(formData.get('correctValue') ?? ''),
    trueFalseAnswer: String(formData.get('trueFalseAnswer') ?? ''),
    acceptedAnswers: data.acceptedAnswers,
    tolerance: data.tolerance,
  };

  try {
    await addQuestion(principal, data.bankId, {
      type: data.type,
      prompt: data.prompt,
      explanation: data.explanation || undefined,
      defaultMark: data.defaultMark,
      difficulty: data.difficulty,
      bloomLevel: data.bloomLevel || null,
      topic: data.topic || null,
      tags: (data.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      settings: settingsForType(data.type, fields),
      options: optionsForType(data.type, fields),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return {
        status: 'error',
        message: error.message,
        fieldErrors: { options: error.message },
      };
    }
    throw error;
  }

  revalidatePath(`/question-banks/${data.bankId}`);
  return { status: 'success', message: 'Question added to the bank.' };
}
