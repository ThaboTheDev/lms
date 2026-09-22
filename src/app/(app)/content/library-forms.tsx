'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { addAsset, addFolder } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

export function AddAssetForm({ folders }: { folders: { id: string; path: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(addAsset, {});

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />

      <Field label="File" htmlFor="fileId-input" error={state.fieldErrors?.fileId}>
        <FileUploader name="fileId" folder="library" label="Choose a file to upload" />
      </Field>

      <Field label="Title" htmlFor="asset-title" error={state.fieldErrors?.title}>
        <Input id="asset-title" name="title" required />
      </Field>

      <Field label="Description" htmlFor="asset-description" hint="Optional">
        <Textarea id="asset-description" name="description" rows={2} />
      </Field>

      <Field label="Tags" htmlFor="asset-tags" hint="Separate with commas">
        <Input id="asset-tags" name="tags" placeholder="accounting, week 1, handout" />
      </Field>

      <Field label="Folder" htmlFor="asset-folder" hint="Optional">
        <Select id="asset-folder" name="folderId" defaultValue="">
          <option value="">No folder</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
        </Select>
      </Field>

      <Checkbox
        id="isRestricted"
        name="isRestricted"
        label="Restricted: staff only, never attached to a learner-facing lesson"
      />

      <Submit label="Add to library" />
    </form>
  );
}

export function AddFolderForm({ folders }: { folders: { id: string; path: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(addFolder, {});

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />

      <Field label="Folder name" htmlFor="folder-name" error={state.fieldErrors?.name}>
        <Input id="folder-name" name="name" required placeholder="Accounting handouts" />
      </Field>

      <Field label="Inside" htmlFor="folder-parent" hint="Optional">
        <Select id="folder-parent" name="parentId" defaultValue="">
          <option value="">Top level</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
        </Select>
      </Field>

      <Submit label="Create folder" />
    </form>
  );
}
