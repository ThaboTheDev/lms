'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Select } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { uploadProof } from '../finance/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending' : 'Send for review'}
    </Button>
  );
}

export function ProofOfPaymentForm({ invoices }: { invoices: { id: string; label: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(uploadProof, {});

  return (
    <Panel
      title="Send proof of payment"
      description="Your account is credited once the finance office has checked the document."
    >
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <Field label="The document" htmlFor="fileId-input">
          <FileUploader name="fileId" folder="proof-of-payment" label="Your bank slip or screenshot" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount paid" htmlFor="declaredAmount" hint="In rands">
            <Input id="declaredAmount" name="declaredAmount" type="number" min={0} step="0.01" required />
          </Field>
          <Field label="Date paid" htmlFor="declaredDate">
            <Input id="declaredDate" name="declaredDate" type="date" required />
          </Field>
          <Field label="Reference used" htmlFor="reference" hint="What you typed into your bank">
            <Input id="reference" name="reference" />
          </Field>
          {invoices.length > 0 && (
            <Field label="Against which invoice" htmlFor="invoiceId" hint="Optional">
              <Select id="invoiceId" name="invoiceId" defaultValue="">
                <option value="">Not sure</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>{invoice.label}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Submit />
      </form>
    </Panel>
  );
}
