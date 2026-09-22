import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadProofOfPayment } from '@/server/services/proof-of-payment';
import { allowedPopTransitions, POP_STATUS_LABELS, type PopStatus } from '@/server/services/pop-workflow';
import { formatMoney, toCents } from '@/lib/money';
import { humanFileSize } from '@/lib/storage/keys';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'Review proof of payment' };

export default async function PopReviewPage({ params }: { params: Promise<{ popId: string }> }) {
  const principal = await requirePrincipal();
  const { popId } = await params;
  const { pop, duplicates, flags } = await loadProofOfPayment(principal, popId);

  const status = pop.status as PopStatus;
  const transitions = allowedPopTransitions(status);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Finance', href: '/finance' },
          { label: 'Proof of payment', href: '/finance/proof-of-payment' },
          { label: pop.student.studentNumber },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">
            {pop.student.user.firstName} {pop.student.user.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {pop.student.studentNumber} · submitted{' '}
            {pop.submittedAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <Tag tone={status === 'APPROVED' ? 'active' : status === 'REJECTED' ? 'danger' : 'caution'}>
          {POP_STATUS_LABELS[status]}
        </Tag>
      </div>

      {flags.length > 0 && (
        <ul className="border border-line bg-surface">
          {flags.map((flag, index) => (
            <li key={index} className="flex items-start gap-3 px-4 py-3 text-sm">
              <Tag tone={flag.severity === 'warning' ? 'caution' : 'neutral'}>
                {flag.severity === 'warning' ? 'check' : 'note'}
              </Tag>
              <span>{flag.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Panel title="What the learner says">
            <DescriptionList
              items={[
                { term: 'Amount paid', value: formatMoney(toCents(String(pop.declaredAmount))) },
                { term: 'Paid on', value: pop.declaredDate.toLocaleDateString('en-ZA', { dateStyle: 'long' }) },
                { term: 'Reference', value: pop.reference ?? 'None given' },
                {
                  term: 'Against',
                  value: pop.invoice ? (
                    <Link href={`/finance/invoices/${pop.invoice.id}`} className="text-accent underline underline-offset-2">
                      {pop.invoice.number}, {formatMoney(toCents(String(pop.invoice.balance)))} outstanding
                    </Link>
                  ) : (
                    'No invoice named'
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="The document">
            <div className="px-4 py-4 text-sm">
              <a
                href={`/api/v1/files/${pop.file.id}/download`}
                className="text-accent underline underline-offset-2"
              >
                {pop.file.originalName}
              </a>
              <span className="block text-xs text-muted">
                {humanFileSize(pop.file.sizeBytes)}
                {pop.file.scanStatus === 'INFECTED' ? ' · withheld by the malware scan' : ''}
              </span>
            </div>
          </Panel>

          {duplicates.length > 0 && (
            <Panel title="Possible duplicates">
              <ul className="divide-y divide-line">
                {duplicates.map((duplicate) => (
                  <li key={duplicate.candidateId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>
                      <Link
                        href={`/finance/proof-of-payment/${duplicate.candidateId}`}
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        Open the other document
                      </Link>
                      <span className="block text-xs text-muted">{duplicate.reason}</span>
                    </span>
                    <Tag tone={duplicate.confidence === 'certain' ? 'danger' : 'caution'}>
                      {duplicate.confidence}
                    </Tag>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {pop.reviewNotes && (
            <Panel title="Review notes">
              <p className="px-4 py-3 text-sm">
                {pop.reviewNotes}
                {pop.reviewer && (
                  <span className="block text-xs text-muted">
                    {pop.reviewer.firstName} {pop.reviewer.lastName},{' '}
                    {pop.reviewedAt?.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                )}
              </p>
            </Panel>
          )}
        </div>

        <ReviewForm
          popId={popId}
          declaredAmount={Number(pop.declaredAmount)}
          transitions={transitions.map((rule) => ({
            to: rule.to,
            label: POP_STATUS_LABELS[rule.to],
            requiresNote: rule.requiresNote,
          }))}
          alreadyPaid={Boolean(pop.paymentId)}
        />
      </div>
    </div>
  );
}
