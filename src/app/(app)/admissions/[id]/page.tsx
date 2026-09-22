import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission, requireSameInstitution } from '@/lib/rbac/authorize';
import {
  allowedTransitions,
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/server/services/admissions-workflow';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { DecisionPanel } from './decision-panel';

export const metadata: Metadata = { title: 'Application' };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePrincipal();
  requirePermission(principal, 'application.read');
  const { id } = await params;

  const application = await prisma.application.findUnique({
    where: { id },
    select: {
      id: true,
      institutionId: true,
      referenceNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      nationality: true,
      status: true,
      answers: true,
      conditions: true,
      decisionNotes: true,
      submittedAt: true,
      createdStudentId: true,
      programme: { select: { id: true, code: true, title: true, entryRequirements: true } },
      academicYear: { select: { id: true, year: true, label: true } },
      intakeTerm: { select: { name: true } },
      documents: {
        select: {
          id: true,
          documentType: true,
          verifiedAt: true,
          file: { select: { originalName: true, sizeBytes: true } },
        },
      },
      events: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true },
      },
    },
  });

  if (!application) notFound();
  requireSameInstitution(principal, application.institutionId);

  const status = application.status as ApplicationStatus;
  const transitions = allowedTransitions(status).filter((rule) => rule.actor === 'staff');

  const cohorts = await prisma.cohort.findMany({
    where: {
      institutionId: application.institutionId,
      programmeId: application.programme.id,
      academicYearId: application.academicYear.id,
    },
    select: { id: true, code: true, name: true },
  });

  const answers = (application.answers ?? {}) as Record<string, string | null>;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[{ label: 'Admissions', href: '/admissions' }, { label: application.referenceNumber }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">
            {application.firstName} {application.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {application.referenceNumber} · {application.programme.code} · {application.academicYear.label}
          </p>
        </div>
        <Tag tone={status === 'REJECTED' ? 'danger' : 'active'}>{APPLICATION_STATUS_LABELS[status]}</Tag>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Applicant">
            <DescriptionList
              items={[
                { term: 'Email address', value: application.email },
                { term: 'Phone', value: application.phone ?? 'Not supplied' },
                {
                  term: 'Date of birth',
                  value: application.dateOfBirth
                    ? application.dateOfBirth.toLocaleDateString('en-ZA', { dateStyle: 'long' })
                    : 'Not supplied',
                },
                { term: 'Nationality', value: application.nationality ?? 'Not supplied' },
                { term: 'Highest qualification', value: answers.highestQualification ?? 'Not supplied' },
                { term: 'School or institution', value: answers.schoolOrInstitution ?? 'Not supplied' },
                { term: 'Year completed', value: answers.yearCompleted ?? 'Not supplied' },
                { term: 'Intake', value: application.intakeTerm?.name ?? 'Not specified' },
              ]}
            />
          </Panel>

          <Panel
            title="Entry requirements"
            description={`For ${application.programme.title}`}
          >
            <p className="whitespace-pre-line px-4 py-4 text-sm text-ink">
              {application.programme.entryRequirements ?? 'No entry requirements have been recorded for this programme.'}
            </p>
          </Panel>

          <Panel title="Supporting documents">
            {application.documents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                No documents have been uploaded. Move the application to documents outstanding to ask for them.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {application.documents.map((document) => (
                  <li key={document.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>
                      {document.documentType}
                      <span className="block text-xs text-muted">{document.file.originalName}</span>
                    </span>
                    <Tag tone={document.verifiedAt ? 'active' : 'caution'}>
                      {document.verifiedAt ? 'verified' : 'not verified'}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <DecisionPanel
            applicationId={application.id}
            status={status}
            transitions={transitions.map((rule) => ({
              to: rule.to,
              label: APPLICATION_STATUS_LABELS[rule.to],
              requiresDecision: Boolean(rule.requiresDecision),
            }))}
            cohorts={cohorts}
            alreadyEnrolled={Boolean(application.createdStudentId)}
          />

          <Panel title="History">
            <ol className="divide-y divide-line">
              {application.events.map((event) => (
                <li key={event.id} className="px-4 py-3 text-sm">
                  <p className="font-medium">
                    {event.fromStatus
                      ? `${APPLICATION_STATUS_LABELS[event.fromStatus as ApplicationStatus]} to ${APPLICATION_STATUS_LABELS[event.toStatus as ApplicationStatus]}`
                      : APPLICATION_STATUS_LABELS[event.toStatus as ApplicationStatus]}
                  </p>
                  {event.note && <p className="mt-0.5 text-muted">{event.note}</p>}
                  <p className="mt-0.5 text-xs text-muted">
                    {event.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
