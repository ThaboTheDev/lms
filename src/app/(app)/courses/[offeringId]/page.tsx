import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { loadCourse } from '@/server/services/learning';
import { Button, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { prisma } from '@/lib/db';
import { OFFERING_STATUSES, STAFF_ROLES } from '@/server/services/academic-setup-rules';
import { ActionButton, ActionForm } from '@/components/ui/action-form';
import { addOfferingStaff, changeOfferingStatus, dropOfferingStaff } from '../../admin/academic/actions';
import { addRecording, scheduleLive } from './live-actions';

const words = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
const PROVIDER_NAMES: Record<string, string> = { ZOOM: 'Zoom', MICROSOFT_TEAMS: 'Microsoft Teams', GOOGLE_MEET: 'Google Meet', OTHER: 'Online' };

/** Upcoming and recent live classes; staff can schedule one and add recordings. */
async function LiveClasses({ offeringId, staff }: { offeringId: string; staff: boolean }) {
  const sessions = await prisma.liveSession.findMany({
    where: { offeringId, endsAt: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, title: true, provider: true, joinUrl: true, hostUrl: true, passcode: true, startsAt: true, endsAt: true, recordingUrl: true },
  });
  if (!staff && sessions.length === 0) return null;
  return (
    <Panel title="Live classes" description={staff ? 'Create the meeting in Zoom, Teams or Meet, then paste its link here.' : undefined}>
      {sessions.length > 0 && (
        <ul className="divide-y divide-line">
          {sessions.map((live) => (
            <li key={live.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <span className="font-medium">{live.title}</span>
                <span className="block text-xs text-muted">
                  {PROVIDER_NAMES[live.provider] ?? live.provider} · {live.startsAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })} to {live.endsAt.toLocaleTimeString('en-ZA', { timeStyle: 'short' })}
                  {live.passcode ? ` · passcode ${live.passcode}` : ''}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-3">
                {live.recordingUrl && <a href={live.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">Recording</a>}
                {live.joinUrl && <a href={live.joinUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">Join</a>}
                {staff && live.hostUrl && <a href={live.hostUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">Start as host</a>}
              </span>
              {staff && !live.recordingUrl && (
                <div className="w-full">
                  <ActionForm bare action={addRecording} submitLabel="Add recording" columns={1} fields={[
                    { name: 'liveSessionId', label: '', type: 'hidden', defaultValue: live.id },
                    { name: 'offeringId', label: '', type: 'hidden', defaultValue: offeringId },
                    { name: 'recordingUrl', label: 'Recording link', type: 'url', placeholder: 'https://' },
                  ]} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {staff && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm text-accent">Schedule a live class</summary>
          <ActionForm bare action={scheduleLive} submitLabel="Schedule" columns={3} fields={[
            { name: 'offeringId', label: '', type: 'hidden', defaultValue: offeringId },
            { name: 'title', label: 'Title', required: true, placeholder: 'Week 3 tutorial' },
            { name: 'provider', label: 'On', type: 'select', defaultValue: 'ZOOM', options: Object.entries(PROVIDER_NAMES).map(([value, label]) => ({ value, label })) },
            { name: 'joinUrl', label: 'Join link', type: 'url', required: true, placeholder: 'https://' },
            { name: 'startsAt', label: 'Starts', type: 'datetime-local', required: true },
            { name: 'endsAt', label: 'Ends', type: 'datetime-local', required: true },
            { name: 'passcode', label: 'Passcode', hint: 'Optional' },
            { name: 'hostUrl', label: 'Host link', type: 'url', hint: 'Optional; only staff see it' },
            { name: 'register', label: 'Take attendance (learners check in online)', type: 'checkbox', defaultValue: true },
          ]} />
        </details>
      )}
    </Panel>
  );
}

/** Who teaches this delivery, and its status, for the people who run courses. */
async function TeachingTeam({ offeringId, institutionId }: { offeringId: string; institutionId: string }) {
  const [offering, candidates] = await Promise.all([
    prisma.courseOffering.findUnique({
      where: { id: offeringId },
      select: { status: true, staff: { orderBy: { assignedAt: 'asc' }, select: { id: true, role: true, user: { select: { firstName: true, lastName: true, email: true, status: true } } } } },
    }),
    prisma.user.findMany({
      where: { institutionId, deletedAt: null, status: { in: ['ACTIVE', 'INVITED'] }, studentProfile: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, email: true, status: true },
      take: 500,
    }),
  ]);
  if (!offering) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Teaching team" description="Assigning somebody also gives them that role for this course only.">
        {offering.staff.length === 0 ? (
          <p className="px-4 py-4 text-sm text-danger">Nobody is assigned yet, so no lecturer can build content or mark work here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {offering.staff.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{member.user.firstName} {member.user.lastName}</span>
                  <span className="block text-xs text-muted">{words(member.role)} · {member.user.email}{member.user.status === 'INVITED' ? ' · has not accepted the invitation yet' : ''}</span>
                </span>
                <ActionButton action={dropOfferingStaff} hidden={{ offeringStaffId: member.id, offeringId }} label="Remove" variant="ghost" />
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 0 ? (
          <ActionForm
            bare
            action={addOfferingStaff}
            submitLabel="Add to the team"
            fields={[
              { name: 'offeringId', label: '', type: 'hidden', defaultValue: offeringId },
              { name: 'userId', label: 'Person', type: 'select', required: true, options: candidates.map((person) => ({ value: person.id, label: `${person.lastName}, ${person.firstName} · ${person.email}` })) },
              { name: 'role', label: 'As', type: 'select', defaultValue: 'LECTURER', options: STAFF_ROLES.map((role) => ({ value: role, label: words(role) })) },
            ]}
          />
        ) : (
          <p className="border-t border-line px-4 py-3 text-sm text-muted">Invite staff under People and access first.</p>
        )}
      </Panel>
      <ActionForm
        title="Status"
        description="Open and active deliveries are listed for registration and teaching; closed ones keep their records."
        action={changeOfferingStatus}
        submitLabel="Change status"
        columns={1}
        fields={[
          { name: 'offeringId', label: '', type: 'hidden', defaultValue: offeringId },
          { name: 'status', label: 'Status', type: 'select', defaultValue: offering.status, options: OFFERING_STATUSES.map((value) => ({ value, label: words(value) })) },
        ]}
      />
    </div>
  );
}

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
          {(viewer === 'learner' ||
            can(principal, 'attendance.read', { institutionId: offering.institutionId, courseOfferingId: offeringId })) && (
            <Link href={`/courses/${offeringId}/attendance`}>
              <Button variant="secondary">{viewer === 'learner' ? 'Your attendance' : 'Attendance'}</Button>
            </Link>
          )}
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
            <div className="h-full bg-gold-ink" style={{ width: `${outline.percentComplete}%` }} />
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

      <LiveClasses offeringId={offeringId} staff={viewer === 'staff'} />

      {can(principal, 'course.manage', { institutionId: offering.institutionId, courseOfferingId: offeringId }) && (
        <TeachingTeam offeringId={offeringId} institutionId={offering.institutionId} />
      )}
    </div>
  );
}
