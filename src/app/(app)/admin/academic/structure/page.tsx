import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can, requireAnyPermission } from '@/lib/rbac/authorize';
import { QUALIFICATION_TYPES, SETUP_PERMISSIONS } from '@/server/services/academic-setup-rules';
import { ActionForm } from '@/components/ui/action-form';
import { DataTable, EmptyState, Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addDepartment, addFaculty, addQualification } from '../actions';

export const metadata: Metadata = { title: 'Faculties, departments and qualifications' };

const words = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function StructurePage() {
  const principal = await requirePrincipal();
  requireAnyPermission(principal, [...SETUP_PERMISSIONS]);
  const institutionId = principal.institutionId ?? '';
  const edits = can(principal, 'programme.manage', { institutionId });

  const [faculties, qualifications] = await Promise.all([
    prisma.faculty.findMany({
      where: { institutionId },
      orderBy: { code: 'asc' },
      include: { departments: { orderBy: { code: 'asc' }, include: { _count: { select: { programmes: true, courses: true } } } } },
    }),
    prisma.qualification.findMany({ where: { institutionId }, orderBy: { code: 'asc' }, include: { _count: { select: { programmes: true } } } }),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Academic setup', href: '/admin/academic' }, { label: 'Structure' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Faculties, departments and qualifications</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">A programme belongs to a department and leads to a qualification; a course can belong to a department.</p>
      </div>

      <Panel title="Faculties and departments" description={`${faculties.length} faculties`}>
        {faculties.length === 0 ? (
          <EmptyState title="No faculties yet" hint="Add a faculty, then its departments." />
        ) : (
          <DataTable caption="Departments by faculty" head={['Faculty', 'Department', 'Code', 'Programmes', 'Courses']}>
            {faculties.flatMap((faculty) =>
              faculty.departments.length === 0
                ? [
                    <tr key={faculty.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-medium">{faculty.name} <span className="text-xs text-muted">({faculty.code})</span></td>
                      <td className="px-4 py-2.5 text-muted" colSpan={4}>No departments yet</td>
                    </tr>,
                  ]
                : faculty.departments.map((department, index) => (
                    <tr key={department.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-medium">{index === 0 ? <>{faculty.name} <span className="text-xs text-muted">({faculty.code})</span></> : ''}</td>
                      <td className="px-4 py-2.5">{department.name}</td>
                      <td className="px-4 py-2.5 text-muted">{department.code}</td>
                      <td className="px-4 py-2.5 tabular-nums">{department._count.programmes}</td>
                      <td className="px-4 py-2.5 tabular-nums">{department._count.courses}</td>
                    </tr>
                  )),
            )}
          </DataTable>
        )}
      </Panel>

      <Panel title="Qualifications" description={`${qualifications.length} on record`}>
        {qualifications.length === 0 ? (
          <EmptyState title="No qualifications yet" hint="Add what your programmes lead to." />
        ) : (
          <DataTable caption="Qualifications" head={['Code', 'Title', 'Type', 'NQF', 'Credits', 'SAQA ID', 'Programmes']}>
            {qualifications.map((qualification) => (
              <tr key={qualification.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{qualification.code}</td>
                <td className="px-4 py-2.5">{qualification.title}</td>
                <td className="px-4 py-2.5 text-muted">{words(qualification.type)}</td>
                <td className="px-4 py-2.5 tabular-nums">{qualification.nqfLevel ?? '-'}</td>
                <td className="px-4 py-2.5 tabular-nums">{qualification.minimumCredits ?? '-'}</td>
                <td className="px-4 py-2.5 text-muted">{qualification.saqaId ?? '-'}</td>
                <td className="px-4 py-2.5 tabular-nums">{qualification._count.programmes}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {edits && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ActionForm
            title="Add a faculty"
            action={addFaculty}
            submitLabel="Add faculty"
            fields={[
              { name: 'code', label: 'Code', required: true, placeholder: 'COM' },
              { name: 'name', label: 'Name', required: true, placeholder: 'Faculty of Commerce' },
              { name: 'description', label: 'Description', type: 'textarea', rows: 2, hint: 'Optional' },
            ]}
          />
          {faculties.length > 0 && (
            <ActionForm
              title="Add a department"
              action={addDepartment}
              submitLabel="Add department"
              fields={[
                { name: 'facultyId', label: 'Faculty', type: 'select', required: true, options: faculties.map((faculty) => ({ value: faculty.id, label: faculty.name })), wide: true },
                { name: 'code', label: 'Code', required: true, placeholder: 'BUS' },
                { name: 'name', label: 'Name', required: true, placeholder: 'Department of Business Management' },
              ]}
            />
          )}
          <ActionForm
            title="Add a qualification"
            action={addQualification}
            submitLabel="Add qualification"
            fields={[
              { name: 'code', label: 'Code', required: true, placeholder: 'HCBM' },
              { name: 'type', label: 'Type', type: 'select', required: true, defaultValue: 'HIGHER_CERTIFICATE', options: QUALIFICATION_TYPES.map((value) => ({ value, label: words(value) })) },
              { name: 'title', label: 'Title', required: true, placeholder: 'Higher Certificate in Business Management', wide: true },
              { name: 'nqfLevel', label: 'NQF level', type: 'number', min: 1, max: 10, hint: 'Optional' },
              { name: 'minimumCredits', label: 'Credits required', type: 'number', min: 1, hint: 'Optional' },
              { name: 'saqaId', label: 'SAQA ID', hint: 'Optional' },
              { name: 'accreditationRef', label: 'Accreditation reference', hint: 'Optional' },
            ]}
          />
        </div>
      )}
    </div>
  );
}
