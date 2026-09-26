'use client';

import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';

export interface ActionFieldOption {
  value: string;
  label: string;
}

export interface ActionField {
  name: string;
  label: string;
  type?: 'text' | 'password' | 'number' | 'date' | 'datetime-local' | 'email' | 'url' | 'select' | 'checkbox' | 'checkboxes' | 'textarea' | 'hidden' | 'color';
  options?: ActionFieldOption[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean | string[];
  min?: number | string;
  max?: number | string;
  step?: string;
  rows?: number;
  /** Take the full width of the grid. */
  wide?: boolean;
}

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

/**
 * One form component for the many small create-and-edit forms administration
 * needs. It is a server action form, so it works before any script loads and
 * keeps working if scripts fail; field errors come back from the action.
 */
export function ActionForm({
  action,
  fields,
  submitLabel,
  title,
  description,
  columns = 2,
  bare = false,
}: {
  action: Action;
  fields: ActionField[];
  submitLabel: string;
  title?: string;
  description?: string;
  columns?: 1 | 2 | 3;
  /** Render without the surrounding panel, for forms placed inside one. */
  bare?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const prefix = useId().replace(/:/g, '');
  const grid = columns === 1 ? '' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';

  const body = (
    <form action={formAction} className="space-y-3 px-4 py-4">
      <FormMessage status={state.status} message={state.message} />
      {fields.filter((field) => field.type === 'hidden').map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={String(field.defaultValue ?? '')} />
      ))}
      <div className={`grid gap-3 ${grid}`}>
        {fields
          .filter((field) => field.type !== 'hidden')
          .map((field) => {
            const id = `${prefix}-${field.name}`;
            const error = state.fieldErrors?.[field.name];
            const wide = field.wide || field.type === 'textarea' || field.type === 'checkboxes' ? 'sm:col-span-full' : '';

            if (field.type === 'checkbox') {
              return (
                <div key={field.name} className={`self-end ${wide}`}>
                  <Checkbox id={id} name={field.name} label={field.label} defaultChecked={Boolean(field.defaultValue)} error={error} />
                </div>
              );
            }
            if (field.type === 'checkboxes') {
              const chosen = Array.isArray(field.defaultValue) ? field.defaultValue : [];
              return (
                <fieldset key={field.name} className={wide}>
                  <legend className="mb-1.5 text-sm font-medium text-ink">{field.label}</legend>
                  {field.hint && <p className="mb-1.5 text-sm text-muted">{field.hint}</p>}
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {(field.options ?? []).map((option) => (
                      <Checkbox
                        key={option.value}
                        id={`${id}-${option.value}`}
                        name={field.name}
                        value={option.value}
                        label={option.label}
                        defaultChecked={chosen.includes(option.value)}
                      />
                    ))}
                  </div>
                  {error && <p className="mt-1 text-sm text-danger" role="alert">{error}</p>}
                </fieldset>
              );
            }

            return (
              <div key={field.name} className={wide}>
                <Field label={field.label} htmlFor={id} hint={field.hint} error={error}>
                  {field.type === 'select' ? (
                    <Select id={id} name={field.name} required={field.required} defaultValue={String(field.defaultValue ?? '')} aria-invalid={Boolean(error)}>
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  ) : field.type === 'textarea' ? (
                    <Textarea
                      id={id}
                      name={field.name}
                      required={field.required}
                      rows={field.rows ?? 4}
                      placeholder={field.placeholder}
                      defaultValue={String(field.defaultValue ?? '')}
                      aria-invalid={Boolean(error)}
                    />
                  ) : (
                    <Input
                      id={id}
                      name={field.name}
                      type={field.type ?? 'text'}
                      required={field.required}
                      placeholder={field.placeholder}
                      defaultValue={field.defaultValue === undefined ? undefined : String(field.defaultValue)}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      aria-invalid={Boolean(error)}
                    />
                  )}
                </Field>
              </div>
            );
          })}
      </div>
      <Submit label={submitLabel} />
    </form>
  );

  if (bare) return body;
  return (
    <Panel title={title} description={description}>
      {body}
    </Panel>
  );
}

/** A one-button form: "Make current", "Remove", "Archive". */
export function ActionButton({
  action,
  hidden,
  label,
  variant = 'secondary',
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant}>{label}</Button>
      {state.status === 'error' && <span className="text-xs text-danger" role="alert">{state.message}</span>}
      {state.status === 'success' && state.message && <span className="text-xs text-muted" role="status">{state.message}</span>}
    </form>
  );
}
