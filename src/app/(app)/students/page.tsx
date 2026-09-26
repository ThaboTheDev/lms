import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { parsePaging } from '@/lib/http';
import { listStudents } from '@/server/services/students';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/navigation';

export const metadata: Metadata = { title: 'Students' };

const statusTone: Record<string, 'active' | 'caution' | 'neutral' | 'danger'> = {
  REGISTERED: 'active',
  ADMITTED: 'active',
  CONDITIONALLY_ADMITTED: 'caution',
  APPLIED: 'caution',
  PROSPECT: 'neutral',
  DEFERRED: 'caution',
  WITHDRAWN: 'danger',
  ALUMNUS: 'neutral',
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 50);

  const [{ total, students }, programmes] = await Promise.all([
    listStudents(
      principal,
      {
        query: params.q?.trim(),
        programmeId: params.programme,
        admissionStatus: params.status,
      },
      { skip, perPage },
    ),
    prisma.programme.findMany({
      where: { institutionId: principal.institutionId ?? undefined, isActive: true },
      select: { id: true, code: true, title: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/students?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Students</h1>
          <p className="mt-1 text-sm text-muted">
            {total.toLocaleString('en-ZA')} {total === 1 ? 'learner' : 'learners'} on record.
          {' '}<a href="/api/v1/reports/students" download className="text-accent underline underline-offset-2">Download the register (CSV)</a></p>
        </div>
        {can(principal, 'student.manage') && (
          <Link href="/students/new">
            <Button>Register a student</Button>
          </Link>
        )}
      </div>

      <Panel>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" role="search">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="q" className="sr-only">
              Search by name, student number or email address
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Name, student number or email address"
              className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="programme" className="sr-only">
              Filter by programme
            </label>
            <Select id="programme" name="programme" defaultValue={params.programme ?? ''} className="h-9 w-56">
              <option value="">All programmes</option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Filter by admission status
            </label>
            <Select id="status" name="status" defaultValue={params.status ?? ''} className="h-9 w-48">
              <option value="">Any status</option>
              {Object.keys(statusTone).map((status) => (
                <option key={status} value={status}>
                  {status.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Apply filters
          </Button>
        </form>

        {students.length === 0 ? (
          <EmptyState
            title="No learners match these filters"
            hint="Clear the filters, or register a learner to start the record."
          />
        ) : (
          <DataTable
            caption="Students"
            head={['Student number', 'Name', 'Programme', 'Year', 'Status']}
          >
            {students.map((student) => (
              <tr key={student.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  <Link href={`/students/${student.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {student.studentNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{student.fullName}</td>
                <td className="px-4 py-2.5 text-muted">{student.programme?.code ?? 'Not enrolled'}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{student.yearOfStudy ?? '-'}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={statusTone[student.admissionStatus] ?? 'neutral'}>
                    {student.admissionStatus.toLowerCase().replace(/_/g, ' ')}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
      </Panel>
    </div>
  );
}
