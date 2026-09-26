'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Panel } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { saveLogo } from './actions';

function Submit({ label, name, value, variant = 'primary' }: { label: string; name?: string; value?: string; variant?: 'primary' | 'ghost' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} name={name} value={value} disabled={pending}>
      {label}
    </Button>
  );
}

/** The logo on every screen, the sign-in page, emails and certificates. */
export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(saveLogo, {});
  return (
    <Panel title="Logo" description="A square PNG, JPEG or WebP of at least 256 pixels works best. It replaces the built-in crest.">
      <form action={action} className="flex flex-wrap items-end gap-4 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <div className="flex h-20 w-20 items-center justify-center rounded-md border border-line bg-white">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="The current logo" className="max-h-16 max-w-16 object-contain" />
          ) : (
            <span className="text-center text-xs text-muted">built-in crest</span>
          )}
        </div>
        <div className="min-w-[16rem] flex-1">
          <FileUploader name="logoFileId" folder="branding" accept="image/png,image/jpeg,image/webp,image/gif" label="Choose an image" />
        </div>
        <Submit label="Save the logo" />
        {logoUrl && <Submit label="Remove" name="remove" value="1" variant="ghost" />}
      </form>
    </Panel>
  );
}
