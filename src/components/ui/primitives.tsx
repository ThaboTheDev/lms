import * as React from 'react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

// Filled buttons carry --on-brand rather than a hard-coded white: brand and
// danger are dark in the light scheme and light in the dark one, so white text
// on them stops being readable once the scheme flips.
const buttonVariants = {
  primary: 'bg-brand text-on-brand hover:brightness-95 disabled:bg-brand/50',
  secondary: 'border border-line bg-surface text-ink hover:border-gold-ink',
  ghost: 'text-ink hover:bg-navy/5',
  danger: 'bg-danger text-on-danger hover:bg-danger/90',
};

export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        buttonVariants[variant],
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------- field */

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

/** Label, hint and error are wired together so screen readers announce them. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={cn(
          'h-10 w-full rounded border border-line bg-surface px-3 text-sm text-ink',
          'placeholder:text-muted/70 disabled:bg-paper',
          'aria-[invalid=true]:border-danger',
          className,
        )}
      />
    );
  },
);

/* -------------------------------------------------------------------- tag */

const tagTones = {
  neutral: 'border-l-muted text-muted',
  active: 'border-l-gold-ink text-gold-ink',
  caution: 'border-l-caution text-caution',
  danger: 'border-l-danger text-danger',
};

/**
 * Status is shown as a ruled tag rather than a filled pill: dense record tables
 * stay legible when a hundred rows each carry a state.
 */
export function Tag({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof tagTones;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-block border-l-2 bg-transparent py-0.5 pl-2 text-xs font-medium',
        tagTones[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ panel */

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-md border border-line border-t-2 border-t-gold bg-surface shadow-card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="font-serif text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ table */

export function DataTable({
  caption,
  head,
  children,
}: {
  caption: string;
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((column) => (
              <th key={column} scope="col" className="px-4 py-2.5 font-medium text-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="font-serif text-base text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-prose text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
