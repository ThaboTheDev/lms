'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { addFee } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : 'Add fee'}
    </Button>
  );
}

export function NewFeeForm({
  programmes,
  years,
}: {
  programmes: { id: string; label: string }[];
  years: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(addFee, {});

  return (
    <Panel title="Add a fee">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="fee-name">
            <Input id="fee-name" name="name" required placeholder="Higher Certificate tuition" />
          </Field>
          <Field label="Type" htmlFor="feeType">
            <Select id="feeType" name="feeType" defaultValue="TUITION">
              <option value="TUITION">Tuition</option>
              <option value="REGISTRATION">Registration</option>
              <option value="APPLICATION">Application</option>
              <option value="COURSE">Course</option>
              <option value="EXAMINATION">Examination</option>
              <option value="CERTIFICATE">Certificate</option>
              <option value="RESIT">Resit</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Amount" htmlFor="amount" hint="In rands">
            <Input id="amount" name="amount" type="number" min={0} step="0.01" required />
          </Field>
          <Field label="Programme" htmlFor="programmeId" hint="Optional">
            <Select id="programmeId" name="programmeId" defaultValue="">
              <option value="">Any programme</option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>{programme.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Academic year" htmlFor="academicYearId" hint="Optional">
            <Select id="academicYearId" name="academicYearId" defaultValue="">
              <option value="">Any year</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>{year.label}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Submit />
      </form>
    </Panel>
  );
}
