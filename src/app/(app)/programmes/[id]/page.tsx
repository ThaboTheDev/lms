import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { getProgrammeWithCurriculum } from '@/server/services/programmes';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { CurriculumBuilder } from './curriculum-builder';

export const metadata: Metadata = { title: 'Programme' };

export default async function ProgrammePage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  const { id } = await params;
  const { programme, problems, totalCredits } = await getProgrammeWithCurriculum(principal, id);

  const editable = can(principal, 'programme.manage', { institutionId: programme.institutionId });

  const courses = editable
    ? await prisma.course.findMany({
        where: { institutionId: programme.institutionId, isActive: true },
        select: { id: true, code: true, title: true, credits: true },
        orderBy: { code: 'asc' },
      })
    : [];

  // Group the curriculum the way a handbook prints it: year, then term.
  const grouped = new Map<string, typeof programme.curriculum>();
  for (const item of programme.curriculum) {
    const key = `${item.yearOfStudy}-${item.termNumber}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Programmes', href: '/programmes' }, { label: programme.code }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{programme.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {programme.code} · {programme.department.faculty.name} · {programme._count.enrolments} enrolled
          </p>
        </div>
        <Tag tone={programme.isActive ? 'active' : 'neutral'}>
          {programme.isActive ? 'active' : 'inactive'}
        </Tag>
      </div>

      <Panel title="Programme detail">
        <DescriptionList
          items={[
            { term: 'Qualification', value: `${programme.qualification.title} (${programme.qualification.code})` },
            { term: 'NQF level', value: programme.qualification.nqfLevel ?? 'Not recorded' },
            { term: 'Credits required', value: programme.qualification.minimumCredits ?? 'Not recorded' },
            { term: 'Credits in curriculum', value: totalCredits },
            { term: 'Duration', value: programme.durationMonths ? `${programme.durationMonths} months` : 'Not recorded' },
            { term: 'Delivery', value: programme.deliveryModes.map((mode) => mode.toLowerCase()).join(', ') },
            { term: 'Department', value: programme.department.name },
            {
              term: 'Coordinator',
              value: programme.coordinator
                ? `${programme.coordinator.firstName} ${programme.coordinator.lastName}`
                : 'Not assigned',
            },
          ]}
        />
      </Panel>

      {problems.length > 0 && (
        <Panel title="Curriculum checks" description="Run against the qualification this programme leads to.">
          <ul className="divide-y divide-line">
            {problems.map((problem, index) => (
              <li key={index} className="flex items-start gap-3 px-4 py-3 text-sm">
                <Tag tone={problem.severity === 'error' ? 'danger' : 'caution'}>
                  {problem.severity === 'error' ? 'blocking' : 'check'}
                </Tag>
                <span>{problem.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Curriculum"
        description={`${programme.curriculum.length} courses, ${totalCredits} credits`}
      >
        {programme.curriculum.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            No courses have been placed in this curriculum yet.
          </p>
        ) : (
          [...grouped.entries()].map(([key, items]) => {
            const [year, term] = key.split('-');
            return (
              <div key={key} className="border-b border-line last:border-0">
                <h3 className="bg-paper px-4 py-2 text-sm font-medium">
                  Year {year}, term {term}
                </h3>
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    Courses in year {year}, term {term}
                  </caption>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-t border-line">
                        <td className="px-4 py-2.5 font-medium">{item.course.code}</td>
                        <td className="px-4 py-2.5">
                          {item.course.title}
                          {item.course.prerequisites.length > 0 && (
                            <span className="block text-xs text-muted">
                              Needs{' '}
                              {item.course.prerequisites
                                .map((rule) => `${rule.requiredCourse.code} (${rule.kind.toLowerCase()})`)
                                .join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted">
                          {item.credits ?? item.course.credits} credits
                        </td>
                        <td className="px-4 py-2.5">
                          <Tag tone={item.isCompulsory ? 'active' : 'neutral'}>
                            {item.isCompulsory ? 'compulsory' : 'elective'}
                          </Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </Panel>

      {editable && (
        <CurriculumBuilder
          programmeId={programme.id}
          courses={courses}
          curriculumCourses={programme.curriculum.map((item) => ({
            id: item.course.id,
            code: item.course.code,
            title: item.course.title,
          }))}
        />
      )}
    </div>
  );
}
