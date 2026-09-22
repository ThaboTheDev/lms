import type { Metadata } from 'next';
import Link from 'next/link';
import { readPasswordResetToken } from '@/server/services/password-reset';
import { PublicFrame } from '@/components/brand/public-frame';
import { ResetPasswordForm } from './reset-form';

export const metadata: Metadata = { title: 'Choose a password' };

/**
 * One page for two arrivals: somebody invited, who has never had a password,
 * and somebody who forgot theirs. The token says which, and it is the only
 * thing that makes this page reachable.
 */
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const account = token ? await readPasswordResetToken(token) : null;
  const isInvitation = account?.kind === 'invitation';

  return (
    <PublicFrame width="md" center>
      <h1 className="font-serif text-2xl font-semibold">
        {isInvitation ? 'Set up your account' : 'Choose a new password'}
      </h1>

      {account && token ? (
        <>
          <p className="mt-2 text-sm text-muted">
            {isInvitation
              ? 'Somebody has created an account for you. Choose a password and it is ready to use.'
              : `Choosing a new one for ${account.email}. Everywhere you are signed in will be signed out.`}
          </p>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            That link has expired, has been used already, or was never valid. Ask for a new one and
            it will arrive by email.
          </p>
          <p className="mt-6 text-sm">
            <Link href="/forgot-password" className="text-accent underline underline-offset-2">
              Send me a new link
            </Link>
          </p>
        </>
      )}

      <p className="mt-6 text-sm text-muted">
        <Link href="/login" className="text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </PublicFrame>
  );
}
