'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { parseOptionLines, questionSchema } from '@/lib/validation/assessment';
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
  const options = data.options ? parseOptionLines(data.options) : [];

  // True or false questions are the same shape every time, so they are built
  // rather than retyped.
  const finalOptions =
    data.type === 'TRUE_FALSE' && options.length === 0
      ? [
          { content: 'true', isCorrect: String(formData.get('trueFalseAnswer')) === 'true' },
          { content: 'false', isCorrect: String(formData.get('trueFalseAnswer')) === 'false' },
        ]
      : options;

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
      settings: {
        ...(data.tolerance !== undefined ? { tolerance: data.tolerance } : {}),
        ...(data.acceptedAnswers
          ? { acceptedAnswers: data.acceptedAnswers.split('\n').map((line) => line.trim()).filter(Boolean) }
          : {}),
      },
      options: finalOptions,
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
