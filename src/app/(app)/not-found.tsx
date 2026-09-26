import Link from 'next/link';
import { Panel } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <Panel title="That page is not here">
      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="max-w-prose text-muted">
          The link may be out of date, or the record may have been moved, archived or never existed.
        </p>
        <Link href="/dashboard" className="text-accent underline underline-offset-2">
          Return to your dashboard
        </Link>
      </div>
    </Panel>
  );
}
