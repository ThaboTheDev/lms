import Link from 'next/link';
import { PublicFrame } from '@/components/brand/public-frame';

export default function NotFound() {
  return (
    <PublicFrame center>
      <h1 className="font-serif text-3xl font-semibold">That page is not here</h1>
      <p className="mt-2 text-muted">
        The link may be out of date, or the record may have been moved or archived.
      </p>
      <Link href="/dashboard" className="mt-6 text-accent underline underline-offset-2">
        Return to your dashboard
      </Link>
    </PublicFrame>
  );
}
