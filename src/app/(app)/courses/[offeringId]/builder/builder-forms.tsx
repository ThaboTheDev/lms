'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { addLesson, addLessonBlock, addSection } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

export function AddSectionForm({ offeringId }: { offeringId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addSection, {});
  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <Field label="Section title" htmlFor="section-title" error={state.fieldErrors?.title}>
        <Input id="section-title" name="title" required placeholder="Week 1: What management is" />
      </Field>
      <Field label="Summary" htmlFor="section-summary" hint="Optional, shown under the title">
        <Input id="section-summary" name="summary" />
      </Field>
      <Submit label="Add section" />
    </form>
  );
}

export function AddLessonForm({ offeringId, sectionId }: { offeringId: string; sectionId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addLesson, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="sectionId" value={sectionId} />

      <div className="min-w-[12rem] flex-1">
        <label htmlFor={`lesson-title-${sectionId}`} className="block text-sm font-medium">
          New lesson
        </label>
        <Input
          id={`lesson-title-${sectionId}`}
          name="title"
          required
          placeholder="Lesson title"
          className="mt-1 h-9"
        />
      </div>

      <div>
        <label htmlFor={`lesson-type-${sectionId}`} className="sr-only">
          Lesson type
        </label>
        <Select id={`lesson-type-${sectionId}`} name="type" defaultValue="PAGE" className="h-9 w-40">
          <option value="PAGE">Reading</option>
          <option value="VIDEO">Video</option>
          <option value="AUDIO">Audio</option>
          <option value="DOCUMENT">Document</option>
          <option value="EXTERNAL_LINK">Link</option>
          <option value="LIVE_SESSION">Live class</option>
          <option value="DISCUSSION">Discussion</option>
          <option value="SCORM">Interactive package</option>
          <option value="H5P">Activity</option>
          <option value="SURVEY">Survey</option>
        </Select>
      </div>

      <div className="w-24">
        <label htmlFor={`lesson-minutes-${sectionId}`} className="sr-only">
          Estimated minutes
        </label>
        <Input
          id={`lesson-minutes-${sectionId}`}
          name="estimatedMinutes"
          type="number"
          min={0}
          max={600}
          placeholder="min"
          className="h-9"
        />
      </div>

      <Checkbox id={`lesson-mandatory-${sectionId}`} name="isMandatory" defaultChecked label="Required" />

      <Submit label="Add lesson" />
      {state.message && (
        <div className="w-full">
          <FormMessage status={state.status} message={state.message} />
        </div>
      )}
    </form>
  );
}

const FILE_KINDS = ['FILE', 'IMAGE', 'VIDEO', 'AUDIO'];

export function AddBlockForm({ offeringId, lessonId }: { offeringId: string; lessonId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addLessonBlock, {});
  const [kind, setKind] = useState('RICH_TEXT');

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="lessonId" value={lessonId} />

      <Field label="What are you adding?" htmlFor="block-kind">
        <Select id="block-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="RICH_TEXT">Text</option>
          <option value="CALLOUT">Callout</option>
          <option value="FILE">Document or slides</option>
          <option value="IMAGE">Image</option>
          <option value="VIDEO">Video</option>
          <option value="AUDIO">Audio</option>
          <option value="LINK">Link</option>
          <option value="EMBED">Embedded page</option>
        </Select>
      </Field>

      {(kind === 'RICH_TEXT' || kind === 'CALLOUT') && (
        <Field
          label={kind === 'CALLOUT' ? 'Callout text' : 'Text'}
          htmlFor="block-text"
          hint={kind === 'RICH_TEXT' ? 'Leave a blank line between paragraphs' : undefined}
          error={state.fieldErrors?.text}
        >
          <Textarea id="block-text" name="text" rows={6} />
        </Field>
      )}

      {(kind === 'LINK' || kind === 'EMBED') && (
        <Field label="Web address" htmlFor="block-url" error={state.fieldErrors?.url}>
          <Input id="block-url" name="url" type="url" placeholder="https://" />
        </Field>
      )}

      {FILE_KINDS.includes(kind) && (
        <Field label="File" htmlFor="fileId-input" error={state.fieldErrors?.fileId}>
          <FileUploader name="fileId" folder="course-content" label="Choose a file to upload" />
        </Field>
      )}

      <Submit label="Add to lesson" />
    </form>
  );
}
