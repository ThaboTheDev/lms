'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { addSession, checkIn, takeRegister } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

export function NewSessionForm({ offeringId }: { offeringId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addSession, {});

  return (
    <Panel title="Add a session">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="offeringId" value={offeringId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="session-title">
            <Input id="session-title" name="title" required placeholder="Week 3 lecture" />
          </Field>
          <Field label="Where" htmlFor="venue" hint="Optional">
            <Input id="venue" name="venue" />
          </Field>
          <Field label="Starts" htmlFor="scheduledStart">
            <Input id="scheduledStart" name="scheduledStart" type="datetime-local" required />
          </Field>
          <Field label="Ends" htmlFor="scheduledEnd">
            <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" required />
          </Field>
          <Field label="Mode" htmlFor="mode">
            <Select id="mode" name="mode" defaultValue="IN_PERSON">
              <option value="IN_PERSON">In person</option>
              <option value="ONLINE">Online</option>
              <option value="HYBRID">Hybrid</option>
            </Select>
          </Field>
        </div>

        <Checkbox
          id="selfCheckInEnabled"
          name="selfCheckInEnabled"
          label="Let learners check themselves in with a code, from shortly before the session until part way through"
        />

        <Submit label="Add session" />
      </form>
    </Panel>
  );
}

export function RegisterForm({
  sessionId,
  offeringId,
  records,
}: {
  sessionId: string;
  offeringId: string;
  records: {
    student: { id: string; studentNumber: string; user: { firstName: string; lastName: string } };
    status: string;
    method: string;
  }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(takeRegister, {});

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="offeringId" value={offeringId} />

      <ul className="divide-y divide-line border border-line bg-surface">
        {records.map((record) => (
          <li key={record.student.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm">
              {record.student.user.lastName}, {record.student.user.firstName}
              <span className="block text-xs tabular-nums text-muted">
                {record.student.studentNumber}
                {record.method === 'SELF_CHECK_IN' ? ' · checked in' : ''}
              </span>
            </span>

            <fieldset className="flex items-center gap-3">
              <legend className="sr-only">
                Attendance for {record.student.user.firstName} {record.student.user.lastName}
              </legend>
              {[
                { value: 'PRESENT', label: 'Present' },
                { value: 'LATE', label: 'Late' },
                { value: 'ABSENT', label: 'Absent' },
                { value: 'EXCUSED', label: 'Excused' },
              ].map((option) => (
                <label key={option.value} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={`status[${record.student.id}]`}
                    value={option.value}
                    defaultChecked={record.status === option.value}
                    className="accent-[rgb(var(--brand))]"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ul>

      <Submit label="Save the register" />
    </form>
  );
}

export function CheckInForm({
  sessionId,
  offeringId,
  status,
}: {
  sessionId: string;
  offeringId: string;
  status: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(checkIn, {});

  if (status === 'PRESENT' || status === 'LATE') {
    return (
      <p className="border-l-2 border-brand bg-brand/5 px-4 py-3 text-sm text-brand">
        You are marked {status.toLowerCase()} for this session.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3 border border-line bg-surface px-4 py-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="offeringId" value={offeringId} />

      <Field label="Check-in code" htmlFor="code" hint="Your lecturer reads it out at the start">
        <Input id="code" name="code" required autoComplete="off" className="w-40 font-serif text-lg tracking-widest" />
      </Field>

      <Submit label="Check in" />
    </form>
  );
}
