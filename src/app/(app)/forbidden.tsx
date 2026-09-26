import Link from 'next/link';
import { Panel } from '@/components/ui/primitives';

/** Inside the signed-in shell: the navigation stays, so the person can go somewhere useful. */
export default function Forbidden() {
  return (
    <Panel title="You do not have access to this page">
      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="max-w-prose text-muted">
          Your account does not include the permission this page needs. If you think it should, ask
          an administrator at your institution to add it to one of your roles.
        </p>
        <Link href="/dashboard" className="text-accent underline underline-offset-2">
          Return to your dashboard
        </Link>
      </div>
    </Panel>
  );
}
