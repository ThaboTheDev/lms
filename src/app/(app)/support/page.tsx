import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listTickets, type TicketFilter } from '@/server/services/support';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { TabLinks } from '@/components/ui/navigation';
import { RaiseTicketForm } from './ticket-forms';

export const metadata: Metadata = { title: 'Support' };

const FILTERS: { key: TicketFilter | 'MINE'; label: string; href: string }[] = [
  { key: 'ALL', label: 'Everything', href: '/support' },
  { key: 'OPEN', label: 'Open', href: '/support?status=OPEN' },
  { key: 'RESOLVED', label: 'Resolved', href: '/support?status=RESOLVED' },
  { key: 'CLOSED', label: 'Closed', href: '/support?status=CLOSED' },
  { key: 'MINE', label: 'Raised by me', href: '/support?mine=1' },
];

const statusTone: Record<string, 'active' | 'caution' | 'danger' | 'neutral'> = {
  OPEN: 'caution',
  IN_PROGRESS: 'active',
  WAITING_ON_REQUESTER: 'neutral',
  RESOLVED: 'active',
  CLOSED: 'neutral',
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;

  const requested = params.mine === '1' ? 'MINE' : (params.status as TicketFilter | undefined) ?? 'ALL';
  const active = FILTERS.some((filter) => filter.key === requested) ? requested : 'ALL';

  const { tickets, seesQueue } = await listTickets(principal, {
    status: active === 'MINE' ? 'ALL' : active,
    mine: active === 'MINE',
  });

  const canRaise = can(principal, 'ticket.submit');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Support</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {seesQueue
            ? 'Every ticket raised at this institution, oldest urgency first.'
            : 'The tickets you have raised, and where each one stands.'}
        </p>
      </div>

      <TabLinks tabs={FILTERS} current={active} />

      <Panel>
        {tickets.length === 0 ? (
          <EmptyState
            title={active === 'MINE' ? 'You have not raised anything' : 'Nothing here'}
            hint={
              active === 'MINE'
                ? 'Anything you ask for help with appears in this list.'
                : 'Tickets raised by people at this institution appear here.'
            }
          />
        ) : (
          <DataTable
            caption="Support tickets"
            head={seesQueue ? ['Number', 'Subject', 'Raised by', 'Status', 'Priority', 'Due'] : ['Number', 'Subject', 'Status', 'Raised']}
          >
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums text-muted">{ticket.number}</td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/support/${ticket.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {ticket.subject}
                  </Link>
                </td>
                {seesQueue && (
                  <td className="px-4 py-2.5 text-muted">
                    {ticket.requester.firstName} {ticket.requester.lastName}
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <Tag tone={statusTone[ticket.status] ?? 'neutral'}>
                    {ticket.status.toLowerCase().replace(/_/g, ' ')}
                  </Tag>
                </td>
                {seesQueue ? (
                  <td className="px-4 py-2.5 text-muted">{ticket.priority.toLowerCase()}</td>
                ) : (
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {ticket.createdAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                  </td>
                )}
                {seesQueue && (
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {ticket.slaDueAt
                      ? ticket.slaDueAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })
                      : '-'}
                  </td>
                )}
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {canRaise && <RaiseTicketForm />}
    </div>
  );
}
