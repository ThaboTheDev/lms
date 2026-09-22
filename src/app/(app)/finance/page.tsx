import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { parsePaging } from '@/lib/http';
import { financeOverview, listInvoices } from '@/server/services/finance';
import { formatMoney, toCents } from '@/lib/money';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/navigation';
import { NewInvoiceForm } from './finance-forms';

export const metadata: Metadata = { title: 'Finance' };

const statusTone: Record<string, 'active' | 'caution' | 'danger' | 'neutral'> = {
  PAID: 'active',
  ISSUED: 'neutral',
  PARTIALLY_PAID: 'caution',
  OVERDUE: 'danger',
  DRAFT: 'neutral',
  CANCELLED: 'neutral',
  WRITTEN_OFF: 'neutral',
};

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 50);

  const [overview, { total, invoices }, students] = await Promise.all([
    financeOverview(principal),
    listInvoices(principal, { query: params.q?.trim(), status: params.status }, { skip, perPage }),
    can(principal, 'finance.manage')
      ? prisma.studentProfile.findMany({
          where: { institutionId: principal.institutionId ?? undefined },
          orderBy: { studentNumber: 'asc' },
          take: 500,
          select: {
            id: true,
            studentNumber: true,
            user: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/finance?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Finance</h1>
          <p className="mt-1 text-sm text-muted">Fees, invoices, payments and what is outstanding.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/finance/proof-of-payment">
            <Button variant="secondary">
              Proof of payment
              {overview.pendingPops > 0 ? ` (${overview.pendingPops})` : ''}
            </Button>
          </Link>
          <Link href="/finance/fees">
            <Button variant="secondary">Fees</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
        {[
          { label: 'Collected', value: formatMoney(overview.collectedCents), sub: `${overview.paymentCount} payments` },
          { label: 'Outstanding', value: formatMoney(overview.outstandingCents), sub: 'across issued invoices' },
          { label: 'Awaiting review', value: String(overview.pendingPops), sub: 'proof of payment documents' },
        ].map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-5">
            <p className="text-sm text-muted">{metric.label}</p>
            <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{metric.value}</p>
            <p className="text-xs text-muted">{metric.sub}</p>
          </div>
        ))}
      </div>

      <Panel title="Ageing" description="Every outstanding balance, by how long it has been owing.">
        <DataTable caption="Debtors ageing" head={['Period', 'Invoices', 'Amount']}>
          {overview.ageing.map((bucket) => (
            <tr key={bucket.label} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">{bucket.label}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted">{bucket.count}</td>
              <td className="px-4 py-2.5 tabular-nums">{formatMoney(bucket.amount)}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Panel title="Invoices" description={`${total} on record`}>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" role="search">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="q" className="sr-only">Search by invoice number, name or student number</label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Invoice number, name or student number"
              className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="status" className="sr-only">Status</label>
            <Select id="status" name="status" defaultValue={params.status ?? ''} className="h-9 w-44">
              <option value="">Any status</option>
              <option value="ISSUED">Issued</option>
              <option value="PARTIALLY_PAID">Partly paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="PAID">Paid</option>
              <option value="DRAFT">Draft</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>

        {invoices.length === 0 ? (
          <EmptyState title="No invoices" hint="Raise one below, or import your fee book." />
        ) : (
          <DataTable
            caption="Invoices"
            head={['Number', 'Learner', 'Issued', 'Due', 'Total', 'Balance', 'Status']}
          >
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  <Link
                    href={`/finance/invoices/${invoice.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {invoice.number}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {invoice.student.user.lastName}, {invoice.student.user.firstName}
                  <span className="block text-xs tabular-nums text-muted">{invoice.student.studentNumber}</span>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {invoice.issuedOn.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {invoice.dueOn?.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) ?? '-'}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(invoice.total)))}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(invoice.balance)))}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={statusTone[invoice.status] ?? 'neutral'}>
                    {invoice.status.toLowerCase().replace(/_/g, ' ')}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / perPage))} buildHref={buildHref} />
      </Panel>

      {can(principal, 'finance.manage') && (
        <NewInvoiceForm
          students={students.map((student) => ({
            id: student.id,
            label: `${student.studentNumber} · ${student.user.lastName}, ${student.user.firstName}`,
          }))}
        />
      )}
    </div>
  );
}
