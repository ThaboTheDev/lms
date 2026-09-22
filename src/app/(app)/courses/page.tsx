import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can, requirePermission } from '@/lib/rbac/authorize';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Courses' };

/**
 * Two views of the same thing. Teaching staff want the deliveries they are
 * attached to this term; academic administration wants the approved course
 * catalogue. The permission decides which one opens.
 */
export default async function CoursesPage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'course.read');
  const institutionId = principal.institutionId ?? undefined;

  const manages = can(principal, 'course.manage');

  const [offerings, catalogue] = await Promise.all([
    prisma.courseOffering.findMany({
      where: {
        institutionId,
        status: { in: ['OPEN', 'ACTIVE'] },
        ...(manages ? {} : { staff: { some: { userId: principal.userId } } }),
      },
      orderBy: { course: { code: 'asc' } },
      select: {
        id: true,
        sectionCode: true,
        status: true,
        deliveryMode: true,
        capacity: true,
        course: { select: { code: true, title: true, credits: true } },
        academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
        _count: { select: { enrolments: true, assessments: true } },
      },
    }),
    manages
      ? prisma.course.findMany({
          where: { institutionId },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            title: true,
            credits: true,
            nqfLevel: true,
            isActive: true,
            _count: { select: { offerings: true, curriculum: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Courses</h1>
          <p className="mt-1 text-sm text-muted">
            {manages
              ? 'Deliveries running now, and the approved course catalogue.'
              : 'The courses you are teaching this term.'}
          </p>
        </div>
        {manages && (
          <Link href="/courses/new">
            <Button>Add a course</Button>
          </Link>
        )}
      </div>

      <Panel title="Running now" description={`${offerings.length} deliveries`}>
        {offerings.length === 0 ? (
          <EmptyState
            title="Nothing is running"
            hint="Course deliveries appear here once a course is scheduled into a term."
          />
        ) : (
          <DataTable
            caption="Course deliveries"
            head={['Course', 'Term', 'Delivery', 'Enrolled', 'Assessments', 'Status']}
          >
            {offerings.map((offering) => (
              <tr key={offering.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/courses/${offering.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {offering.course.code}
                    {offering.sectionCode !== 'A' ? ` (${offering.sectionCode})` : ''}
                  </Link>
                  <span className="block text-xs text-muted">{offering.course.title}</span>
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {offering.academicTerm.name} {offering.academicTerm.academicYear.year}
                </td>
                <td className="px-4 py-2.5 text-muted">{offering.deliveryMode.toLowerCase()}</td>
                <td className="px-4 py-2.5 tabular-nums">
                  {offering._count.enrolments}
                  {offering.capacity ? ` of ${offering.capacity}` : ''}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{offering._count.assessments}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={offering.status === 'ACTIVE' ? 'active' : 'caution'}>
                    {offering.status.toLowerCase()}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {manages && (
        <Panel title="Course catalogue" description={`${catalogue.length} approved courses`}>
          {catalogue.length === 0 ? (
            <EmptyState title="No courses yet" hint="Add the courses your programmes are built from." />
          ) : (
            <DataTable
              caption="Approved courses"
              head={['Code', 'Title', 'Credits', 'NQF', 'In curricula', 'Deliveries', 'Status']}
            >
              {catalogue.map((course) => (
                <tr key={course.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{course.code}</td>
                  <td className="px-4 py-2.5">{course.title}</td>
                  <td className="px-4 py-2.5 tabular-nums">{course.credits}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{course.nqfLevel ?? '-'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{course._count.curriculum}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{course._count.offerings}</td>
                  <td className="px-4 py-2.5">
                    <Tag tone={course.isActive ? 'active' : 'neutral'}>
                      {course.isActive ? 'active' : 'retired'}
                    </Tag>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      )}
    </div>
  );
}
