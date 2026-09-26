import Link from 'next/link';
import { PublicFrame } from '@/components/brand/public-frame';

/** Rendered, with status 403, when a permission check refuses a page. */
export default function Forbidden() {
  return (
    <PublicFrame center>
      <h1 className="font-serif text-3xl font-semibold">You do not have access to this page</h1>
      <p className="mt-2 text-muted">
        Your account does not include the permission this page needs. If you think it should, ask
        an administrator at your institution.
      </p>
      <Link href="/dashboard" className="mt-6 text-accent underline underline-offset-2">
        Return to your dashboard
      </Link>
    </PublicFrame>
  );
}
