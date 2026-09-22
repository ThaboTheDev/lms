'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Panel } from '@/components/ui/primitives';
import { FormMessage, Textarea } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { attachWork, finishAttempt } from '../../actions';

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? 'Working' : label}
    </Button>
  );
}

export function AssignmentSubmission({
  submissionId,
  offeringId,
  assessmentId,
  instructions,
  files,
}: {
  submissionId: string;
  offeringId: string;
  assessmentId: string;
  instructions: string | null;
  files: { fileId: string; name: string; size: string }[];
}) {
  const [attachState, attach] = useActionState<FormState, FormData>(attachWork, {});
  const [submitState, submit] = useActionState<FormState, FormData>(finishAttempt, {});

  return (
    <div className="space-y-6">
      {instructions && (
        <Panel title="Instructions">
          <p className="whitespace-pre-line px-4 py-4 text-sm leading-relaxed">{instructions}</p>
        </Panel>
      )}

      <Panel title="Your work" description={`${files.length} files attached`}>
        {files.length > 0 && (
          <ul className="divide-y divide-line">
            {files.map((file) => (
              <li key={file.fileId} className="flex items-center justify-between px-4 py-3 text-sm">
                <a href={`/api/v1/files/${file.fileId}/download`} className="text-accent underline underline-offset-2">
                  {file.name}
                </a>
                <span className="text-xs text-muted">{file.size}</span>
              </li>
            ))}
          </ul>
        )}

        <form action={attach} className="space-y-3 border-t border-line px-4 py-4">
          <FormMessage status={attachState.status} message={attachState.message} />
          <input type="hidden" name="submissionId" value={submissionId} />
          <input type="hidden" name="offeringId" value={offeringId} />

          <Field label="Add a file" htmlFor="fileId-input">
            <FileUploader name="fileId" folder="submissions" label="Choose your file" />
          </Field>

          <Submit label="Attach this file" variant="secondary" />
        </form>
      </Panel>

      <form action={submit} className="space-y-3">
        <FormMessage status={submitState.status} message={submitState.message} />
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="offeringId" value={offeringId} />
        <input type="hidden" name="assessmentId" value={assessmentId} />

        <Field label="Comments for your lecturer" htmlFor="comment" hint="Optional">
          <Textarea id="comment" name="comment" rows={3} />
        </Field>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <p className="text-sm text-muted">
            You can replace your files until you submit. After that, ask your lecturer to reopen it.
          </p>
          <Submit label="Submit for marking" />
        </div>
      </form>
    </div>
  );
}
