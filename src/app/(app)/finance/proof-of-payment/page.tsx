import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { parsePaging } from '@/lib/http';
import { listProofsOfPayment } from '@/server/services/proof-of-payment';
import { POP_STATUS_LABELS, type PopStatus } from '@/server/services/pop-workflow';
import { formatMoney, toCents } from '@/lib/money';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/navigation';
import { takeNextPop } from '../actions';

export const metadata: Metadata = { title: 'Proof of payment' };

const tone: Record<string, 'active' | 'caution' | 'danger' | 'neutral'> = {
  APPROVED: 'active',
  PENDING: 'caution',
  UNDER_REVIEW: 'caution',
  NEEDS_CLARIFICATION: 'caution',
  REJECTED: 'danger',
  DUPLICATE: 'neutral',
};

export default async function ProofOfPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 100);

  const [{ total, items, counts }, programmes] = await Promise.all([
    listProofsOfPayment(
      principal,
      {
        query: params.q?.trim(),
        status: params.status,
        programmeId: params.programme,
        from: params.from ? new Date(params.from) : undefined,
        to: params.to ? new Date(params.to) : undefined,
      },
      { skip, perPage },
    ),
    prisma.programme.findMany({
      where: { institutionId: principal.institutionId ?? undefined },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/finance/proof-of-payment?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Proof of payment</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            The queue is worked oldest first. Approving creates the payment and issues a receipt;
            nothing is credited before a person has looked at the document.
          </p>
        </div>
        <form action={takeNextPop}>
          <Button type="submit">Take the next one</Button>
        </form>
      </div>

      <ol className="grid gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(POP_STATUS_LABELS) as PopStatus[]).map((status) => (
          <li key={status} className="bg-surface px-3 py-3">
            <Link href={`/finance/proof-of-payment?status=${status}`} className="block">
              <span className="block text-xs text-muted">{POP_STATUS_LABELS[status]}</span>
              <span className="mt-0.5 block font-serif text-2xl font-semibold tabular-nums">
                {counts.find((row) => row.status === status)?.count ?? 0}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <Panel
        title={params.status ? POP_STATUS_LABELS[params.status as PopStatus] : 'Awaiting review'}
        description={`${total} documents`}
        action={
          params.status ? (
            <Link href="/finance/proof-of-payment" className="text-sm text-accent underline underline-offset-2">
              Show the open queue
            </Link>
          ) : undefined
        }
      >
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" role="search">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="q" className="sr-only">Search by reference, name or student number</label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Bank reference, name or student number"
              className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="programme" className="sr-only">Programme</label>
            <Select id="programme" name="programme" defaultValue={params.programme ?? ''} className="h-9 w-40">
              <option value="">All programmes</option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>{programme.code}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs text-muted">Submitted from</label>
            <input id="from" name="from" type="date" defaultValue={params.from ?? ''} className="h-9 rounded border border-line bg-paper px-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs text-muted">to</label>
            <input id="to" name="to" type="date" defaultValue={params.to ?? ''} className="h-9 rounded border border-line bg-paper px-2 text-sm" />
          </div>
          <Button type="submit" variant="secondary" size="sm">Filter</Button>
        </form>

        {items.length === 0 ? (
          <EmptyState
            title="The queue is clear"
            hint="Documents appear here as learners upload them."
          />
        ) : (
          <DataTable
            caption="Proof of payment queue"
            head={['Learner', 'Programme', 'Amount', 'Paid on', 'Reference', 'Submitted', 'Reviewer', 'Status']}
          >
            {items.map((item) => (
              <tr key={item.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/finance/proof-of-payment/${item.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {item.student.user.lastName}, {item.student.user.firstName}
                  </Link>
                  <span className="block text-xs tabular-nums text-muted">{item.student.studentNumber}</span>
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {item.student.programmeEnrolments[0]?.programme.code ?? '-'}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {formatMoney(toCents(String(item.declaredAmount)))}
                  {item.invoice && (
                    <span className="block text-xs text-muted">against {item.invoice.number}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {item.declaredDate.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                </td>
                <td className="px-4 py-2.5 text-muted">{item.reference ?? 'none given'}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {item.submittedAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {item.reviewer ? `${item.reviewer.firstName} ${item.reviewer.lastName}` : 'unassigned'}
                </td>
                <td className="px-4 py-2.5">
                  <Tag tone={tone[item.status] ?? 'neutral'}>
                    {POP_STATUS_LABELS[item.status as PopStatus]}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / perPage))} buildHref={buildHref} />
      </Panel>
    </div>
  );
}
