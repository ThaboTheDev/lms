'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { reviewPop } from '../../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording' : 'Record decision'}
    </Button>
  );
}

export function ReviewForm({
  popId,
  declaredAmount,
  transitions,
  alreadyPaid,
}: {
  popId: string;
  declaredAmount: number;
  transitions: { to: string; label: string; requiresNote: boolean }[];
  alreadyPaid: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(reviewPop, {});
  const [status, setStatus] = useState(transitions[0]?.to ?? '');

  if (transitions.length === 0) {
    return (
      <Panel title="Decision">
        <p className="px-4 py-6 text-sm text-muted">
          This document has been approved and the payment recorded. Reversing it is a refund or a
          credit note, both of which leave their own trail.
        </p>
      </Panel>
    );
  }

  const selected = transitions.find((transition) => transition.to === status);

  return (
    <Panel title="Decision">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="popId" value={popId} />

        <Field label="Outcome" htmlFor="status">
          <Select id="status" name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {transitions.map((transition) => (
              <option key={transition.to} value={transition.to}>{transition.label}</option>
            ))}
          </Select>
        </Field>

        {status === 'APPROVED' && !alreadyPaid && (
          <>
            <Field
              label="Amount to credit"
              htmlFor="amount"
              hint="Change it if the document shows something different"
            >
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min={0}
                defaultValue={declaredAmount.toFixed(2)}
              />
            </Field>
            <Field label="How it was paid" htmlFor="method">
              <Select id="method" name="method" defaultValue="EFT">
                <option value="EFT">Electronic transfer</option>
                <option value="CASH">Cash deposit</option>
                <option value="CARD">Card</option>
                <option value="BURSARY">Bursary</option>
              </Select>
            </Field>
            <p className="text-sm text-muted">
              Approving creates the payment, issues a receipt and tells the learner.
            </p>
          </>
        )}

        <Field
          label="Note"
          htmlFor="note"
          hint={selected?.requiresNote ? 'Required, and shown to the learner' : 'Optional'}
        >
          <Textarea id="note" name="note" rows={3} required={selected?.requiresNote} />
        </Field>

        <Submit />
      </form>
    </Panel>
  );
}
