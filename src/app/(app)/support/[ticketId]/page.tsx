import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { getTicket } from '@/server/services/support';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ReplyForm, TicketAdminForm } from '../ticket-forms';

export const metadata: Metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const principal = await requirePrincipal();
  const { ticketId } = await params;
  const { ticket, seesQueue } = await getTicket(principal, ticketId);

  const staff = seesQueue
    ? await prisma.user.findMany({
        where: { institutionId: ticket.institutionId, status: 'ACTIVE', deletedAt: null },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 200,
        select: { id: true, firstName: true, lastName: true },
      })
    : [];

  const overdue = ticket.slaDueAt && ticket.slaDueAt < new Date() && !ticket.closedAt && !ticket.resolvedAt;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Support', href: '/support' },
          { label: ticket.number },
        ]}
      />

      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-2xl font-semibold">{ticket.subject}</h1>
            <p className="mt-1 text-sm text-muted">
              {ticket.number} · raised by {ticket.requester.firstName} {ticket.requester.lastName} on{' '}
              {ticket.createdAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={ticket.status === 'CLOSED' ? 'neutral' : ticket.status === 'RESOLVED' ? 'active' : 'caution'}>
              {ticket.status.toLowerCase().replace(/_/g, ' ')}
            </Tag>
            <Tag tone={ticket.priority === 'URGENT' ? 'danger' : ticket.priority === 'HIGH' ? 'caution' : 'neutral'}>
              {ticket.priority.toLowerCase()}
            </Tag>
          </div>
        </div>
      </div>

      <Panel title="What was reported">
        <p className="whitespace-pre-line px-4 py-4 text-sm leading-relaxed">{ticket.description}</p>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Category {ticket.category.toLowerCase()}
          {ticket.assignee
            ? ` · handled by ${ticket.assignee.firstName} ${ticket.assignee.lastName}`
            : ' · nobody has picked this up yet'}
          {ticket.slaDueAt
            ? ` · ${
                overdue
                  ? `answer was due ${ticket.slaDueAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}`
                  : `due by ${ticket.slaDueAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}`
              }`
            : ''}
        </p>
      </Panel>

      <Panel title="The thread">
        {ticket.messages.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">Nobody has replied yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {ticket.messages
              .filter((message) => seesQueue || !message.isInternalNote)
              .map((message) => (
                <li key={message.id} className="px-4 py-4">
                  <p className="text-xs text-muted">
                    {message.author.firstName} {message.author.lastName} ·{' '}
                    {message.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                    {message.isInternalNote && ' · internal note'}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{message.body}</p>
                </li>
              ))}
          </ol>
        )}
      </Panel>

      {ticket.status !== 'CLOSED' && <ReplyForm ticketId={ticket.id} canNote={seesQueue} />}

      {seesQueue && (
        <TicketAdminForm
          ticketId={ticket.id}
          status={ticket.status}
          assigneeId={ticket.assigneeId}
          staff={staff.map((person) => ({
            id: person.id,
            label: `${person.lastName}, ${person.firstName}`,
          }))}
        />
      )}
    </div>
  );
}
