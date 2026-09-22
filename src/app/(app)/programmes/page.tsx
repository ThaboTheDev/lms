import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can, requirePermission } from '@/lib/rbac/authorize';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Programmes' };

export default async function ProgrammesPage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'programme.read');

  const programmes = await prisma.programme.findMany({
    where: { institutionId: principal.institutionId ?? undefined },
    orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      title: true,
      isActive: true,
      durationMonths: true,
      qualification: { select: { title: true, nqfLevel: true, minimumCredits: true } },
      department: { select: { name: true, faculty: { select: { name: true } } } },
      _count: { select: { curriculum: true, enrolments: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Programmes</h1>
          <p className="mt-1 text-sm text-muted">
            Each programme leads to a qualification and carries its own curriculum.
          </p>
        </div>
        {can(principal, 'programme.manage') && (
          <Link href="/programmes/new">
            <Button>Add a programme</Button>
          </Link>
        )}
      </div>

      <Panel>
        {programmes.length === 0 ? (
          <EmptyState
            title="No programmes yet"
            hint="Create the qualification first, then the programme that leads to it."
          />
        ) : (
          <DataTable
            caption="Programmes"
            head={['Code', 'Programme', 'Qualification', 'Faculty', 'Courses', 'Enrolled', 'Status']}
          >
            {programmes.map((programme) => (
              <tr key={programme.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/programmes/${programme.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {programme.code}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{programme.title}</td>
                <td className="px-4 py-2.5 text-muted">
                  {programme.qualification.title}
                  {programme.qualification.nqfLevel ? ` · NQF ${programme.qualification.nqfLevel}` : ''}
                </td>
                <td className="px-4 py-2.5 text-muted">{programme.department.faculty.name}</td>
                <td className="px-4 py-2.5 tabular-nums">{programme._count.curriculum}</td>
                <td className="px-4 py-2.5 tabular-nums">{programme._count.enrolments}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={programme.isActive ? 'active' : 'neutral'}>
                    {programme.isActive ? 'active' : 'inactive'}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
