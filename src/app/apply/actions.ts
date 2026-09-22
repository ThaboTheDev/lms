'use server';

import { redirect } from 'next/navigation';
import { applicationSubmissionSchema } from '@/lib/validation/application';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import { submitApplication } from '@/server/services/admissions';
import { resolvePublicInstitution } from '@/server/services/tenancy';
import { rateLimit } from '@/lib/rate-limit';
import { readClientContext } from '@/lib/auth/session';
import { hashIp } from '@/lib/crypto';
import { AppError } from '@/lib/errors';

/**
 * Public endpoint, so it is rate limited per IP address. An application is
 * cheap for us and expensive to moderate, and an open form invites abuse.
 */
export async function applyNow(_prev: FormState, formData: FormData): Promise<FormState> {
  const context = await readClientContext();
  const key = hashIp(context.ipAddress) ?? 'unknown';
  const limit = await rateLimit(`apply:${key}`, 5, 3600);
  if (!limit.allowed) {
    return {
      status: 'error',
      message: 'Several applications have already been sent from this connection. Try again later.',
    };
  }

  const parsed = applicationSubmissionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const institution = await resolvePublicInstitution(String(formData.get('institutionSlug') ?? '') || undefined);

  let reference: string;
  try {
    const application = await submitApplication(institution.id, parsed.data);
    reference = application.referenceNumber;
  } catch (error) {
    if (error instanceof AppError) {
      return { status: 'error', message: error.message, fieldErrors: error.details as never };
    }
    return { status: 'error', message: 'The application could not be sent. Try again.' };
  }

  redirect(`/apply/submitted?reference=${reference}`);
}
