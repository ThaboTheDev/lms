import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { parsePaging } from '@/lib/http';
import { auditActivity, queryAuditLog } from '@/server/services/audit-log';
import { describeAction, describeChanges } from '@/server/services/audit-view';
import { Button, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/navigation';

export const metadata: Metadata = { title: 'Audit log' };

const ENTITY_TYPES = [
  'Submission', 'Assessment', 'StudentProfile', 'Certificate', 'Invoice',
  'Payment', 'ProofOfPayment', 'ProgressionDecision', 'CourseOffering', 'User',
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 100);

  const [{ total, entries }, activity] = await Promise.all([
    queryAuditLog(
      principal,
      {
        query: params.q?.trim(),
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        sensitiveOnly: params.sensitive === 'on',
        from: params.from ? new Date(params.from) : undefined,
        to: params.to ? new Date(params.to) : undefined,
      },
      { skip, perPage },
    ),
    auditActivity(principal),
  ]);

  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/admin/audit?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Every administrative action, with what changed. Credentials, identity numbers and session
          tokens are redacted before anything is written here.
        </p>
      </div>

      <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
        {[
          { label: `Entries in ${activity.days} days`, value: activity.total.toLocaleString('en-ZA') },
          { label: 'People acting', value: String(activity.actors) },
          { label: 'Commonest action', value: activity.actions[0]?.label ?? 'none' },
        ].map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-4">
            <p className="text-sm text-muted">{metric.label}</p>
            <p className="mt-1 font-serif text-xl font-semibold">{metric.value}</p>
          </div>
        ))}
      </div>

      {activity.actions.length > 0 && (
        <Panel title="What has been happening" description={`Last ${activity.days} days.`}>
          <ul className="divide-y divide-line">
            {activity.actions.map((entry) => (
              <li key={entry.action} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <Link
                  href={`/admin/audit?action=${encodeURIComponent(entry.action)}`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {entry.label}
                </Link>
                <span className="tabular-nums text-muted">{entry.count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Entries" description={`${total.toLocaleString('en-ZA')} matching`}>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" role="search">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="q" className="sr-only">Search by the email address of whoever acted</label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Who acted, by email address"
              className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="entityType" className="sr-only">Record type</label>
            <Select id="entityType" name="entityType" defaultValue={params.entityType ?? ''} className="h-9 w-48">
              <option value="">Any record</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>{type.replace(/([A-Z])/g, ' $1').trim()}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs text-muted">From</label>
            <input id="from" name="from" type="date" defaultValue={params.from ?? ''} className="h-9 rounded border border-line bg-paper px-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs text-muted">to</label>
            <input id="to" name="to" type="date" defaultValue={params.to ?? ''} className="h-9 rounded border border-line bg-paper px-2 text-sm" />
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name="sensitive"
              defaultChecked={params.sensitive === 'on'}
              className="accent-[rgb(var(--brand))]"
            />
            Results, money and credentials only
          </label>
          <Button type="submit" variant="secondary" size="sm">Filter</Button>
        </form>

        {entries.length === 0 ? (
          <EmptyState title="Nothing matches" hint="Widen the dates, or clear the filters." />
        ) : (
          <ol className="divide-y divide-line">
            {entries.map((entry) => {
              const changes = describeChanges(entry.before, entry.after);
              return (
                <li key={entry.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p>{describeAction(entry)}</p>
                    <span className="text-xs tabular-nums text-muted">
                      {entry.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-muted">
                    {entry.entityType}
                    {entry.entityId && (
                      <>
                        {' · '}
                        <Link
                          href={`/admin/audit?entityType=${entry.entityType}&entityId=${entry.entityId}`}
                          className="underline underline-offset-2"
                        >
                          everything about this record
                        </Link>
                      </>
                    )}
                  </p>

                  {changes.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {changes.slice(0, 6).map((change) => (
                        <li key={change.field} className="text-xs">
                          <span className="text-muted">{change.field}:</span> {change.from}{' '}
                          <span aria-hidden>to</span> {change.to}
                        </li>
                      ))}
                      {changes.length > 6 && (
                        <li className="text-xs text-muted">and {changes.length - 6} more fields</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / perPage))} buildHref={buildHref} />
      </Panel>
    </div>
  );
}
