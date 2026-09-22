import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Verify a certificate',
  robots: { index: true, follow: true },
};

async function lookup(formData: FormData) {
  'use server';
  const code = String(formData.get('code') ?? '').trim();
  redirect(`/verify/${encodeURIComponent(code)}`);
}

export default function VerifyIndexPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-serif text-3xl font-semibold">Verify a certificate</h1>
      <p className="mt-3 text-muted">
        Enter the verification code printed on the certificate. You will see what was awarded, to
        whom, by which institution and when, and whether it is still valid. Nothing else about the
        person is shown.
      </p>

      <form action={lookup} className="mt-8 space-y-3">
        <label htmlFor="code" className="block text-sm font-medium">
          Verification code
        </label>
        <input
          id="code"
          name="code"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCD-1234-EFGH"
          className="h-12 w-full rounded border border-line bg-surface px-3 font-serif text-lg tabular-nums tracking-wide"
        />
        <p className="text-sm text-muted">
          Hyphens and capitals do not matter.
        </p>
        <Button type="submit">Check this certificate</Button>
      </form>
    </main>
  );
}
