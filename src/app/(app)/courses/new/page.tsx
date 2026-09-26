import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { ActionForm } from '@/components/ui/action-form';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addCourse } from '../../admin/academic/actions';

export const metadata: Metadata = { title: 'Add a course' };

export default async function NewCoursePage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'course.manage');
  const departments = await prisma.department.findMany({
    where: { institutionId: principal.institutionId ?? '', isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, name: true, faculty: { select: { code: true } } },
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Courses', href: '/courses' }, { label: 'Add a course' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Add a course</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">A course in the catalogue. Schedule it into a term on the next screen, then place it in a programme&apos;s curriculum.</p>
      </div>
      <ActionForm
        action={addCourse}
        submitLabel="Add course"
        fields={[
          { name: 'code', label: 'Code', required: true, placeholder: 'BUS101' },
          { name: 'title', label: 'Title', required: true, placeholder: 'Principles of Management' },
          { name: 'credits', label: 'Credits', type: 'number', required: true, min: 0, max: 240, defaultValue: 12 },
          { name: 'notionalHours', label: 'Notional hours', type: 'number', min: 1, hint: 'Optional' },
          { name: 'nqfLevel', label: 'NQF level', type: 'number', min: 1, max: 10, hint: 'Optional' },
          { name: 'departmentId', label: 'Department', type: 'select', options: [{ value: '', label: 'None' }, ...departments.map((d) => ({ value: d.id, label: `${d.faculty.code} / ${d.name}` }))] },
          { name: 'description', label: 'Description', type: 'textarea', rows: 3, hint: 'Optional' },
          { name: 'isActive', label: 'Active in the catalogue', type: 'checkbox', defaultValue: true },
        ]}
      />
    </div>
  );
}
