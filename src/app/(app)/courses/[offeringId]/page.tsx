import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadCourse } from '@/server/services/learning';
import { Button, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';

export const metadata: Metadata = { title: 'Course' };

const typeLabels: Record<string, string> = {
  PAGE: 'Reading',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  DOCUMENT: 'Document',
  SCORM: 'Interactive package',
  H5P: 'Activity',
  EXTERNAL_LINK: 'Link',
  LIVE_SESSION: 'Live class',
  ASSESSMENT: 'Assessment',
  DISCUSSION: 'Discussion',
  SURVEY: 'Survey',
};

function availabilityNote(availability: { state: string; releasesOn?: Date; closedOn?: Date }) {
  if (availability.state === 'scheduled' && availability.releasesOn) {
    return `Opens ${availability.releasesOn.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })}`;
  }
  if (availability.state === 'closed' && availability.closedOn) {
    return `Closed ${availability.closedOn.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })}`;
  }
  if (availability.state === 'draft') return 'Draft, not visible to learners';
  return null;
}

export default async function CoursePage({ params }: { params: Promise<{ offeringId: string }> }) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const { offering, viewer, outline, resume } = await loadCourse(principal, offeringId);

  const lecturer = offering.staff.find((member) => member.role === 'LECTURER');

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Courses', href: '/courses' }, { label: offering.course.code }]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-prose">
          <h1 className="font-serif text-2xl font-semibold">{offering.course.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {offering.course.code} · {offering.academicTerm.name} {offering.academicTerm.academicYear.year}
            {lecturer ? ` · ${lecturer.user.firstName} ${lecturer.user.lastName}` : ''}
          </p>
          {offering.course.description && (
            <p className="mt-3 text-sm text-ink">{offering.course.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/courses/${offeringId}/assessments`}>
            <Button variant="secondary">Assessments</Button>
          </Link>
          <Link href={`/courses/${offeringId}/attendance`}>
            <Button variant="secondary">Attendance</Button>
          </Link>
          {viewer === 'staff' && (
            <Link href={`/courses/${offeringId}/builder`}>
              <Button variant="secondary">Edit content</Button>
            </Link>
          )}
          {viewer === 'learner' && resume && (
            <Link href={`/courses/${offeringId}/lessons/${resume.id}`}>
              <Button>{outline.lessonsComplete > 0 ? 'Continue' : 'Start the course'}</Button>
            </Link>
          )}
        </div>
      </div>

      {viewer === 'learner' && outline.lessonsTotal > 0 && (
        <div className="border border-line bg-surface px-4 py-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted">
              {outline.lessonsComplete} of {outline.lessonsTotal} required lessons done
            </p>
            <p className="font-serif text-xl font-semibold tabular-nums">{outline.percentComplete}%</p>
          </div>
          <div
            className="mt-2 h-1.5 w-full bg-line"
            role="progressbar"
            aria-valuenow={outline.percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Course progress"
          >
            <div className="h-full bg-brand" style={{ width: `${outline.percentComplete}%` }} />
          </div>
        </div>
      )}

      {outline.sections.length === 0 ? (
        <Panel>
          <p className="px-4 py-8 text-center text-sm text-muted">
            {viewer === 'staff'
              ? 'No content yet. Open the builder to add the first section.'
              : 'Your lecturer has not published any content for this course yet.'}
          </p>
        </Panel>
      ) : (
        <ol className="space-y-4">
          {outline.sections.map((section, index) => {
            const note = availabilityNote(section.availability);
            return (
              <li key={section.id}>
                <Panel
                  title={`${index + 1}. ${section.title}`}
                  description={section.summary ?? undefined}
                  action={note ? <Tag tone="caution">{note}</Tag> : undefined}
                >
                  {section.lessons.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">No lessons in this section yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {section.lessons.map((lesson) => {
                        const lessonNote = availabilityNote(lesson.availability);
                        const openable = !lesson.locked || viewer === 'staff';
                        return (
                          <li key={lesson.id} className="flex items-center gap-3 px-4 py-3">
                            <span aria-hidden className="text-sm text-muted">
                              {lesson.progress === 'COMPLETED' ? '✓' : lesson.locked ? '·' : '○'}
                            </span>
                            <div className="min-w-0 flex-1">
                              {openable ? (
                                <Link
                                  href={`/courses/${offeringId}/lessons/${lesson.id}`}
                                  className="text-sm font-medium text-accent underline-offset-2 hover:underline"
                                >
                                  {lesson.title}
                                </Link>
                              ) : (
                                <span className="text-sm font-medium text-muted">{lesson.title}</span>
                              )}
                              <span className="block text-xs text-muted">
                                {typeLabels[lesson.type] ?? lesson.type}
                                {lesson.estimatedMinutes ? ` · about ${lesson.estimatedMinutes} minutes` : ''}
                                {lesson.isMandatory ? '' : ' · optional'}
                              </span>
                            </div>
                            {lessonNote && <Tag tone="caution">{lessonNote}</Tag>}
                            {lesson.progress === 'COMPLETED' && <Tag tone="active">done</Tag>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
