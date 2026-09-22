import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { attendanceReport } from '@/server/services/attendance';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NewSessionForm } from './attendance-forms';

export const metadata: Metadata = { title: 'Attendance' };

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const { offering, sessions, rows } = await attendanceReport(principal, offeringId);

  const canManage = can(principal, 'attendance.manage', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Attendance' },
        ]}
      />

      <div>
        <h1 className="font-serif text-2xl font-semibold">Attendance</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Excused absences are left out of the percentage rather than counted against the learner.
          Learners who have stopped coming are listed first, whatever their percentage says.
        </p>
      </div>

      <Panel title="Sessions" description={`${sessions.length} scheduled`}>
        {sessions.length === 0 ? (
          <EmptyState title="No sessions yet" hint="Add a session to take a register against it." />
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((session) => {
              const marked = session.records.filter((record) => record.status !== 'NOT_MARKED').length;
              return (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <Link
                      href={`/courses/${offeringId}/attendance/${session.id}`}
                      className="text-sm font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {session.title}
                    </Link>
                    <span className="block text-xs text-muted">
                      {session.scheduledStart.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                      {' · '}
                      {session.mode.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  </div>
                  <Tag tone={marked === 0 ? 'caution' : 'active'}>
                    {marked === 0 ? 'register not taken' : `${marked} of ${session._count.records} marked`}
                  </Tag>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="By learner" description={`${rows.length} enrolled`}>
        {rows.length === 0 ? (
          <EmptyState title="Nobody enrolled" hint="Register learners for this course first." />
        ) : (
          <DataTable
            caption="Attendance by learner"
            head={['Learner', 'Attended', 'Absent', 'Excused', 'Percentage', 'Pattern']}
          >
            {rows.map((row) => (
              <tr key={row.student.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/students/${row.student.id}`} className="text-accent underline-offset-2 hover:underline">
                    {row.student.user.lastName}, {row.student.user.firstName}
                  </Link>
                  <span className="block text-xs tabular-nums text-muted">{row.student.studentNumber}</span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">{row.summary.attended}</td>
                <td className="px-4 py-2.5 tabular-nums">{row.summary.absent}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{row.summary.excused}</td>
                <td className="px-4 py-2.5 tabular-nums">{row.summary.percentage}%</td>
                <td className="px-4 py-2.5">
                  {row.pattern.concerning ? (
                    <Tag tone="danger">
                      {row.pattern.consecutiveAbsences} sessions missed in a row
                    </Tag>
                  ) : (
                    <span className="text-sm text-muted">-</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {canManage && <NewSessionForm offeringId={offeringId} />}
    </div>
  );
}
