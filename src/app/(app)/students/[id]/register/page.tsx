import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { buildRegistrationPlan } from '@/server/services/enrolment';
import { getStudent } from '@/server/services/students';
import { Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { RegistrationForm } from './registration-form';

export const metadata: Metadata = { title: 'Register for courses' };

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const principal = await requirePrincipal();
  requirePermission(principal, 'enrolment.manage');

  const { id } = await params;
  const { term } = await searchParams;

  const { student } = await getStudent(principal, id);

  const currentTerm = term
    ? await prisma.academicTerm.findUnique({
        where: { id: term },
        select: { id: true, name: true, academicYear: { select: { year: true } } },
      })
    : await prisma.academicTerm.findFirst({
        where: { isCurrent: true, academicYear: { institutionId: principal.institutionId ?? undefined } },
        select: { id: true, name: true, academicYear: { select: { year: true } } },
      });

  if (!currentTerm) {
    return (
      <Panel title="Registration">
        <p className="px-4 py-6 text-sm text-muted">
          No term is marked as current. Set the current term before registering learners.
        </p>
      </Panel>
    );
  }

  const { lines, programmeCode } = await buildRegistrationPlan(principal, id, currentTerm.id);

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Students', href: '/students' },
          { label: student.studentNumber, href: `/students/${id}` },
          { label: 'Register for courses' },
        ]}
      />

      <div>
        <h1 className="font-serif text-2xl font-semibold">Register for courses</h1>
        <p className="mt-1 text-sm text-muted">
          {student.fullName} · {programmeCode} · {currentTerm.name} {currentTerm.academicYear.year}
        </p>
      </div>

      <RegistrationForm studentId={id} academicTermId={currentTerm.id} lines={lines} />
    </div>
  );
}
