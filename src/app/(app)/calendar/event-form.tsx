'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { addEvent } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : 'Add to the calendar'}
    </Button>
  );
}

export function NewEventForm() {
  const [state, action] = useActionState<FormState, FormData>(addEvent, {});

  return (
    <Panel title="Add an event">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="event-title" error={state.fieldErrors?.title}>
            <Input id="event-title" name="title" required />
          </Field>
          <Field label="Where" htmlFor="location" hint="Optional">
            <Input id="location" name="location" />
          </Field>
          <Field label="Starts" htmlFor="startsAt">
            <Input id="startsAt" name="startsAt" type="datetime-local" required />
          </Field>
          <Field label="Ends" htmlFor="endsAt">
            <Input id="endsAt" name="endsAt" type="datetime-local" required />
          </Field>
          <Field label="Type" htmlFor="event-type">
            <Select id="event-type" name="type" defaultValue="ACADEMIC_EVENT">
              <option value="ACADEMIC_EVENT">Academic event</option>
              <option value="LECTURE">Class</option>
              <option value="TUTORIAL">Tutorial</option>
              <option value="MEETING">Meeting</option>
              <option value="EXAMINATION">Examination</option>
              <option value="DEADLINE">Deadline</option>
              <option value="HOLIDAY">Holiday</option>
            </Select>
          </Field>
          <Field label="Who sees it" htmlFor="visibility">
            <Select id="visibility" name="visibility" defaultValue="INSTITUTION">
              <option value="INSTITUTION">Everyone</option>
              <option value="FACULTY">The faculty</option>
              <option value="PROGRAMME">The programme</option>
              <option value="COURSE">The course</option>
              <option value="PRIVATE">Only me</option>
            </Select>
          </Field>
        </div>

        <Field label="Detail" htmlFor="description" hint="Optional">
          <Textarea id="description" name="description" rows={2} />
        </Field>

        <Checkbox id="allDay" name="allDay" label="All day" />

        <Submit />
      </form>
    </Panel>
  );
}
