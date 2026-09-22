'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { newThread, postReply, report } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Posting' : label}
    </Button>
  );
}

export function NewThreadForm({
  forumId,
  announcementOnly,
}: {
  forumId: string;
  announcementOnly: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(newThread, {});

  if (announcementOnly) {
    return (
      <Panel title="Start a thread">
        <p className="px-4 py-6 text-sm text-muted">
          Only staff post in this discussion. Message your lecturer if you have a question.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Start a thread">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="forumId" value={forumId} />

        <Field label="Title" htmlFor="thread-title">
          <Input id="thread-title" name="title" required placeholder="What is the question?" />
        </Field>

        <Field label="Your post" htmlFor="thread-body">
          <Textarea id="thread-body" name="body" rows={4} required />
        </Field>

        <Submit label="Post" />
      </form>
    </Panel>
  );
}

export function ReplyForm({ threadId }: { threadId: string }) {
  const [state, action] = useActionState<FormState, FormData>(postReply, {});
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

      <Field label="Reply" htmlFor="discussion-reply">
        <Textarea id="discussion-reply" name="body" rows={3} required />
      </Field>

      <Submit label="Post reply" />
    </form>
  );
}

export function ReportButton({ postId }: { postId: string }) {
  const [state, action] = useActionState<FormState, FormData>(report, {});
  const [open, setOpen] = useState(false);

  if (state.status === 'success') {
    return <p className="text-xs text-muted">{state.message}</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted underline underline-offset-2"
      >
        Report
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="postId" value={postId} />
      <label htmlFor={`reason-${postId}`} className="sr-only">
        What is wrong with this post
      </label>
      <Textarea id={`reason-${postId}`} name="reason" rows={2} required placeholder="What is wrong with it?" />
      <div className="flex gap-2">
        <Submit label="Send report" />
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
