import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { openReports } from '@/server/services/forums';
import { ActionButton } from '@/components/ui/action-form';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { resolveReportAction } from '../actions';

export const metadata: Metadata = { title: 'Reported posts' };

export default async function ReportsPage() {
  const principal = await requirePrincipal();
  const reports = await openReports(principal);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Discussions', href: '/discussions' }, { label: 'Reported posts' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Reported posts</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          A report never removes a post by itself. Hiding leaves a visible gap in the thread; dismissing keeps the post. Oldest first.
        </p>
      </div>
      <Panel title="Waiting for a decision" description={`${reports.length} open`}>
        {reports.length === 0 ? (
          <EmptyState title="Nothing reported" hint="Reports from learners and staff appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {reports.map((report) => (
              <li key={report.id} className="space-y-2 px-4 py-3 text-sm">
                <p>
                  <Link href={`/discussions/${report.post.thread.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {report.post.thread.title}
                  </Link>
                  <span className="text-muted"> · {report.post.author.firstName} {report.post.author.lastName}{report.post.isHidden ? ' · already hidden' : ''}</span>
                </p>
                <blockquote className="border-l-2 border-line pl-3 text-muted">{report.post.body.slice(0, 400)}</blockquote>
                <p><span className="font-medium">Reason:</span> {report.reason}</p>
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={resolveReportAction} hidden={{ reportId: report.id, outcome: 'hide' }} label="Hide the post" variant="danger" />
                  <ActionButton action={resolveReportAction} hidden={{ reportId: report.id, outcome: 'dismiss' }} label="Dismiss the report" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
