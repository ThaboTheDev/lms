'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { addPaymentPlan, capturePayment, raiseInvoice } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

const FEE_TYPES = [
  ['TUITION', 'Tuition'],
  ['REGISTRATION', 'Registration'],
  ['APPLICATION', 'Application'],
  ['COURSE', 'Course'],
  ['EXAMINATION', 'Examination'],
  ['CERTIFICATE', 'Certificate'],
  ['RESIT', 'Resit'],
  ['OTHER', 'Other'],
] as const;

export function NewInvoiceForm({ students }: { students: { id: string; label: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(raiseInvoice, {});

  return (
    <Panel title="Raise an invoice" description="The totals are worked out from the line, not typed in.">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <Field label="Learner" htmlFor="studentId">
          <Select id="studentId" name="studentId" required defaultValue="">
            <option value="" disabled>Choose a learner</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>{student.label}</option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What is being charged" htmlFor="description">
            <Input id="description" name="description" required placeholder="Tuition, semester 1" />
          </Field>
          <Field label="Fee type" htmlFor="feeType">
            <Select id="feeType" name="feeType" defaultValue="TUITION">
              {FEE_TYPES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount each" htmlFor="amount" hint="In rands">
            <Input id="amount" name="amount" type="number" min={0} step="0.01" required />
          </Field>
          <Field label="Quantity" htmlFor="quantity">
            <Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} />
          </Field>
          <Field label="Due" htmlFor="dueOn">
            <Input id="dueOn" name="dueOn" type="date" />
          </Field>
          <Field label="Discount" htmlFor="discountPercent" hint="Percentage, optional">
            <Input id="discountPercent" name="discountPercent" type="number" min={0} max={100} />
          </Field>
        </div>

        <Field label="Notes" htmlFor="notes" hint="Shown on the invoice">
          <Textarea id="notes" name="notes" rows={2} />
        </Field>

        <Submit label="Raise invoice" />
      </form>
    </Panel>
  );
}

export function CapturePaymentForm({
  studentId,
  invoiceId,
  balance,
}: {
  studentId: string;
  invoiceId: string;
  balance: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(capturePayment, {});

  return (
    <Panel title="Record a payment" description="A receipt is issued at the same time.">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" htmlFor="amount" hint={`Outstanding: R${balance.toFixed(2)}`}>
            <Input id="amount" name="amount" type="number" min={0} step="0.01" defaultValue={balance.toFixed(2)} required />
          </Field>
          <Field label="Paid on" htmlFor="paidOn">
            <Input id="paidOn" name="paidOn" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="How" htmlFor="method">
            <Select id="method" name="method" defaultValue="EFT">
              <option value="EFT">Electronic transfer</option>
              <option value="CARD">Card</option>
              <option value="CASH">Cash</option>
              <option value="DEBIT_ORDER">Debit order</option>
              <option value="BURSARY">Bursary</option>
              <option value="JOURNAL">Journal entry</option>
            </Select>
          </Field>
          <Field label="Reference" htmlFor="reference" hint="As it appears on the statement">
            <Input id="reference" name="reference" />
          </Field>
        </div>

        <Submit label="Record payment" />
      </form>
    </Panel>
  );
}

export function PaymentPlanForm({
  studentId,
  invoiceId,
}: {
  studentId: string;
  invoiceId: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(addPaymentPlan, {});

  return (
    <Panel title="Set up a payment plan" description="The outstanding balance is split across the instalments.">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" htmlFor="plan-name">
            <Input id="plan-name" name="name" defaultValue="Payment plan" />
          </Field>
          <Field label="Instalments" htmlFor="instalments">
            <Input id="instalments" name="instalments" type="number" min={2} max={24} defaultValue={3} />
          </Field>
          <Field label="First due" htmlFor="startsOn">
            <Input id="startsOn" name="startsOn" type="date" required />
          </Field>
        </div>

        <Submit label="Create plan" />
      </form>
    </Panel>
  );
}
