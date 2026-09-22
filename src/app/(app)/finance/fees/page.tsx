import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listFees } from '@/server/services/finance';
import { formatMoney, toCents } from '@/lib/money';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NewFeeForm } from './fee-form';

export const metadata: Metadata = { title: 'Fees' };

export default async function FeesPage() {
  const principal = await requirePrincipal();
  const fees = await listFees(principal);

  const [programmes, years] = can(principal, 'finance.manage')
    ? await Promise.all([
        prisma.programme.findMany({
          where: { institutionId: principal.institutionId ?? undefined, isActive: true },
          select: { id: true, code: true, title: true },
          orderBy: { code: 'asc' },
        }),
        prisma.academicYear.findMany({
          where: { institutionId: principal.institutionId ?? undefined },
          select: { id: true, label: true },
          orderBy: { year: 'desc' },
        }),
      ])
    : [[], []];

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Finance', href: '/finance' }, { label: 'Fees' }]} />

      <div>
        <h1 className="font-serif text-2xl font-semibold">Fee structure</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          What the institution charges, by programme and by year. Invoices are raised from these
          figures rather than from whatever somebody remembers.
        </p>
      </div>

      <Panel title="Fees" description={`${fees.length} on the book`}>
        {fees.length === 0 ? (
          <EmptyState title="No fees set" hint="Add your tuition and registration fees to start." />
        ) : (
          <DataTable caption="Fee structure" head={['Name', 'Type', 'Programme', 'Year', 'Amount', 'Status']}>
            {fees.map((fee) => (
              <tr key={fee.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{fee.name}</td>
                <td className="px-4 py-2.5 text-muted">{fee.feeType.toLowerCase()}</td>
                <td className="px-4 py-2.5 text-muted">{fee.programme?.code ?? fee.course?.code ?? 'Any'}</td>
                <td className="px-4 py-2.5 text-muted">{fee.academicYear?.label ?? 'Any'}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatMoney(toCents(String(fee.amount)))}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={fee.isActive ? 'active' : 'neutral'}>{fee.isActive ? 'active' : 'retired'}</Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {can(principal, 'finance.manage') && (
        <NewFeeForm
          programmes={programmes.map((programme) => ({
            id: programme.id,
            label: `${programme.code} · ${programme.title}`,
          }))}
          years={years}
        />
      )}
    </div>
  );
}
