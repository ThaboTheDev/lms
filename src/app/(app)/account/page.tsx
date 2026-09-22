import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadAccount } from '@/server/services/finance';
import { formatMoney, toCents } from '@/lib/money';
import { POP_STATUS_LABELS, type PopStatus } from '@/server/services/pop-workflow';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { ProofOfPaymentForm } from './proof-form';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountPage() {
  const principal = await requirePrincipal();

  if (!principal.studentId) {
    return (
      <Panel title="Your account">
        <EmptyState
          title="No learner account"
          hint="Staff accounts do not carry fees. Open Finance to work with learner accounts."
        />
      </Panel>
    );
  }

  const account = await loadAccount(principal, principal.studentId);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Your account</h1>
          <p className="mt-1 text-sm text-muted">{account.student.studentNumber}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted">Outstanding</p>
          <p className="font-serif text-2xl font-semibold tabular-nums">
            {formatMoney(account.outstanding)}
          </p>
        </div>
      </div>

      <Panel title="Invoices">
        {account.invoices.length === 0 ? (
          <EmptyState title="Nothing billed" hint="Invoices appear here as they are raised." />
        ) : (
          <DataTable caption="Your invoices" head={['Number', 'Issued', 'Due', 'Total', 'Outstanding', 'Status']}>
            {account.invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  <Link href={`/finance/invoices/${invoice.id}`} className="text-accent underline-offset-2 hover:underline">
                    {invoice.number}
                  </Link>
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
                  <Tag tone={invoice.status === 'PAID' ? 'active' : invoice.status === 'OVERDUE' ? 'danger' : 'caution'}>
                    {invoice.status.toLowerCase().replace(/_/g, ' ')}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Payments received">
        {account.payments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing has been received yet.</p>
        ) : (
          <DataTable caption="Your payments" head={['Date', 'Amount', 'How', 'Reference', 'Receipt']}>
            {account.payments.map((payment) => (
              <tr key={payment.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  {payment.paidOn.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(payment.amount)))}</td>
                <td className="px-4 py-2.5 text-muted">{payment.method.toLowerCase().replace(/_/g, ' ')}</td>
                <td className="px-4 py-2.5 text-muted">{payment.reference ?? '-'}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{payment.receipt?.number ?? 'pending'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title="Proof of payment you have sent">
        {account.pops.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {account.pops.map((pop) => (
              <li key={pop.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="tabular-nums">{formatMoney(toCents(String(pop.declaredAmount)))}</p>
                  <p className="text-xs text-muted">
                    paid {pop.declaredDate.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}, sent{' '}
                    {pop.submittedAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                  </p>
                  {pop.reviewNotes && <p className="mt-1 text-muted">{pop.reviewNotes}</p>}
                </div>
                <Tag tone={pop.status === 'APPROVED' ? 'active' : pop.status === 'REJECTED' ? 'danger' : 'caution'}>
                  {POP_STATUS_LABELS[pop.status as PopStatus]}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ProofOfPaymentForm
        invoices={account.invoices
          .filter((invoice) => toCents(String(invoice.balance)) > 0)
          .map((invoice) => ({
            id: invoice.id,
            label: `${invoice.number} · ${formatMoney(toCents(String(invoice.balance)))} outstanding`,
          }))}
      />
    </div>
  );
}
