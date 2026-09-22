'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { adjustCohortMarks, recordModeration } from '@/server/services/moderation';
import { addQaDocument, completeReview, startReview } from '@/server/services/quality';
import type { FormState } from '@/lib/validation/common';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function submitModeration(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');

  // Moderator marks arrive as sample[submissionId] alongside the rest.
  const sampleMarks = [...formData.entries()]
    .filter(([key]) => key.startsWith('sample['))
    .map(([key, value]) => ({
      submissionId: key.slice('sample['.length, -1),
      moderatorMark: Number(value),
    }))
    .filter((entry) => Number.isFinite(entry.moderatorMark) && String(entry.moderatorMark) !== '');

  try {
    const result = await recordModeration(principal, {
      assessmentId,
      type: String(formData.get('type') ?? 'INTERNAL') as never,
      outcome: String(formData.get('outcome') ?? '') || undefined,
      comments: String(formData.get('comments') ?? '') || undefined,
      sampleMarks: sampleMarks.length > 0 ? sampleMarks : undefined,
    });

    revalidatePath(`/quality/moderation/${assessmentId}`);
    revalidatePath('/quality');

    return {
      status: 'success',
      message: result.analysis
        ? `Recorded. ${result.analysis.reasons.join(' ')}`
        : 'Moderation recorded.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function adjustMarks(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const kind = String(formData.get('kind') ?? 'NONE') as 'NONE' | 'SHIFT' | 'SCALE';
  const value = Number(formData.get('value') ?? 0);

  try {
    const result = await adjustCohortMarks(
      principal,
      assessmentId,
      { kind, value },
      String(formData.get('reason') ?? ''),
    );

    revalidatePath(`/quality/moderation/${assessmentId}`);
    return {
      status: 'success',
      message: `${result.affected} marks changed. ${result.note}`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function addDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const title = String(formData.get('title') ?? '').trim();

  if (title.length < 3) return { status: 'error', message: 'Give the document a title.' };

  try {
    await addQaDocument(principal, {
      title,
      category: String(formData.get('category') ?? 'CURRICULUM'),
      fileId: String(formData.get('fileId') ?? '') || undefined,
      programmeId: String(formData.get('programmeId') ?? '') || undefined,
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/quality');
  return { status: 'success', message: 'Filed against the programme evidence.' };
}

export async function planReview(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const dueOn = String(formData.get('dueOn') ?? '');

  try {
    await startReview(principal, {
      programmeId: String(formData.get('programmeId') ?? ''),
      cycle: String(formData.get('cycle') ?? '').trim() || String(new Date().getFullYear()),
      dueOn: dueOn ? new Date(dueOn) : undefined,
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/quality');
  return { status: 'success', message: 'Review planned.' };
}

export async function closeReview(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const findings = String(formData.get('findings') ?? '').trim();
  const actions = String(formData.get('actions') ?? '').trim();

  if (findings.length < 5) return { status: 'error', message: 'Record what the review found.' };
  if (actions.length < 5) return { status: 'error', message: 'Record what will be done about it.' };

  try {
    await completeReview(principal, String(formData.get('reviewId') ?? ''), { findings, actions });
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/quality');
  return { status: 'success', message: 'Review closed.' };
}
