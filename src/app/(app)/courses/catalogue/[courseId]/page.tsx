import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { DELIVERY_MODES, OFFERING_STATUSES } from '@/server/services/academic-setup-rules';
import { ActionForm } from '@/components/ui/action-form';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addOffering, saveCourse } from '../../../admin/academic/actions';

export const metadata: Metadata = { title: 'Course' };

const words = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

/** Terms worth scheduling into: anything that ended less than six months ago, or later. */
function schedulableSince(at: Date = new Date()) {
  return new Date(at.getTime() - 180 * 86_400_000);
}

export default async function CatalogueCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const principal = await requirePrincipal();
  requirePermission(principal, 'course.manage');
  const { courseId } = await params;
  const institutionId = principal.institutionId ?? '';

  const [course, departments, terms] = await Promise.all([
    prisma.course.findFirst({
      where: { id: courseId, institutionId },
      include: {
        offerings: {
          orderBy: [{ academicTerm: { startsOn: 'desc' } }, { sectionCode: 'asc' }],
          include: {
            academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
            staff: { select: { role: true, user: { select: { firstName: true, lastName: true } } } },
            _count: { select: { enrolments: true } },
          },
        },
        _count: { select: { curriculum: true } },
      },
    }),
    prisma.department.findMany({ where: { institutionId, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, name: true, faculty: { select: { code: true } } } }),
    prisma.academicTerm.findMany({
      where: { academicYear: { institutionId }, endsOn: { gte: schedulableSince() } },
      orderBy: { startsOn: 'asc' },
      select: { id: true, name: true, code: true, isCurrent: true, academicYear: { select: { year: true } } },
    }),
  ]);
  if (!course) throw new NotFoundError('Course');

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Courses', href: '/courses' }, { label: course.code }]} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{course.title}</h1>
          <p className="mt-1 text-sm text-muted">{course.code} · {course.credits} credits · in {course._count.curriculum} curricula</p>
        </div>
        <Tag tone={course.isActive ? 'active' : 'neutral'}>{course.isActive ? 'active' : 'inactive'}</Tag>
      </div>

      <Panel title="Deliveries" description="Each time the course runs in a term, with its own learners, content and teaching team.">
        {course.offerings.length === 0 ? (
          <EmptyState title="Not scheduled yet" hint="Schedule it into a term below." />
        ) : (
          <DataTable caption="Deliveries" head={['Term', 'Section', 'Delivery', 'Teaching team', 'Enrolled', 'Status']}>
            {course.offerings.map((offering) => (
              <tr key={offering.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/courses/${offering.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {offering.academicTerm.name} {offering.academicTerm.academicYear.year}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{offering.sectionCode}</td>
                <td className="px-4 py-2.5 text-muted">{words(offering.deliveryMode)}</td>
                <td className="px-4 py-2.5 text-muted">
                  {offering.staff.length === 0 ? <span className="text-danger">nobody assigned</span> : offering.staff.map((member) => `${member.user.firstName} ${member.user.lastName} (${words(member.role)})`).join(', ')}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{offering._count.enrolments}{offering.capacity ? ` of ${offering.capacity}` : ''}</td>
                <td className="px-4 py-2.5"><Tag tone={offering.status === 'ACTIVE' || offering.status === 'OPEN' ? 'active' : 'neutral'}>{offering.status.toLowerCase()}</Tag></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {terms.length === 0 ? (
        <Panel>
          <EmptyState title="No term to schedule into" hint="Add an academic year and its terms first." action={<Link href="/admin/academic/calendar" className="text-accent underline underline-offset-2">Open years and terms</Link>} />
        </Panel>
      ) : (
        <ActionForm
          title="Schedule a delivery"
          action={addOffering}
          submitLabel="Schedule"
          columns={3}
          fields={[
            { name: 'courseId', label: '', type: 'hidden', defaultValue: course.id },
            { name: 'academicTermId', label: 'Term', type: 'select', required: true, defaultValue: terms.find((term) => term.isCurrent)?.id ?? terms[0]!.id, options: terms.map((term) => ({ value: term.id, label: `${term.name} ${term.academicYear.year}${term.isCurrent ? ' (current)' : ''}` })) },
            { name: 'sectionCode', label: 'Section', placeholder: 'A', hint: 'For parallel groups' },
            { name: 'deliveryMode', label: 'Delivery', type: 'select', defaultValue: 'BLENDED', options: DELIVERY_MODES.map((mode) => ({ value: mode, label: words(mode) })) },
            { name: 'capacity', label: 'Capacity', type: 'number', min: 1, hint: 'Optional' },
            { name: 'status', label: 'Status', type: 'select', defaultValue: 'OPEN', options: OFFERING_STATUSES.filter((s) => s !== 'ARCHIVED').map((value) => ({ value, label: words(value) })) },
          ]}
        />
      )}

      <ActionForm
        title="Course details"
        action={saveCourse}
        submitLabel="Save course"
        fields={[
          { name: 'courseId', label: '', type: 'hidden', defaultValue: course.id },
          { name: 'code', label: 'Code', required: true, defaultValue: course.code },
          { name: 'title', label: 'Title', required: true, defaultValue: course.title },
          { name: 'credits', label: 'Credits', type: 'number', required: true, min: 0, max: 240, defaultValue: course.credits },
          { name: 'notionalHours', label: 'Notional hours', type: 'number', min: 1, defaultValue: course.notionalHours ?? '' },
          { name: 'nqfLevel', label: 'NQF level', type: 'number', min: 1, max: 10, defaultValue: course.nqfLevel ?? '' },
          { name: 'departmentId', label: 'Department', type: 'select', defaultValue: course.departmentId ?? '', options: [{ value: '', label: 'None' }, ...departments.map((d) => ({ value: d.id, label: `${d.faculty.code} / ${d.name}` }))] },
          { name: 'description', label: 'Description', type: 'textarea', rows: 3, defaultValue: course.description ?? '' },
          { name: 'isActive', label: 'Active in the catalogue', type: 'checkbox', defaultValue: course.isActive },
        ]}
      />
    </div>
  );
}
