import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const principal = await getCurrentPrincipal();
  if (principal) redirect('/dashboard');

  const { next, reset } = await searchParams;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-rail px-10 py-12 text-rail-ink lg:flex">
        <p className="font-serif text-lg">Institutional LMS</p>
        <div className="max-w-md">
          <h1 className="font-serif text-4xl font-semibold leading-tight">
            Teaching, records and administration in one place.
          </h1>
          <p className="mt-4 text-rail-ink/70">
            Enrolment through to certification, with the audit trail an academic
            institution has to keep.
          </p>
        </div>
        <p className="text-sm text-rail-muted">
          Protected system. Activity is logged.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="font-serif text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">
            Use the account issued by your institution.
          </p>
          {reset === '1' && (
            <p
              role="status"
              className="mt-3 border-l-2 border-brand bg-brand/5 px-3 py-2 text-sm text-brand"
            >
              Your password has been set. Sign in with it.
            </p>
          )}
          <LoginForm redirectTo={next} />
          <p className="mt-6 text-sm text-muted">
            Applying to study?{' '}
            <Link href="/apply" className="text-accent underline underline-offset-2">
              Start an application
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
