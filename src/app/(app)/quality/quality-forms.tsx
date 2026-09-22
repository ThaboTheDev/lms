'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { addDocument, closeReview, planReview } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

const CATEGORIES = [
  ['CURRICULUM', 'Approved curriculum and outcomes'],
  ['ASSESSMENT_POLICY', 'Assessment policy'],
  ['MODERATION', 'Moderation records'],
  ['RESULTS', 'Results and pass rates'],
  ['STAFF', 'Staff qualifications'],
  ['LEARNER_FEEDBACK', 'Learner feedback'],
  ['RESOURCES', 'Teaching and learning resources'],
] as const;

export function QaDocumentForm({ programmes }: { programmes: { id: string; label: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(addDocument, {});

  return (
    <Panel title="File evidence">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <Field label="Title" htmlFor="doc-title">
          <Input id="doc-title" name="title" required placeholder="Assessment policy 2026" />
        </Field>

        <Field label="What it is" htmlFor="category">
          <Select id="category" name="category" defaultValue="CURRICULUM">
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Programme" htmlFor="doc-programme" hint="Optional">
          <Select id="doc-programme" name="programmeId" defaultValue="">
            <option value="">Institution wide</option>
            {programmes.map((programme) => (
              <option key={programme.id} value={programme.id}>{programme.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="Document" htmlFor="fileId-input" hint="Optional">
          <FileUploader name="fileId" folder="quality" label="Upload the document" />
        </Field>

        <Submit label="File it" />
      </form>
    </Panel>
  );
}

export function ReviewForms({
  programmes,
  openReviews,
}: {
  programmes: { id: string; label: string }[];
  openReviews: { id: string; label: string }[];
}) {
  const [planState, plan] = useActionState<FormState, FormData>(planReview, {});
  const [closeState, close] = useActionState<FormState, FormData>(closeReview, {});

  return (
    <div className="space-y-6">
      <Panel title="Plan a review">
        <form action={plan} className="space-y-3 px-4 py-4">
          <FormMessage status={planState.status} message={planState.message} />

          <Field label="Programme" htmlFor="review-programme">
            <Select id="review-programme" name="programmeId" required defaultValue="">
              <option value="" disabled>Choose a programme</option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>{programme.label}</option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cycle" htmlFor="cycle" hint="For example 2026 or 2024 to 2026">
              <Input id="cycle" name="cycle" defaultValue={String(new Date().getFullYear())} />
            </Field>
            <Field label="Due" htmlFor="dueOn">
              <Input id="dueOn" name="dueOn" type="date" />
            </Field>
          </div>

          <Submit label="Plan review" />
        </form>
      </Panel>

      {openReviews.length > 0 && (
        <Panel title="Close a review">
          <form action={close} className="space-y-3 px-4 py-4">
            <FormMessage status={closeState.status} message={closeState.message} />

            <Field label="Review" htmlFor="reviewId">
              <Select id="reviewId" name="reviewId" required defaultValue="">
                <option value="" disabled>Choose a review</option>
                {openReviews.map((review) => (
                  <option key={review.id} value={review.id}>{review.label}</option>
                ))}
              </Select>
            </Field>

            <Field label="What the review found" htmlFor="findings">
              <Textarea id="findings" name="findings" rows={3} required />
            </Field>

            <Field label="What will be done about it" htmlFor="actions">
              <Textarea id="actions" name="actions" rows={3} required />
            </Field>

            <Submit label="Close review" />
          </form>
        </Panel>
      )}
    </div>
  );
}
