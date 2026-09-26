'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel, Tag } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { decideProgression, generateTranscript, issueCredential } from '../actions';

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? 'Working' : label}
    </Button>
  );
}

export function TranscriptActions({
  studentId,
  snapshots,
}: {
  studentId: string;
  snapshots: { id: string; generatedAt: Date; academicYear: { label: string } | null }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(generateTranscript, {});

  return (
    <Panel title="Issued transcripts" description="Each copy is fixed as at the day it was issued.">
      {snapshots.length > 0 && (
        <ul className="divide-y divide-line">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {snapshot.generatedAt.toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' })}
                {snapshot.academicYear ? ` · ${snapshot.academicYear.label}` : ''}
              </span>
              <a href={`/records/${studentId}/transcripts/${snapshot.id}`} className="text-xs text-accent underline underline-offset-2">Open the issued copy</a>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="space-y-3 border-t border-line px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="studentId" value={studentId} />
        <Submit label="Issue a transcript" variant="secondary" />
      </form>
    </Panel>
  );
}

export function ProgressionPanel({
  studentId,
  programmeId,
  academicYearId,
  academicYearLabel,
  recommendation,
  standing,
  reasons,
  mustRepeat,
  finalYear,
}: {
  studentId: string;
  programmeId: string;
  academicYearId: string;
  academicYearLabel: string;
  recommendation: string;
  standing: string;
  reasons: string[];
  mustRepeat: { code: string; credits: number; attempts: number }[];
  finalYear: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(decideProgression, {});
  const [outcome, setOutcome] = useState(recommendation);

  return (
    <Panel
      title={`Progression, ${academicYearLabel}`}
      description={finalYear ? 'Final year of the programme.' : undefined}
      action={<Tag tone={standing === 'GOOD_STANDING' ? 'active' : 'caution'}>{standing.toLowerCase().replace(/_/g, ' ')}</Tag>}
    >
      <div className="space-y-3 px-4 py-4">
        <div>
          <p className="text-sm">
            Recommended: <span className="font-medium">{recommendation.toLowerCase().replace(/_/g, ' ')}</span>
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        {mustRepeat.length > 0 && (
          <p className="text-sm text-muted">
            Outstanding:{' '}
            {mustRepeat
              .map((entry) => `${entry.code} (${entry.credits} credits, attempt ${entry.attempts})`)
              .join(', ')}
          </p>
        )}

        <form action={action} className="space-y-3 border-t border-line pt-3">
          <FormMessage status={state.status} message={state.message} />
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="programmeId" value={programmeId} />
          <input type="hidden" name="academicYearId" value={academicYearId} />

          <Field label="Decision" htmlFor="outcome">
            <Select id="outcome" name="outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="PROGRESS">Progress</option>
              <option value="PROGRESS_WITH_CONDITIONS">Progress with conditions</option>
              <option value="REPEAT_MODULES">Repeat modules</option>
              <option value="REPEAT_YEAR">Repeat the year</option>
              <option value="EXCLUDE">Exclude</option>
              <option value="GRADUATE">Graduate</option>
            </Select>
          </Field>

          {outcome !== recommendation && (
            <p className="border-l-2 border-caution bg-caution/5 px-3 py-2 text-sm text-caution">
              This differs from the recommendation. Record why, since an appeal turns on this note.
            </p>
          )}

          <Field
            label="Notes"
            htmlFor="notes"
            hint={outcome !== recommendation ? 'Required when overriding' : 'Optional'}
          >
            <Textarea id="notes" name="notes" rows={3} required={outcome !== recommendation} />
          </Field>

          <Submit label="Record decision" />
        </form>
      </div>
    </Panel>
  );
}

export function IssueCertificatePanel({
  studentId,
  eligible,
  blockers,
}: {
  studentId: string;
  eligible: boolean;
  blockers: string[];
}) {
  const [state, action] = useActionState<FormState, FormData>(issueCredential, {});
  const [kind, setKind] = useState('QUALIFICATION');

  return (
    <Panel title="Issue a certificate">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="studentId" value={studentId} />

        {!eligible && kind === 'QUALIFICATION' && blockers.length > 0 && (
          <div className="border-l-2 border-caution bg-caution/5 px-3 py-2 text-sm text-caution">
            <p>This learner has not met the qualification yet:</p>
            <ul className="mt-1 list-disc pl-5">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}

        <Field label="What is being awarded" htmlFor="kind">
          <Select id="kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="QUALIFICATION">Qualification certificate</option>
            <option value="SHORT_COURSE">Short course certificate</option>
            <option value="MICRO_CREDENTIAL">Micro-credential</option>
            <option value="BADGE">Badge</option>
            <option value="COMPLETION">Completion record</option>
            <option value="ATTENDANCE">Attendance certificate</option>
          </Select>
        </Field>

        {kind !== 'QUALIFICATION' && (
          <Field label="Title" htmlFor="title" hint="What the certificate says the learner completed">
            <Input id="title" name="title" />
          </Field>
        )}

        {kind === 'QUALIFICATION' && !eligible && (
          <Field
            label="Reason for issuing anyway"
            htmlFor="overrideReason"
            hint="Recorded on the certificate and in the audit log"
          >
            <Textarea id="overrideReason" name="overrideReason" rows={2} />
          </Field>
        )}

        <Submit label="Issue certificate" />
      </form>
    </Panel>
  );
}
