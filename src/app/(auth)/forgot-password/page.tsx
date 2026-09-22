import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { ForgotPasswordForm } from './forgot-form';

export const metadata: Metadata = { title: 'Forgotten password' };

export default async function ForgotPasswordPage() {
  // Somebody who is already signed in changes a password from the security
  // screen, where the change is authenticated and audited.
  const principal = await getCurrentPrincipal();
  if (principal) redirect('/security');

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="font-serif text-2xl font-semibold">Forgotten your password?</h1>
      <p className="mt-2 text-sm text-muted">
        Enter the address your account uses and we will email you a link to choose a new one. The
        link works once and expires after an hour.
      </p>

      <ForgotPasswordForm />

      <p className="mt-6 text-sm text-muted">
        Remembered it?{' '}
        <Link href="/login" className="text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
