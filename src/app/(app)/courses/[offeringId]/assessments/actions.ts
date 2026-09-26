'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { assessmentSchema, gradeSchema } from '@/lib/validation/assessment';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import { createAssessment, publishAssessment, updateAssessment } from '@/server/services/assessments';
import { addPool, attachQuestion } from '@/server/services/question-bank';
import {
  attachSubmissionFile,
  gradeSubmission,
  releaseResults,
  saveAnswers,
  startAttempt,
  submitAttempt,
  removeSubmissionFile,
} from '@/server/services/submissions';
import { finaliseCourseResults } from '@/server/services/gradebook';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function newAssessment(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = assessmentSchema.safeParse({
    ...Object.fromEntries(formData),
    allowLate: formData.get('allowLate') === 'on',
    shuffleQuestions: formData.get('shuffleQuestions') === 'on',
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const { offeringId, ...input } = parsed.data;
  let assessmentId: string;

  try {
    const assessment = await createAssessment(principal, offeringId, input as never);
    assessmentId = assessment.id;
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/courses/${offeringId}/assessments`);
  redirect(`/courses/${offeringId}/assessments/${assessmentId}`);
}

export async function publish(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');
  await publishAssessment(principal, assessmentId);
  revalidatePath(`/courses/${offeringId}/assessments/${assessmentId}`);
  revalidatePath(`/courses/${offeringId}/assessments`);
}

export async function release(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');

  try {
    const result = await releaseResults(principal, assessmentId);
    revalidatePath(`/courses/${offeringId}/assessments/${assessmentId}`);
    return { status: 'success', message: `${result.released} results released to learners.` };
  } catch (error) {
    return fail(error);
  }
}

export async function addQuestionToAssessment(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const questionId = String(formData.get('questionId') ?? '');
  const mark = formData.get('mark') ? Number(formData.get('mark')) : undefined;
  const offeringId = String(formData.get('offeringId') ?? '');

  if (!questionId) return { status: 'error', message: 'Choose a question.' };

  try {
    await attachQuestion(principal, assessmentId, questionId, mark);
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/courses/${offeringId}/assessments/${assessmentId}`);
  return { status: 'success', message: 'Question added to the paper.' };
}

export async function addQuestionPool(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');

  try {
    await addPool(principal, assessmentId, {
      bankId: String(formData.get('bankId') ?? ''),
      name: String(formData.get('name') ?? 'Pool'),
      drawCount: Number(formData.get('drawCount') ?? 1),
      markPerQuestion: Number(formData.get('markPerQuestion') ?? 1),
      difficulty: String(formData.get('difficulty') ?? '') || undefined,
      topic: String(formData.get('topic') ?? '') || undefined,
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/courses/${offeringId}/assessments/${assessmentId}`);
  return { status: 'success', message: 'Pool added. Each learner draws their own questions from it.' };
}

export async function beginAttempt(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');
  const submission = await startAttempt(principal, assessmentId);
  redirect(`/courses/${offeringId}/assessments/${assessmentId}/attempt?id=${submission.id}`);
}

export async function saveAttempt(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const submissionId = String(formData.get('submissionId') ?? '');
  const raw = String(formData.get('responses') ?? '{}');

  try {
    await saveAnswers(principal, submissionId, JSON.parse(raw));
    return { status: 'success', message: 'Saved.' };
  } catch (error) {
    return fail(error);
  }
}

export async function finishAttempt(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const submissionId = String(formData.get('submissionId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const responses = String(formData.get('responses') ?? '');

  try {
    if (responses) await saveAnswers(principal, submissionId, JSON.parse(responses));
    await submitAttempt(principal, submissionId);
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/courses/${offeringId}/assessments/${assessmentId}`);
  redirect(`/courses/${offeringId}/assessments/${assessmentId}`);
}

export async function attachWork(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const submissionId = String(formData.get('submissionId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');

  if (!fileId) return { status: 'error', message: 'Upload a file first.' };

  try {
    await attachSubmissionFile(principal, submissionId, fileId);
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/courses/${String(formData.get('offeringId') ?? '')}/assessments`);
  return { status: 'success', message: 'File attached. Submit when you are ready.' };
}

export async function recordGrade(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = gradeSchema.safeParse({
    ...Object.fromEntries(formData),
    requestResubmission: formData.get('requestResubmission') === 'on',
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  // Rubric scores arrive as rubric[criterionId] fields alongside the rest.
  const rubricScores = [...formData.entries()]
    .filter(([key]) => key.startsWith('rubric['))
    .map(([key, value]) => ({
      criterionId: key.slice('rubric['.length, -1),
      score: Number(value),
    }))
    .filter((entry) => Number.isFinite(entry.score));

  try {
    const result = await gradeSubmission(principal, parsed.data.submissionId, {
      manualMark: parsed.data.manualMark,
      feedback: parsed.data.feedback || undefined,
      requestResubmission: parsed.data.requestResubmission,
      rubricScores: rubricScores.length ? rubricScores : undefined,
    });
    revalidatePath(`/courses/${String(formData.get('offeringId') ?? '')}/assessments`);
    return {
      status: 'success',
      message: `Recorded ${result.finalMark}${result.grade ? ` (${result.grade})` : ''}. Learners see it once results are released.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function finaliseResults(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');

  try {
    const result = await finaliseCourseResults(principal, offeringId);
    revalidatePath(`/courses/${offeringId}/gradebook`);
    return {
      status: 'success',
      message:
        `${result.finalised} course results recorded.` +
        (result.skipped.length ? ` ${result.skipped.length} learners still have work outstanding and were left alone.` : ''),
    };
  } catch (error) {
    return fail(error);
  }
}

/** Edits an assessment's details. Marks and weighting lock once learners have submitted. */
export async function saveAssessment(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const parsed = assessmentSchema.safeParse({
    ...Object.fromEntries(formData),
    allowLate: formData.get('allowLate') === 'on',
    shuffleQuestions: formData.get('shuffleQuestions') === 'on',
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) };
  }
  const { offeringId, type: _type, rubricId, gradingSchemeId: _scheme, ...input } = parsed.data;
  void _type;
  void _scheme;
  try {
    await updateAssessment(principal, assessmentId, {
      ...input,
      instructions: input.instructions || null,
      timeLimitMinutes: input.timeLimitMinutes || null,
      latePenaltyPct: input.latePenaltyPct ?? null,
      rubricId: rubricId || null,
    } as never);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/courses/${offeringId}/assessments/${assessmentId}`);
  revalidatePath(`/courses/${offeringId}/assessments`);
  return { status: 'success', message: 'Saved.' };
}

/** Takes a file off an assignment that has not been submitted yet. */
export async function removeWork(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await removeSubmissionFile(principal, String(formData.get('submissionId') ?? ''), String(formData.get('fileId') ?? ''));
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/courses/${String(formData.get('offeringId') ?? '')}/assessments`);
  return { status: 'success', message: 'Removed.' };
}
