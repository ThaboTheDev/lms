'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { publish } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending' : 'Publish'}
    </Button>
  );
}

export function AnnouncementForm({
  offerings,
  programmes,
}: {
  offerings: { id: string; label: string }[];
  programmes: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(publish, {});
  const [audience, setAudience] = useState('INSTITUTION');

  return (
    <Panel title="Write an announcement" description="Publishing notifies the audience once.">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <Field label="Title" htmlFor="title" error={state.fieldErrors?.title}>
          <Input id="title" name="title" required />
        </Field>

        <Field label="Announcement" htmlFor="body" error={state.fieldErrors?.body}>
          <Textarea id="body" name="body" rows={5} required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who it goes to" htmlFor="audience">
            <Select
              id="audience"
              name="audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            >
              <option value="INSTITUTION">Everyone at the institution</option>
              <option value="COURSE">Everyone taking a course</option>
              <option value="PROGRAMME">Everyone on a programme</option>
            </Select>
          </Field>

          {audience === 'COURSE' && (
            <Field label="Course" htmlFor="offeringId">
              <Select id="offeringId" name="offeringId" required defaultValue="">
                <option value="" disabled>Choose a course</option>
                {offerings.map((offering) => (
                  <option key={offering.id} value={offering.id}>{offering.label}</option>
                ))}
              </Select>
            </Field>
          )}

          {audience === 'PROGRAMME' && (
            <Field label="Programme" htmlFor="programmeId">
              <Select id="programmeId" name="programmeId" required defaultValue="">
                <option value="" disabled>Choose a programme</option>
                {programmes.map((programme) => (
                  <option key={programme.id} value={programme.id}>{programme.label}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Checkbox id="isPinned" name="isPinned" label="Pin to the top" />
        <Checkbox id="draft" name="draft" label="Save as a draft, notifying nobody yet" />

        <Submit />
      </form>
    </Panel>
  );
}
