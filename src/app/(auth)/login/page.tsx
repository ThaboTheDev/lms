import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { setupPending } from '@/server/services/setup';
import { BrandMark } from '@/components/brand/mark';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const points = [
  'Track academic progress',
  'Courses, assessments and records',
  'Messages from faculty and the registry',
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; setup?: string }>;
}) {
  let principal = null;
  let needsSetup = false;
  try {
    principal = await getCurrentPrincipal();
    // A fresh deployment has nobody who could sign in. Send the first visitor
    // to setup rather than to a form no account can pass.
    if (!principal) needsSetup = await setupPending(prisma);
  } catch {
    // The session store being unreachable must not hide the sign-in screen.
    principal = null;
    needsSetup = false;
  }
  if (principal) redirect('/dashboard');
  if (needsSetup) redirect('/setup');

  const { next, reset, setup } = await searchParams;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between bg-[linear-gradient(171deg,#0b113b_10%,#151e54_90%)] px-10 py-12 text-white lg:flex">
        <a href={BRAND.website} className="w-fit rounded-md">
          <BrandMark />
        </a>
        <div className="max-w-md">
          <p className="eyebrow eyebrow-on-navy">Est. {BRAND.established}</p>
          <h1 className="font-sans text-4xl font-bold leading-tight text-gold-bright">Student portal</h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300">{BRAND.tagline}</p>
          <ul className="mt-8 space-y-3 text-sm">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-3">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-bright" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-slate-300">
          {BRAND.name}. Protected system. Activity is logged.
        </p>
      </section>

      <section className="flex flex-col bg-surface">
        <div className="bg-navy px-6 py-4 lg:hidden">
          <BrandMark size="sm" />
          <div className="mt-4 h-0.5 w-16 bg-gold-bright" aria-hidden />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <p className="eyebrow">Student portal</p>
            <h2 className="font-sans text-3xl font-bold">Sign in</h2>
            <p className="mt-2 text-sm text-muted">
              Enter your credentials to access the {BRAND.shortName} learning platform.
            </p>
            {reset === '1' && (
              <p
                role="status"
                className="mt-4 border-l-2 border-gold-ink bg-gold/10 px-3 py-2 text-sm text-gold-ink"
              >
                Your password has been set. Sign in with it.
              </p>
            )}
            {setup === 'done' && (
              <p
                role="status"
                className="mt-4 border-l-2 border-gold-ink bg-gold/10 px-3 py-2 text-sm text-gold-ink"
              >
                Setup had already been completed, so nothing from that form was saved. Sign in with
                the administrator account that was created.
              </p>
            )}
            <LoginForm redirectTo={next} />
            <p className="mt-6 text-sm text-muted">
              Applying to study?{' '}
              <Link href="/apply" className="font-semibold text-accent underline underline-offset-2">
                Start an application
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
