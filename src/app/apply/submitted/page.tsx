import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Application sent' };

export default async function SubmittedPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;

  return (
    <main className="mx-auto max-w-prose px-6 py-16">
      <h1 className="font-serif text-3xl font-semibold">Your application is with us</h1>
      <p className="mt-3 text-muted">
        Keep this reference number. Quote it in any email or phone call about your application.
      </p>
      <p className="mt-6 border-l-2 border-brand bg-brand/5 px-4 py-3 font-serif text-2xl tabular-nums">
        {reference ?? 'Reference not available'}
      </p>
      <h2 className="mt-8 font-serif text-lg font-semibold">What happens next</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
        <li>Admissions checks your application against the entry requirements.</li>
        <li>If anything is missing, we email you to ask for it.</li>
        <li>You receive the outcome by email.</li>
        <li>If you are offered a place and accept it, we enrol you and issue a student number.</li>
      </ol>
      <Link href="/apply" className="mt-8 inline-block text-accent underline underline-offset-2">
        Send another application
      </Link>
    </main>
  );
}
