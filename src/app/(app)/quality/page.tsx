import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { moderationQueue } from '@/server/services/moderation';
import { complianceOverview, listQaDocuments, listReviews } from '@/server/services/quality';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { QaDocumentForm, ReviewForms } from './quality-forms';

export const metadata: Metadata = { title: 'Quality assurance' };

const signalTone = { ok: 'active', attention: 'caution', breach: 'danger' } as const;

export default async function QualityPage() {
  const principal = await requirePrincipal();
  const managesQa = can(principal, 'qa.manage');

  const [queue, signals, reviews, documents, programmes] = await Promise.all([
    moderationQueue(principal),
    managesQa ? complianceOverview(principal) : Promise.resolve([]),
    managesQa ? listReviews(principal) : Promise.resolve([]),
    managesQa ? listQaDocuments(principal) : Promise.resolve([]),
    managesQa
      ? prisma.programme.findMany({
          where: { institutionId: principal.institutionId ?? undefined, isActive: true },
          select: { id: true, code: true, title: true },
          orderBy: { code: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const unmoderated = queue.filter((assessment) => assessment.releasedWithoutModeration);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Quality assurance</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Moderation, programme review and the evidence an accreditation panel asks for. Every
          figure here is counted from the records rather than entered by hand.
        </p>
      </div>

      {signals.length > 0 && (
        <Panel title="Compliance" description="What the academic board is looking at.">
          <ul className="divide-y divide-line">
            {signals.map((signal) => (
              <li key={signal.key} className="flex items-start gap-3 px-4 py-3 text-sm">
                <Tag tone={signalTone[signal.status]}>{signal.status}</Tag>
                <span>
                  <span className="font-medium">{signal.label}</span>
                  <span className="block text-muted">{signal.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {unmoderated.length > 0 && (
        <Panel
          title="Results released without moderation"
          description="These assessments gave learners their marks with no moderation on file."
        >
          <ul className="divide-y divide-line">
            {unmoderated.map((assessment) => (
              <li key={assessment.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  <Link
                    href={`/quality/moderation/${assessment.id}`}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    {assessment.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {assessment.offering.course.code} · {assessment._count.submissions} submissions
                  </span>
                </span>
                <Tag tone="danger">no moderation record</Tag>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Assessments to moderate" description={`${queue.length} published assessments`}>
        {queue.length === 0 ? (
          <EmptyState title="Nothing published" hint="Moderation starts once assessments are published." />
        ) : (
          <DataTable
            caption="Assessments"
            head={['Assessment', 'Course', 'Weight', 'Submissions', 'Moderations', 'Results']}
          >
            {queue.slice(0, 40).map((assessment) => (
              <tr key={assessment.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/quality/moderation/${assessment.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {assessment.title}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted">{assessment.offering.course.code}</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(assessment.weight)}%</td>
                <td className="px-4 py-2.5 tabular-nums">{assessment._count.submissions}</td>
                <td className="px-4 py-2.5 tabular-nums">{assessment._count.moderations}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={assessment.releaseResultsAt ? 'active' : 'neutral'}>
                    {assessment.releaseResultsAt ? 'released' : 'held'}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {managesQa && (
        <>
          <Panel title="Programme review" description={`${reviews.length} on the cycle`}>
            {reviews.length === 0 ? (
              <EmptyState title="No reviews planned" hint="Plan one below to start collecting evidence." />
            ) : (
              <ul className="divide-y divide-line">
                {reviews.map((review) => (
                  <li key={review.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {review.programme.code} · {review.cycle}
                        </p>
                        <p className="text-xs text-muted">
                          {review.dueOn
                            ? `Due ${review.dueOn.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}`
                            : 'No date set'}
                          {' · evidence '}
                          {review.evidence.completeness}% complete
                        </p>
                      </div>
                      <Tag
                        tone={
                          review.stage === 'COMPLETE'
                            ? 'active'
                            : review.stage === 'OVERDUE'
                              ? 'danger'
                              : 'caution'
                        }
                      >
                        {review.stage.toLowerCase().replace(/_/g, ' ')}
                      </Tag>
                    </div>

                    {review.evidence.gaps.filter((gap) => gap.required).length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-muted">
                        {review.evidence.gaps
                          .filter((gap) => gap.required)
                          .map((gap) => (
                            <li key={gap.category}>
                              Missing: {gap.label}. {gap.rationale}
                            </li>
                          ))}
                      </ul>
                    )}

                    {review.findings && (
                      <p className="mt-2 text-sm">
                        <span className="text-muted">Found:</span> {review.findings}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Evidence on file" description={`${documents.length} documents`}>
            {documents.length === 0 ? (
              <EmptyState title="Nothing filed" hint="Upload the policies and records a panel will ask for." />
            ) : (
              <ul className="divide-y divide-line">
                {documents.map((document) => (
                  <li key={document.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>
                      {document.file ? (
                        <a
                          href={`/api/v1/files/${document.file.id}/download`}
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          {document.title}
                        </a>
                      ) : (
                        document.title
                      )}
                      <span className="block text-xs text-muted">
                        {document.category.toLowerCase().replace(/_/g, ' ')}
                        {document.programme ? ` · ${document.programme.code}` : ''}
                      </span>
                    </span>
                    <Tag tone={document.status === 'APPROVED' ? 'active' : 'neutral'}>
                      {document.status.toLowerCase()}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <QaDocumentForm
              programmes={programmes.map((programme) => ({
                id: programme.id,
                label: `${programme.code} · ${programme.title}`,
              }))}
            />
            <ReviewForms
              programmes={programmes.map((programme) => ({
                id: programme.id,
                label: `${programme.code} · ${programme.title}`,
              }))}
              openReviews={reviews
                .filter((review) => review.stage !== 'COMPLETE')
                .map((review) => ({
                  id: review.id,
                  label: `${review.programme.code} · ${review.cycle}`,
                }))}
            />
          </div>
        </>
      )}
    </div>
  );
}
