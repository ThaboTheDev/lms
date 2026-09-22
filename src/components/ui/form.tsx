import * as React from 'react';
import { cn } from '@/lib/cn';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      {...props}
      className={cn(
        'h-10 w-full rounded border border-line bg-surface px-3 text-sm text-ink',
        'aria-[invalid=true]:border-danger',
        className,
      )}
    >
      {children}
    </select>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={props.rows ?? 4}
      {...props}
      className={cn(
        'w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink',
        'aria-[invalid=true]:border-danger',
        className,
      )}
    />
  );
});

export function Checkbox({
  id,
  name,
  value,
  label,
  defaultChecked,
  error,
}: {
  id: string;
  name: string;
  /** Set when several checkboxes share a name, so each posts its own value. */
  value?: string;
  label: React.ReactNode;
  defaultChecked?: boolean;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <input
          id={id}
          name={name}
          value={value}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-invalid={Boolean(error)}
          className="mt-1 h-4 w-4 rounded border-line accent-[rgb(var(--brand))]"
        />
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
      </div>
      {error && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Groups related fields with a legend, which screen readers announce. */
export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('space-y-4', className)}>
      <legend className="font-serif text-base font-semibold text-ink">{legend}</legend>
      {description && <p className="-mt-2 text-sm text-muted">{description}</p>}
      {children}
    </fieldset>
  );
}

export function FormMessage({ status, message }: { status?: string; message?: string }) {
  if (!message) return null;
  const isError = status === 'error';
  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={cn(
        'border-l-2 px-3 py-2 text-sm',
        isError ? 'border-danger bg-danger/5 text-danger' : 'border-brand bg-brand/5 text-brand',
      )}
    >
      {message}
    </p>
  );
}
