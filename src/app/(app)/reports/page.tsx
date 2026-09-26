import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import {
  academicReport,
  deliveryReport,
  financeReport,
  headcountByCohort,
  headcountByProgramme,
} from '@/server/services/reporting';
import { formatMoney } from '@/lib/money';
import { DataTable, EmptyState, Panel } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { DescriptionList } from '@/components/ui/navigation';
import { Button } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const principal = await requirePrincipal();
  requirePermission(principal, 'report.read');

  const params = await searchParams;
  const years = await prisma.academicYear.findMany({
    where: { institutionId: principal.institutionId ?? undefined },
    select: { id: true, label: true, isCurrent: true },
    orderBy: { year: 'desc' },
  });

  const selected = params.year ?? years.find((year) => year.isCurrent)?.id ?? years[0]?.id;

  if (!selected) {
    return (
      <Panel title="Reports">
        <EmptyState title="No academic year has been set up" hint="Create an academic year to report on." />
      </Panel>
    );
  }

  const [programmes, cohorts, academics, delivery, finance] = await Promise.all([
    headcountByProgramme(principal, selected),
    headcountByCohort(principal, selected),
    academicReport(principal, selected),
    deliveryReport(principal),
    financeReport(principal),
  ]);

  const totals = programmes.reduce(
    (sum, row) => ({
      active: sum.active + row.active,
      completed: sum.completed + row.completed,
      withdrawn: sum.withdrawn + row.withdrawn,
    }),
    { active: 0, completed: 0, withdrawn: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-muted">Headcount as at today, drawn from live enrolment records.</p>
          <p className="mt-1 text-sm" data-print="hide">
            Download as CSV:{' '}
            {[
              ['summary', 'summary'],
              ['headcount', 'headcount'],
              ['cohorts', 'cohorts'],
              ['admissions', 'admissions'],
              ['distribution', 'mark distribution'],
            ].map(([report, label], index) => (
              <span key={report}>
                {index > 0 ? ' · ' : ''}
                <a href={`/api/v1/reports/${report}?year=${selected}`} className="text-accent underline underline-offset-2">{label}</a>
              </span>
            ))}
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div>
            <label htmlFor="year" className="block text-sm font-medium">
              Academic year
            </label>
            <Select id="year" name="year" defaultValue={selected} className="mt-1 h-9 w-56">
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Show
          </Button>
        </form>
      </div>

      <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
        {[
          { label: 'Actively enrolled', value: totals.active },
          { label: 'Completed', value: totals.completed },
          { label: 'Withdrawn or excluded', value: totals.withdrawn },
        ].map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-5">
            <p className="text-sm text-muted">{metric.label}</p>
            <p className="mt-1 font-serif text-3xl font-semibold tabular-nums">
              {metric.value.toLocaleString('en-ZA')}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Academic">
          <DescriptionList
            items={[
              { term: 'Assessments published', value: academics.assessmentsPublished },
              { term: 'Submissions marked', value: academics.submissionsMarked },
              {
                term: 'Pass rate',
                value:
                  academics.passRate !== null
                    ? `${academics.passRate}% of ${academics.coursesWithResults} resolved results`
                    : 'No resolved results yet',
              },
            ]}
          />
        </Panel>

        <Panel title="Delivery">
          <DescriptionList
            items={[
              { term: 'Courses running', value: delivery.offeringsRunning },
              { term: 'Lessons published', value: delivery.lessonsPublished },
              {
                term: 'Average course progress',
                value: delivery.averageCourseProgress !== null ? `${delivery.averageCourseProgress}%` : 'No data',
              },
              {
                term: 'Registers taken',
                value: `${delivery.attendanceMarkedSessions} of ${delivery.attendanceSessions}`,
              },
              { term: 'Lecturers teaching', value: delivery.activeLecturers },
            ]}
          />
        </Panel>

        <Panel title="Finance">
          <DescriptionList
            items={[
              { term: 'Billed', value: formatMoney(finance.billedCents) },
              { term: 'Collected', value: formatMoney(finance.collectedCents) },
              { term: 'Outstanding', value: formatMoney(finance.outstandingCents) },
              {
                term: 'Collection rate',
                value: finance.collectionRate !== null ? `${finance.collectionRate}%` : 'Nothing billed',
              },
              { term: 'Learners in arrears', value: finance.learnersInArrears },
            ]}
          />
        </Panel>
      </div>

      <Panel title="Mark distribution" description="Across every resolved course result.">
        <DataTable caption="Mark distribution" head={['Band', 'Results']}>
          {academics.distribution.map((band) => (
            <tr key={band.band} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">{band.band}</td>
              <td className="px-4 py-2.5 tabular-nums">{band.count}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Panel title="Headcount by programme">
        <DataTable
          caption="Enrolment headcount by programme"
          head={['Code', 'Programme', 'Qualification type', 'Active', 'Completed', 'Withdrawn']}
        >
          {programmes.map((row) => (
            <tr key={row.programmeId} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 font-medium">{row.programmeCode}</td>
              <td className="px-4 py-2.5">{row.programmeTitle}</td>
              <td className="px-4 py-2.5 text-muted">
                {row.qualificationType.toLowerCase().replace(/_/g, ' ')}
              </td>
              <td className="px-4 py-2.5 tabular-nums">{row.active}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted">{row.completed}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted">{row.withdrawn}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Panel title="Headcount by cohort" description="Useful for timetabling and venue planning.">
        {cohorts.length === 0 ? (
          <EmptyState title="No cohorts for this year" hint="Cohorts group an intake within a programme." />
        ) : (
          <DataTable caption="Headcount by cohort" head={['Cohort', 'Name', 'Programme', 'Learners']}>
            {cohorts.map((cohort) => (
              <tr key={cohort.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{cohort.code}</td>
                <td className="px-4 py-2.5">{cohort.name}</td>
                <td className="px-4 py-2.5 text-muted">{cohort.programmeCode}</td>
                <td className="px-4 py-2.5 tabular-nums">{cohort.learners}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
