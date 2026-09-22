import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { Breadcrumbs } from '@/components/ui/navigation';
import { StudentForm } from './student-form';

export const metadata: Metadata = { title: 'Register a student' };

export default async function NewStudentPage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'student.manage');

  const institutionId = principal.institutionId ?? undefined;

  const [programmes, academicYears, cohorts] = await Promise.all([
    prisma.programme.findMany({
      where: { institutionId, isActive: true },
      select: { id: true, code: true, title: true },
      orderBy: { code: 'asc' },
    }),
    prisma.academicYear.findMany({
      where: { institutionId },
      select: { id: true, year: true, label: true, isCurrent: true },
      orderBy: { year: 'desc' },
    }),
    prisma.cohort.findMany({
      where: { institutionId },
      select: { id: true, code: true, name: true, programmeId: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  return (
    <div className="max-w-3xl">
      <Breadcrumbs trail={[{ label: 'Students', href: '/students' }, { label: 'Register a student' }]} />
      <h1 className="font-serif text-2xl font-semibold">Register a student</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        This creates the learner account, allocates a student number and records the
        programme enrolment. The learner receives an invitation to set their own password.
      </p>

      <StudentForm programmes={programmes} academicYears={academicYears} cohorts={cohorts} />
    </div>
  );
}
