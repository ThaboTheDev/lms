import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { canAny, requireAnyPermission } from '@/lib/rbac/authorize';
import { SETUP_PERMISSIONS, TERM_TYPES } from '@/server/services/academic-setup-rules';
import { ActionButton, ActionForm } from '@/components/ui/action-form';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addAcademicYear, addTerm, makeTermCurrent, makeYearCurrent } from '../actions';

export const metadata: Metadata = { title: 'Academic calendar' };

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '-');
const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function CalendarSetupPage() {
  const principal = await requirePrincipal();
  requireAnyPermission(principal, [...SETUP_PERMISSIONS]);
  const edits = canAny(principal, ['programme.manage', 'settings.manage', 'enrolment.manage']);

  const years = await prisma.academicYear.findMany({
    where: { institutionId: principal.institutionId ?? '' },
    orderBy: { year: 'desc' },
    include: { terms: { orderBy: { startsOn: 'asc' } } },
  });
  const nextYear = (years[0]?.year ?? new Date().getFullYear()) + (years.length ? 1 : 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Academic setup', href: '/admin/academic' }, { label: 'Years and terms' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Years and terms</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Applications, registration, fees and course deliveries all point at a year or a term. Exactly one year and one term are current at a time.
        </p>
      </div>

      {years.length === 0 ? (
        <Panel><EmptyState title="No academic year yet" hint="Add the year below; the first one becomes current." /></Panel>
      ) : (
        years.map((year) => (
          <Panel key={year.id} title={year.label} description={`${day(year.startsOn)} to ${day(year.endsOn)}`}>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 text-sm">
              {year.isCurrent ? <Tag tone="active">current year</Tag> : edits && <ActionButton action={makeYearCurrent} hidden={{ academicYearId: year.id }} label="Make this the current year" />}
            </div>
            {year.terms.length === 0 ? (
              <EmptyState title="No terms in this year" hint="Add a semester, trimester or block below." />
            ) : (
              <DataTable caption={`Terms in ${year.label}`} head={['Code', 'Term', 'Type', 'Runs', 'Registration', '']}>
                {year.terms.map((term) => (
                  <tr key={term.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium">{term.code}</td>
                    <td className="px-4 py-2.5">{term.name}</td>
                    <td className="px-4 py-2.5 text-muted">{label(term.type)}</td>
                    <td className="px-4 py-2.5 text-muted">{day(term.startsOn)} to {day(term.endsOn)}</td>
                    <td className="px-4 py-2.5 text-muted">{term.registrationOpensOn ? `${day(term.registrationOpensOn)} to ${day(term.registrationClosesOn)}` : '-'}</td>
                    <td className="px-4 py-2.5">
                      {term.isCurrent ? <Tag tone="active">current</Tag> : edits && <ActionButton action={makeTermCurrent} hidden={{ termId: term.id }} label="Make current" />}
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        ))
      )}

      {edits && years.length > 0 && (
        <ActionForm
          title="Add a term"
          action={addTerm}
          submitLabel="Add term"
          columns={3}
          fields={[
            { name: 'academicYearId', label: 'Academic year', type: 'select', required: true, options: years.map((year) => ({ value: year.id, label: year.label })) },
            { name: 'code', label: 'Code', required: true, placeholder: 'S1', hint: 'Short, unique within the year' },
            { name: 'name', label: 'Name', required: true, placeholder: 'Semester 1' },
            { name: 'type', label: 'Type', type: 'select', defaultValue: 'SEMESTER', options: TERM_TYPES.map((value) => ({ value, label: label(value) })) },
            { name: 'startsOn', label: 'Starts', type: 'date', required: true },
            { name: 'endsOn', label: 'Ends', type: 'date', required: true },
            { name: 'registrationOpensOn', label: 'Registration opens', type: 'date', hint: 'Optional' },
            { name: 'registrationClosesOn', label: 'Registration closes', type: 'date', hint: 'Optional' },
            { name: 'isCurrent', label: 'This is the current term', type: 'checkbox' },
          ]}
        />
      )}

      {edits && (
        <ActionForm
          title="Add an academic year"
          action={addAcademicYear}
          submitLabel="Add year"
          columns={3}
          fields={[
            { name: 'year', label: 'Year', type: 'number', required: true, defaultValue: nextYear, min: 2000, max: 2100 },
            { name: 'label', label: 'Label', placeholder: `${nextYear} academic year`, hint: 'Optional' },
            { name: 'startsOn', label: 'First day', type: 'date', required: true },
            { name: 'endsOn', label: 'Last day', type: 'date', required: true },
            { name: 'isCurrent', label: 'This is the current year', type: 'checkbox', defaultValue: years.length === 0 },
          ]}
        />
      )}
    </div>
  );
}
