'use client';

import { FileUploader } from '@/components/ui/file-uploader';
import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { newConversation, sendReply } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Sending' : label}
    </Button>
  );
}

export function NewMessageForm({
  recipients,
}: {
  recipients: { id: string; firstName: string; lastName: string; email: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(newConversation, {});

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />

      <Field label="To" htmlFor="recipientId">
        <Select id="recipientId" name="recipientId" required defaultValue="">
          <option value="" disabled>
            Choose a person
          </option>
          {recipients.map((person) => (
            <option key={person.id} value={person.id}>
              {person.lastName}, {person.firstName}
            </option>
          ))}
        </Select>
      </Field>

      {recipients.length === 0 && (
        <p className="text-sm text-muted">
          There is nobody you can message yet. Once you are registered for courses, your lecturers
          and the administration appear here.
        </p>
      )}

      <Field label="Subject" htmlFor="subject" hint="Optional, taken from your first line if blank">
        <Input id="subject" name="subject" />
      </Field>

      <Field label="Message" htmlFor="body">
        <Textarea id="body" name="body" rows={5} required />
      </Field>

      <FileUploader name="fileId" folder="messages" label="Attach a file (optional)" />
      <Submit label="Send" />
    </form>
  );
}

export function ReplyForm({ threadId }: { threadId: string }) {
  const [state, action] = useActionState<FormState, FormData>(sendReply, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await action(formData);
        formRef.current?.reset();
      }}
      className="space-y-3 border-t border-line px-4 py-4"
    >
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="threadId" value={threadId} />

      <Field label="Reply" htmlFor="reply-body">
        <Textarea id="reply-body" name="body" rows={3} required />
      </Field>

      <FileUploader name="fileId" folder="messages" label="Attach a file (optional)" />
      <Submit label="Send reply" />
    </form>
  );
}
