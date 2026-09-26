'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { hashIp } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { createSession, readClientContext } from '@/lib/auth/session';
import type { FormState } from '@/lib/validation/common';
import type { SetupField } from '@/lib/validation/setup';
import {
  completeSetup,
  parseSetupSubmission,
  setupAuditEntry,
  setupPending,
  SetupRefusedError,
  setupTokenAccepted,
  type SetupResult,
} from '@/server/services/setup';

export interface SetupFormState extends FormState {
  fieldErrors?: Partial<Record<SetupField, string>>;
  /**
   * What was typed, secrets left out, so a rejected form comes back filled in:
   * React resets a form once its action returns.
   */
  values?: Partial<Record<SetupField, string>>;
}

/**
 * Where a submission goes once setup has closed: a stale second tab, or the
 * loser of two submissions racing. It is thrown from the action on purpose. A
 * server action redirects with 303, so the browser follows with a GET; if the
 * refusal were returned as form state instead, a browser without JavaScript
 * would get this page re-rendered, and the page's own guard redirects with 307,
 * which replays the POST against /login.
 */
const SETUP_CLOSED = '/login?setup=done' as Route;

const ECHOED_FIELDS = ['institutionName', 'institutionSlug', 'firstName', 'lastName', 'email'] as const;

function echo(formData: FormData): SetupFormState['values'] {
  return Object.fromEntries(
    ECHOED_FIELDS.map((field) => [field, String(formData.get(field) ?? '')]),
  );
}

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  );
}

export async function runSetup(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  try {
    return await attemptSetup(formData);
  } catch (error) {
    // redirect() works by throwing. Let it through; anything else is a fault.
    if (isNextRedirect(error)) throw error;
    console.error('[setup] first-run setup failed', error);
    return {
      status: 'error',
      message: 'Setup could not be completed. Check the server log, then try again.',
      values: echo(formData),
    };
  }
}

async function attemptSetup(formData: FormData): Promise<SetupFormState> {
  // Counted first, before the token is compared and before any argon2 work:
  // this page is public until the first account exists.
  const context = await readClientContext();
  const limit = await rateLimit(`setup:${hashIp(context.ipAddress) ?? 'unknown'}`, 5, 3600);
  // Then, whatever else is wrong with the request: once setup has closed, it
  // goes to sign in. One cheap query, the same one the page itself asks.
  if (!(await setupPending(prisma))) redirect(SETUP_CLOSED);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    const wait = minutes > 1 ? `in about ${minutes} minutes` : minutes === 1 ? 'in a minute' : 'later';
    return { status: 'error', message: `Too many setup attempts from this connection. Try again ${wait}.` };
  }

  const values = echo(formData);

  if (!setupTokenAccepted(env.SETUP_TOKEN, formData.get('setupToken'))) {
    return {
      status: 'error',
      message: 'The setup token was not accepted.',
      fieldErrors: { setupToken: 'Enter the SETUP_TOKEN value this server was started with.' },
      values,
    };
  }

  const submission = parseSetupSubmission(Object.fromEntries(formData));
  if (!submission.success) {
    return {
      status: 'error',
      message: 'Check the highlighted fields.',
      fieldErrors: submission.fieldErrors,
      values,
    };
  }

  let result: SetupResult;
  try {
    result = await completeSetup(prisma, submission.data);
  } catch (error) {
    // Lost a race: somebody else's setup committed while this one waited.
    if (error instanceof SetupRefusedError && error.reason === 'closed') redirect(SETUP_CLOSED);
    if (error instanceof AppError) {
      return {
        status: 'error',
        message: error.message,
        fieldErrors: error.details as SetupFormState['fieldErrors'],
        values,
      };
    }
    throw error;
  }

  // After the commit, not inside the transaction: recordAudit writes on its
  // own connection, which could not see the new rows until then.
  await recordAudit(null, setupAuditEntry(result, 'setup_page'));

  try {
    // Not MFA-verified: no second factor was presented. The session is still
    // valid, because the account has none yet; once it is turned on at
    // /security, a fresh sign-in with the code is asked for.
    await createSession(result.userId, context, false);
  } catch (error) {
    // The account exists and setup is closed, so this form can no longer
    // help. The sign-in screen can.
    console.error('[setup] administrator created, but the session could not be started', error);
    redirect('/login');
  }

  redirect('/dashboard');
}
