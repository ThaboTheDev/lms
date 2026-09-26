import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { DELIVERY_MODES } from '@/server/services/academic-setup-rules';
import { ActionForm } from '@/components/ui/action-form';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addProgramme } from '../../admin/academic/actions';

export const metadata: Metadata = { title: 'Add a programme' };

export default async function NewProgrammePage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'programme.manage');
  const institutionId = principal.institutionId ?? '';
  const [departments, qualifications] = await Promise.all([
    prisma.department.findMany({ where: { institutionId, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, faculty: { select: { code: true } } } }),
    prisma.qualification.findMany({ where: { institutionId, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, title: true, nqfLevel: true } }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Programmes', href: '/programmes' }, { label: 'Add a programme' }]} />
      <h1 className="font-serif text-2xl font-semibold">Add a programme</h1>
      {departments.length === 0 || qualifications.length === 0 ? (
        <Panel>
          <EmptyState
            title={departments.length === 0 ? 'Add a department first' : 'Add a qualification first'}
            hint="A programme belongs to a department and leads to a qualification."
            action={<Link href="/admin/academic/structure" className="text-accent underline underline-offset-2">Open faculties, departments and qualifications</Link>}
          />
        </Panel>
      ) : (
        <ActionForm
          action={addProgramme}
          submitLabel="Add programme"
          fields={[
            { name: 'code', label: 'Code', required: true, placeholder: 'HCBM-FT' },
            { name: 'title', label: 'Title', required: true, placeholder: 'Higher Certificate in Business Management (full time)' },
            { name: 'qualificationId', label: 'Leads to', type: 'select', required: true, options: qualifications.map((q) => ({ value: q.id, label: `${q.code} · ${q.title}${q.nqfLevel ? ` (NQF ${q.nqfLevel})` : ''}` })) },
            { name: 'departmentId', label: 'Department', type: 'select', required: true, options: departments.map((d) => ({ value: d.id, label: `${d.faculty.code} / ${d.name}` })) },
            { name: 'durationMonths', label: 'Duration in months', type: 'number', min: 1, max: 120, hint: 'Optional' },
            { name: 'deliveryModes', label: 'Delivered', type: 'checkboxes', defaultValue: ['CONTACT'], options: DELIVERY_MODES.map((mode) => ({ value: mode, label: mode.charAt(0) + mode.slice(1).toLowerCase() })) },
            { name: 'description', label: 'Description', type: 'textarea', rows: 3, hint: 'Optional; shown to applicants' },
            { name: 'entryRequirements', label: 'Entry requirements', type: 'textarea', rows: 3, hint: 'Optional' },
            { name: 'isActive', label: 'Open for applications and registration', type: 'checkbox', defaultValue: true },
          ]}
        />
      )}
    </div>
  );
}
