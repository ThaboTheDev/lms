import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { canAny, requireAnyPermission } from '@/lib/rbac/authorize';
import { SETUP_PERMISSIONS } from '@/server/services/academic-setup-rules';
import { ActionForm } from '@/components/ui/action-form';
import { DataTable, EmptyState, Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addCohort } from '../actions';

export const metadata: Metadata = { title: 'Cohorts' };

export default async function CohortsPage() {
  const principal = await requirePrincipal();
  requireAnyPermission(principal, [...SETUP_PERMISSIONS]);
  const institutionId = principal.institutionId ?? '';
  const edits = canAny(principal, ['programme.manage', 'enrolment.manage'], { institutionId });

  const [cohorts, programmes, years] = await Promise.all([
    prisma.cohort.findMany({
      where: { institutionId },
      orderBy: [{ academicYear: { year: 'desc' } }, { code: 'asc' }],
      include: { programme: { select: { code: true } }, academicYear: { select: { label: true } }, _count: { select: { enrolments: true } } },
    }),
    prisma.programme.findMany({ where: { institutionId, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, title: true } }),
    prisma.academicYear.findMany({ where: { institutionId }, orderBy: { year: 'desc' }, select: { id: true, label: true } }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Academic setup', href: '/admin/academic' }, { label: 'Cohorts' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Cohorts</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">Intake groups within a programme and year. Optional: registration works without them, and headcount reports group by them when they exist.</p>
      </div>
      <Panel title="Cohorts" description={`${cohorts.length} on record`}>
        {cohorts.length === 0 ? (
          <EmptyState title="No cohorts yet" hint="Add one when a programme takes more than one intake a year." />
        ) : (
          <DataTable caption="Cohorts" head={['Code', 'Name', 'Programme', 'Year', 'Learners']}>
            {cohorts.map((cohort) => (
              <tr key={cohort.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{cohort.code}</td>
                <td className="px-4 py-2.5">{cohort.name}</td>
                <td className="px-4 py-2.5 text-muted">{cohort.programme.code}</td>
                <td className="px-4 py-2.5 text-muted">{cohort.academicYear.label}</td>
                <td className="px-4 py-2.5 tabular-nums">{cohort._count.enrolments}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {edits && programmes.length > 0 && years.length > 0 && (
        <ActionForm
          title="Add a cohort"
          action={addCohort}
          submitLabel="Add cohort"
          fields={[
            { name: 'programmeId', label: 'Programme', type: 'select', required: true, options: programmes.map((programme) => ({ value: programme.id, label: `${programme.code} · ${programme.title}` })) },
            { name: 'academicYearId', label: 'Academic year', type: 'select', required: true, options: years.map((year) => ({ value: year.id, label: year.label })) },
            { name: 'code', label: 'Code', required: true, placeholder: 'HCBM-2027-A' },
            { name: 'name', label: 'Name', required: true, placeholder: 'Higher Certificate 2027 intake A' },
            { name: 'startsOn', label: 'Starts', type: 'date', hint: 'Optional' },
            { name: 'endsOn', label: 'Ends', type: 'date', hint: 'Optional' },
          ]}
        />
      )}
      {edits && (programmes.length === 0 || years.length === 0) && (
        <p className="text-sm text-muted">Add an academic year and a programme first; a cohort belongs to both.</p>
      )}
    </div>
  );
}
