import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listSurveys } from '@/server/services/surveys';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ActionForm } from '@/components/ui/action-form';
import { newSurvey } from './actions';

export const metadata: Metadata = { title: 'Surveys' };

const tone = { DRAFT: 'neutral', OPEN: 'active', CLOSED: 'caution' } as const;

export default async function SurveysPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const { viewer, surveys } = await listSurveys(principal, offeringId);

  return (
    <div className="max-w-4xl space-y-6">
      <Breadcrumbs trail={[{ label: 'Courses', href: '/courses' }, { label: 'Course', href: `/courses/${offeringId}` }, { label: 'Surveys' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Surveys</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {viewer === 'staff'
            ? 'Course evaluations and quick polls. Anonymous surveys store no names, and show results only once five people have answered.'
            : 'Tell your lecturers how the course is going.'}
        </p>
      </div>

      {viewer === 'staff' && (
        <ActionForm
          title="New survey"
          action={newSurvey}
          submitLabel="Create the survey"
          fields={[
            { name: 'offeringId', label: '', type: 'hidden', defaultValue: offeringId },
            { name: 'title', label: 'Title', required: true, placeholder: 'Mid-semester course evaluation' },
            { name: 'closesAt', label: 'Closes', type: 'datetime-local', hint: 'Optional' },
            { name: 'description', label: 'Introduction', type: 'textarea', rows: 2, wide: true },
            { name: 'isAnonymous', label: 'Anonymous: store no names', type: 'checkbox', defaultValue: true },
          ]}
        />
      )}

      <Panel title={viewer === 'staff' ? 'Surveys on this course' : 'Surveys for you'}>
        {surveys.length === 0 ? (
          <EmptyState title="No surveys" hint={viewer === 'staff' ? 'Create one above.' : 'There is nothing to answer right now.'} />
        ) : (
          <ul className="divide-y divide-line">
            {surveys.map((survey) => (
              <li key={survey.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <Link href={`/courses/${offeringId}/surveys/${survey.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {survey.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {survey._count.questions} questions · {survey.isAnonymous ? 'anonymous' : 'named'}
                    {viewer === 'staff' ? ` · ${survey._count.responses} responses` : ''}
                    {survey.closesAt ? ` · closes ${survey.closesAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                  </p>
                </div>
                {viewer === 'staff' ? (
                  <Tag tone={tone[survey.status]}>{survey.status.toLowerCase()}</Tag>
                ) : survey.answered ? (
                  <Tag tone="active">answered</Tag>
                ) : survey.open ? (
                  <Tag tone="caution">waiting for you</Tag>
                ) : (
                  <Tag tone="neutral">closed</Tag>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
