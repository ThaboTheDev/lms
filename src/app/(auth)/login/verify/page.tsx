import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth/session';
import { PublicFrame } from '@/components/brand/public-frame';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Confirm it is you' };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await readSession();
  if (!session) redirect('/login');
  if (!session.user.mfaEnabled || session.mfaVerified) redirect('/dashboard');

  const { next } = await searchParams;

  return (
    <PublicFrame width="md" center>
      <h1 className="font-serif text-2xl font-semibold">Confirm it is you</h1>
      <p className="mt-2 text-sm text-muted">
        Enter the six digit code from your authenticator app. If you have lost your phone, one of
        your recovery codes works here instead.
      </p>

      <VerifyForm next={next ?? '/dashboard'} />
    </PublicFrame>
  );
}
