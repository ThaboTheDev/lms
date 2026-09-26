'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { uploadPackage } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Adding' : 'Add the package'}</Button>;
}

export function PackageUploadForm({ offeringId }: { offeringId: string }) {
  const [state, action] = useActionState<FormState, FormData>(uploadPackage, {});
  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <Field label="Package file" htmlFor="fileId-input" hint="A SCORM 1.2 or 2004 ZIP, or an .h5p file." error={state.fieldErrors?.fileId}>
        <FileUploader name="fileId" folder="packages" accept=".zip,.h5p,application/zip" label="Choose the package" />
      </Field>
      <Field label="Title" htmlFor="package-title" hint="Leave blank to use the title inside the package.">
        <Input id="package-title" name="title" />
      </Field>
      <Submit />
    </form>
  );
}
