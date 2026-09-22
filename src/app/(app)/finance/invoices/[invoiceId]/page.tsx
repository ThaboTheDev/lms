import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { loadInvoice } from '@/server/services/finance';
import { formatMoney, toCents } from '@/lib/money';
import { DataTable, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { CapturePaymentForm, PaymentPlanForm } from '../../finance-forms';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const principal = await requirePrincipal();
  const { invoiceId } = await params;
  const { invoice, arrears } = await loadInvoice(principal, invoiceId);

  const balance = toCents(String(invoice.balance));
  const canManage = can(principal, 'finance.manage', { institutionId: invoice.institutionId });
  const plan = invoice.plans[0];

  return (
    <div className="max-w-4xl space-y-6">
      <Breadcrumbs trail={[{ label: 'Finance', href: '/finance' }, { label: invoice.number }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Invoice {invoice.number}</h1>
          <p className="mt-1 text-sm text-muted">
            {invoice.student.user.firstName} {invoice.student.user.lastName} ·{' '}
            {invoice.student.studentNumber}
          </p>
        </div>
        <div className="text-right">
          <p className="font-serif text-2xl font-semibold tabular-nums">{formatMoney(balance)}</p>
          <Tag tone={balance <= 0 ? 'active' : invoice.status === 'OVERDUE' ? 'danger' : 'caution'}>
            {invoice.status.toLowerCase().replace(/_/g, ' ')}
          </Tag>
        </div>
      </div>

      <Panel title="Charges">
        <DataTable caption="Invoice lines" head={['Description', 'Type', 'Quantity', 'Each', 'Total']}>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">{line.description}</td>
              <td className="px-4 py-2.5 text-muted">{line.feeType.toLowerCase()}</td>
              <td className="px-4 py-2.5 tabular-nums">{line.quantity}</td>
              <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(line.unitAmount)))}</td>
              <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(line.lineTotal)))}</td>
            </tr>
          ))}
        </DataTable>

        <DescriptionList
          items={[
            { term: 'Subtotal', value: formatMoney(toCents(String(invoice.subtotal))) },
            { term: 'Discount', value: formatMoney(toCents(String(invoice.discountTotal))) },
            { term: 'Total', value: formatMoney(toCents(String(invoice.total))) },
            { term: 'Outstanding', value: formatMoney(balance) },
            { term: 'Issued', value: invoice.issuedOn.toLocaleDateString('en-ZA', { dateStyle: 'long' }) },
            { term: 'Due', value: invoice.dueOn?.toLocaleDateString('en-ZA', { dateStyle: 'long' }) ?? 'On receipt' },
          ]}
        />

        {invoice.notes && <p className="border-t border-line px-4 py-3 text-sm text-muted">{invoice.notes}</p>}
      </Panel>

      <Panel title="Payments" description={`${invoice.payments.length} recorded`}>
        {invoice.payments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing has been received against this invoice.</p>
        ) : (
          <DataTable caption="Payments" head={['Date', 'Amount', 'Method', 'Reference', 'Receipt']}>
            {invoice.payments.map((payment) => (
              <tr key={payment.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  {payment.paidOn.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(payment.amount)))}</td>
                <td className="px-4 py-2.5 text-muted">{payment.method.toLowerCase().replace(/_/g, ' ')}</td>
                <td className="px-4 py-2.5 text-muted">{payment.reference ?? '-'}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{payment.receipt?.number ?? '-'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {invoice.pops.length > 0 && (
        <Panel title="Proof of payment" description="Documents the learner has sent against this invoice.">
          <ul className="divide-y divide-line">
            {invoice.pops.map((pop) => (
              <li key={pop.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  <Link href={`/finance/proof-of-payment/${pop.id}`} className="text-accent underline-offset-2 hover:underline">
                    {formatMoney(toCents(String(pop.declaredAmount)))}
                  </Link>
                  <span className="block text-xs text-muted">
                    paid {pop.declaredDate.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}, sent{' '}
                    {pop.submittedAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                  </span>
                </span>
                <Tag tone={pop.status === 'APPROVED' ? 'active' : pop.status === 'REJECTED' ? 'danger' : 'caution'}>
                  {pop.status.toLowerCase().replace(/_/g, ' ')}
                </Tag>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {plan && (
        <Panel
          title={plan.name}
          description={
            arrears && arrears.overdueAmount > 0
              ? `${formatMoney(arrears.overdueAmount)} overdue across ${arrears.overdueCount} instalments.`
              : arrears?.nextDueOn
                ? `Next instalment of ${formatMoney(arrears.nextAmount)} on ${arrears.nextDueOn.toLocaleDateString('en-ZA', { dateStyle: 'long' })}.`
                : undefined
          }
        >
          <DataTable caption="Instalments" head={['Due', 'Amount', 'Paid', 'Status']}>
            {plan.instalmentList.map((instalment) => (
              <tr key={instalment.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  {instalment.dueOn.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(instalment.amount)))}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {formatMoney(toCents(String(instalment.paidAmount)))}
                </td>
                <td className="px-4 py-2.5">
                  <Tag tone={instalment.status === 'PAID' ? 'active' : instalment.status === 'OVERDUE' ? 'danger' : 'neutral'}>
                    {instalment.status.toLowerCase()}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}

      {canManage && balance > 0 && (
        <>
          <CapturePaymentForm
            studentId={invoice.student.id}
            invoiceId={invoiceId}
            balance={Number(invoice.balance)}
          />
          {!plan && <PaymentPlanForm studentId={invoice.student.id} invoiceId={invoiceId} />}
        </>
      )}
    </div>
  );
}
