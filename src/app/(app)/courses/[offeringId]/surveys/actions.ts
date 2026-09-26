'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { FormState } from '@/lib/validation/common';
import {
  addSurveyQuestion,
  createSurvey,
  removeSurveyQuestion,
  setSurveyStatus,
  submitSurveyResponse,
} from '@/server/services/surveys';

async function guarded(run: () => Promise<unknown>, message: string): Promise<FormState> {
  try {
    await run();
    return { status: 'success', message };
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
}

export async function newSurvey(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (title.length < 3) return { status: 'error', message: 'Give the survey a title.', fieldErrors: { title: 'Too short.' } };
  const closes = String(formData.get('closesAt') ?? '');
  let surveyId = '';
  const result = await guarded(async () => {
    const survey = await createSurvey(principal, offeringId, {
      title,
      description: String(formData.get('description') ?? ''),
      isAnonymous: formData.get('isAnonymous') === 'on',
      closesAt: closes ? new Date(closes) : null,
    });
    surveyId = survey.id;
  }, 'Survey created.');
  if (result.status === 'error') return result;
  redirect(`/courses/${offeringId}/surveys/${surveyId}`);
}

export async function newSurveyQuestion(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const surveyId = String(formData.get('surveyId') ?? '');
  const prompt = String(formData.get('prompt') ?? '').trim();
  if (prompt.length < 3) return { status: 'error', message: 'Write the question.', fieldErrors: { prompt: 'Too short.' } };
  const type = String(formData.get('type') ?? 'RATING') as 'RATING' | 'CHOICE' | 'TEXT';
  const result = await guarded(
    () =>
      addSurveyQuestion(principal, surveyId, {
        prompt,
        type: ['RATING', 'CHOICE', 'TEXT'].includes(type) ? type : 'RATING',
        options: String(formData.get('options') ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
        isRequired: formData.get('isRequired') === 'on',
      }),
    'Question added.',
  );
  revalidatePath(`/courses/${offeringId}/surveys/${surveyId}`);
  return result;
}

export async function deleteSurveyQuestion(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const result = await guarded(() => removeSurveyQuestion(principal, String(formData.get('questionId') ?? '')), 'Removed.');
  revalidatePath(`/courses/${String(formData.get('offeringId') ?? '')}/surveys/${String(formData.get('surveyId') ?? '')}`);
  return result;
}

export async function changeSurveyStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const status = formData.get('status') === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const result = await guarded(
    () => setSurveyStatus(principal, String(formData.get('surveyId') ?? ''), status),
    status === 'OPEN' ? 'The survey is open.' : 'The survey is closed.',
  );
  revalidatePath(`/courses/${String(formData.get('offeringId') ?? '')}/surveys`, 'layout');
  return result;
}

export async function answerSurvey(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const surveyId = String(formData.get('surveyId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('q:') && typeof value === 'string') raw[key.slice(2)] = value;
  }
  let problems: Record<string, string> = {};
  const result = await guarded(async () => {
    const outcome = await submitSurveyResponse(principal, surveyId, raw);
    problems = outcome.problems;
  }, 'Thank you. Your response has been recorded.');
  if (result.status === 'error') return result;
  if (Object.keys(problems).length) {
    return {
      status: 'error',
      message: 'Some questions still need an answer.',
      fieldErrors: Object.fromEntries(Object.entries(problems).map(([id, problem]) => [`q:${id}`, problem])),
    };
  }
  revalidatePath(`/courses/${offeringId}/surveys/${surveyId}`);
  return result;
}
