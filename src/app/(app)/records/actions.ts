'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { issueTranscript } from '@/server/services/academic-records';
import { recordProgressionDecision } from '@/server/services/progression';
import { issueCertificate, revokeCertificate } from '@/server/services/certificates';
import type { FormState } from '@/lib/validation/common';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function generateTranscript(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const studentId = String(formData.get('studentId') ?? '');

  try {
    await issueTranscript(principal, studentId);
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/records/${studentId}`);
  return {
    status: 'success',
    message: 'Transcript issued. The copy is fixed as at today and will not change if a mark is corrected later.',
  };
}

export async function decideProgression(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const studentId = String(formData.get('studentId') ?? '');
  const programmeId = String(formData.get('programmeId') ?? '');
  const academicYearId = String(formData.get('academicYearId') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  const notes = String(formData.get('notes') ?? '');

  try {
    await recordProgressionDecision(
      principal,
      { studentId, programmeId, academicYearId },
      { outcome: outcome || undefined, notes: notes || undefined },
    );
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/records/${studentId}`);
  revalidatePath('/records');
  return { status: 'success', message: 'Decision recorded.' };
}

export async function issueCredential(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const studentId = String(formData.get('studentId') ?? '');
  const kind = String(formData.get('kind') ?? 'QUALIFICATION');
  const overrideReason = String(formData.get('overrideReason') ?? '').trim();

  try {
    const certificate = await issueCertificate(principal, {
      studentId,
      kind: kind as never,
      title: String(formData.get('title') ?? '') || undefined,
      offeringId: String(formData.get('offeringId') ?? '') || undefined,
      overrideReason: overrideReason || undefined,
    });

    revalidatePath(`/records/${studentId}`);
    revalidatePath('/certificates');
    return {
      status: 'success',
      message: `Issued ${certificate.number}. The verification code is printed on the certificate.`,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_eligible') {
      return {
        status: 'error',
        message: `${error.message} Record a reason below if you are issuing this anyway.`,
      };
    }
    return fail(error);
  }
}

export async function revokeCredential(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const certificateId = String(formData.get('certificateId') ?? '');
  const reason = String(formData.get('reason') ?? '');

  try {
    await revokeCertificate(principal, certificateId, reason);
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/certificates/${certificateId}`);
  revalidatePath('/certificates');
  return { status: 'success', message: 'Revoked. Anyone checking the code now sees that it was withdrawn.' };
}
