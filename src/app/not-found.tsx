import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-prose flex-col justify-center px-6">
      <h1 className="font-serif text-3xl font-semibold">That page is not here</h1>
      <p className="mt-2 text-muted">
        The link may be out of date, or the record may have been moved or archived.
      </p>
      <Link href="/dashboard" className="mt-6 text-accent underline underline-offset-2">
        Return to your dashboard
      </Link>
    </main>
  );
}
