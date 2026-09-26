'use client';

import { FileUploader } from '@/components/ui/file-uploader';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { raiseTicket, reply, changeStatus, assign } from './actions';

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

/** Raising a ticket. Deliberately short: nobody in distress fills in a long form. */
export function RaiseTicketForm() {
  const [state, action] = useActionState<FormState, FormData>(raiseTicket, {});

  return (
    <Panel
      title="Ask for help"
      description="One thread per problem, so it can be answered once and quoted by number."
    >
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <Field label="What is wrong" htmlFor="subject" error={state.fieldErrors?.subject}>
          <Input id="subject" name="subject" required maxLength={140} />
        </Field>

        <Field label="Tell us more" htmlFor="description" error={state.fieldErrors?.description}>
          <Textarea id="description" name="description" rows={5} required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What it is about" htmlFor="category">
            <Select id="category" name="category" defaultValue="GENERAL">
              <option value="TECHNICAL">Technical</option>
              <option value="ACADEMIC">Academic</option>
              <option value="FINANCE">Finance</option>
              <option value="REGISTRATION">Registration</option>
              <option value="GENERAL">Something else</option>
            </Select>
          </Field>

          <Field label="How urgent" htmlFor="priority" hint="Urgent means you cannot work at all.">
            <Select id="priority" name="priority" defaultValue="NORMAL">
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          </Field>
        </div>

        <FileUploader name="fileId" folder="support" label="Attach a screenshot or document (optional)" />
        <Submit idle="Send it" busy="Sending" />
      </form>
    </Panel>
  );
}

export function ReplyForm({ ticketId, canNote }: { ticketId: string; canNote: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(reply, {});

  return (
    <Panel title="Reply">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="ticketId" value={ticketId} />

        <Field label="Your reply" htmlFor="body" error={state.fieldErrors?.body}>
          <Textarea id="body" name="body" rows={4} required />
        </Field>

        {canNote && (
          <Checkbox
            id="internal"
            name="internal"
            label="Internal note, not shown to the person who raised this"
          />
        )}

        <FileUploader name="fileId" folder="support" label="Attach a file (optional)" />
        <Submit idle="Send reply" busy="Sending" />
      </form>
    </Panel>
  );
}

/** Staff controls: where the ticket is, and whose desk it is on. */
export function TicketAdminForm({
  ticketId,
  status,
  assigneeId,
  staff,
}: {
  ticketId: string;
  status: string;
  assigneeId: string | null;
  staff: { id: string; label: string }[];
}) {
  const [statusState, statusAction] = useActionState<FormState, FormData>(changeStatus, {});
  const [assignState, assignAction] = useActionState<FormState, FormData>(assign, {});

  return (
    <Panel title="Work the ticket">
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <form action={statusAction} className="space-y-3">
          <FormMessage status={statusState.status} message={statusState.message} />
          <input type="hidden" name="ticketId" value={ticketId} />

          <Field label="Where it stands" htmlFor="status">
            <Select id="status" name="status" defaultValue={status}>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="WAITING_ON_REQUESTER">Waiting on the person who raised it</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </Select>
          </Field>

          <Submit idle="Save status" busy="Saving" />
        </form>

        <form action={assignAction} className="space-y-3">
          <FormMessage status={assignState.status} message={assignState.message} />
          <input type="hidden" name="ticketId" value={ticketId} />

          <Field label="Who is handling it" htmlFor="assigneeId">
            <Select id="assigneeId" name="assigneeId" defaultValue={assigneeId ?? ''}>
              <option value="">Nobody yet</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </Select>
          </Field>

          <Submit idle="Assign" busy="Saving" />
        </form>
      </div>
    </Panel>
  );
}
