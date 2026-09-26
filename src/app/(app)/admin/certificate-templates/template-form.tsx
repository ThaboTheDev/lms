'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { saveTemplate } from './actions';

const KINDS = [
  ['QUALIFICATION', 'Qualification'],
  ['SHORT_COURSE', 'Short course'],
  ['MICRO_CREDENTIAL', 'Micro-credential'],
  ['BADGE', 'Badge'],
  ['COMPLETION', 'Course completion'],
  ['ATTENDANCE', 'Attendance'],
] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving' : label}</Button>;
}

export interface TemplateValues {
  id: string;
  name: string;
  kind: string;
  bodyHtml: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  signatureFileId: string | null;
  backgroundFileId: string | null;
  isDefault: boolean;
}

export function TemplateForm({ template, defaultBody, placeholders }: { template?: TemplateValues; defaultBody: string; placeholders: [string, string][] }) {
  const [state, action] = useActionState<FormState, FormData>(saveTemplate, {});
  const id = template?.id ?? 'new';
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><FormMessage status={state.status} message={state.message} /></div>
      {template && <input type="hidden" name="templateId" value={template.id} />}
      <Field label="Name" htmlFor={`name-${id}`}>
        <Input id={`name-${id}`} name="name" required defaultValue={template?.name} placeholder="Higher certificate" />
      </Field>
      <Field label="For" htmlFor={`kind-${id}`}>
        <Select id={`kind-${id}`} name="kind" defaultValue={template?.kind ?? 'QUALIFICATION'}>
          {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field
          label="Wording"
          htmlFor={`body-${id}`}
          hint={`One printed line per line. A line that is just {{name}} or {{title}} is set large. Placeholders: ${placeholders.map(([key]) => key).join(' ')}`}
        >
          <Textarea id={`body-${id}`} name="bodyHtml" rows={5} defaultValue={template?.bodyHtml ?? defaultBody} className="font-mono text-xs" />
        </Field>
      </div>
      <Field label="Signed by" htmlFor={`signatoryName-${id}`}>
        <Input id={`signatoryName-${id}`} name="signatoryName" defaultValue={template?.signatoryName ?? ''} placeholder="Dr P. Ndlovu" />
      </Field>
      <Field label="Their title" htmlFor={`signatoryTitle-${id}`}>
        <Input id={`signatoryTitle-${id}`} name="signatoryTitle" defaultValue={template?.signatoryTitle ?? ''} placeholder="Registrar" />
      </Field>
      <Field label="Signature image" htmlFor={`signature-${id}`} hint={template?.signatureFileId ? 'One is set. Upload another to replace it.' : 'PNG or JPEG, on a white or transparent background.'}>
        <FileUploader inputId={`signature-${id}`} name="signatureFileId" folder="branding" accept="image/png,image/jpeg" label="Choose an image" />
        {template?.signatureFileId && <Checkbox id={`signatureClear-${id}`} name="signatureFileIdClear" label="Remove the signature" />}
      </Field>
      <Field label="Background" htmlFor={`background-${id}`} hint={template?.backgroundFileId ? 'One is set. Upload another to replace it.' : 'Optional: an A4 landscape PNG or JPEG replaces the printed border.'}>
        <FileUploader inputId={`background-${id}`} name="backgroundFileId" folder="branding" accept="image/png,image/jpeg" label="Choose an image" />
        {template?.backgroundFileId && <Checkbox id={`backgroundClear-${id}`} name="backgroundFileIdClear" label="Remove the background" />}
      </Field>
      <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
        <Checkbox id={`isDefault-${id}`} name="isDefault" label="Use it for this kind of credential unless another is chosen" defaultChecked={template?.isDefault ?? false} />
        <Submit label={template ? 'Save' : 'Create the template'} />
      </div>
    </form>
  );
}
