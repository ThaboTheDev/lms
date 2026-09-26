'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Fieldset, FormMessage } from '@/components/ui/form';
import {
  INSTITUTION_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  slugify,
  type SetupField,
} from '@/lib/validation/setup';
import { runSetup, type SetupFormState } from './actions';

function Submit({ mode }: { mode: 'create' | 'attach' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending
        ? 'Setting up'
        : mode === 'create'
          ? 'Create institution and administrator'
          : 'Create administrator'}
    </Button>
  );
}

export function SetupForm({
  mode,
  institution,
  tokenRequired,
  suggestedSlug,
}: {
  mode: 'create' | 'attach';
  /** The institution the administrator will run, in attach mode. */
  institution?: { name: string; slug: string };
  tokenRequired: boolean;
  suggestedSlug?: string;
}) {
  const [state, action] = useActionState<SetupFormState, FormData>(runSetup, {});

  // Seeded from the echoed values: without JavaScript every submission is a
  // fresh server render, and a rejected form must come back filled in.
  const [name, setName] = useState(state.values?.institutionName ?? '');
  const [slug, setSlug] = useState(state.values?.institutionSlug ?? suggestedSlug ?? '');
  // The short name follows the name until somebody edits it themselves.
  const [slugEdited, setSlugEdited] = useState(
    Boolean(state.values?.institutionSlug || suggestedSlug),
  );

  const error = (field: SetupField) => state.fieldErrors?.[field];
  const invalid = (field: SetupField) => (error(field) ? true : undefined);
  const describedBy = (field: SetupField, hasHint = false) =>
    [hasHint && `${field}-hint`, error(field) && `${field}-error`].filter(Boolean).join(' ') ||
    undefined;

  return (
    <form action={action} className="mt-8 space-y-8">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="mode" value={mode} />

      {tokenRequired && (
        <Fieldset
          legend="Setup token"
          description="This server was started with SETUP_TOKEN set, so setup asks for it as well."
        >
          <Field label="Setup token" htmlFor="setupToken" error={error('setupToken')}>
            <Input
              id="setupToken"
              name="setupToken"
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid('setupToken')}
              aria-describedby={describedBy('setupToken')}
            />
          </Field>
        </Fieldset>
      )}

      {mode === 'create' ? (
        <Fieldset
          legend="Institution"
          description="Contact details, logo, colours and the certificate prefix come later, under Settings."
        >
          <Field label="Name" htmlFor="institutionName" error={error('institutionName')}>
            <Input
              id="institutionName"
              name="institutionName"
              required
              maxLength={INSTITUTION_NAME_MAX_LENGTH}
              autoComplete="organization"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugEdited) setSlug(slugify(event.target.value));
              }}
              aria-invalid={invalid('institutionName')}
              aria-describedby={describedBy('institutionName')}
            />
          </Field>

          <Field
            label="Short name"
            htmlFor="institutionSlug"
            hint="Lowercase letters, numbers and hyphens, filled in from the name. It picks this institution out in links such as the application form's, so change it now rather than later."
            error={error('institutionSlug')}
          >
            <Input
              id="institutionSlug"
              name="institutionSlug"
              maxLength={SLUG_MAX_LENGTH}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase letters, numbers and single hyphens"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              className="font-mono"
              value={slug}
              onChange={(event) => {
                const next = event.target.value.toLowerCase();
                setSlug(next);
                // Emptied, it goes back to following the name. Submitted
                // empty, the server derives it from the name instead.
                setSlugEdited(next !== '');
              }}
              aria-invalid={invalid('institutionSlug')}
              aria-describedby={describedBy('institutionSlug', true)}
            />
          </Field>
        </Fieldset>
      ) : (
        institution && (
          <section
            aria-labelledby="institution-heading"
            className="space-y-1 rounded border border-line bg-surface px-4 py-3"
          >
            <h2 id="institution-heading" className="font-serif text-base font-semibold text-ink">
              Institution
            </h2>
            <p className="text-sm">
              {institution.name} <span className="font-mono text-muted">({institution.slug})</span>
            </p>
            <p className="text-sm text-muted">
              Already on this server. The administrator you create here runs it.
            </p>
          </section>
        )
      )}

      <Fieldset
        legend="First administrator"
        description="Holds the institution administrator role: every setting, every role and every record. Invite everybody else from inside once you are in."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={error('firstName')}>
            <Input
              id="firstName"
              name="firstName"
              required
              autoComplete="given-name"
              defaultValue={state.values?.firstName}
              aria-invalid={invalid('firstName')}
              aria-describedby={describedBy('firstName')}
            />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={error('lastName')}>
            <Input
              id="lastName"
              name="lastName"
              required
              autoComplete="family-name"
              defaultValue={state.values?.lastName}
              aria-invalid={invalid('lastName')}
              aria-describedby={describedBy('lastName')}
            />
          </Field>
        </div>

        <Field label="Email address" htmlFor="email" hint="You sign in with this." error={error('email')}>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.values?.email}
            aria-invalid={invalid('email')}
            aria-describedby={describedBy('email', true)}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint="At least 12 characters, including a lowercase letter, an uppercase letter and a number. From 20 characters any mix will do. Not your name or email address."
          error={error('password')}
        >
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            aria-invalid={invalid('password')}
            aria-describedby={describedBy('password', true)}
          />
        </Field>

        <Field label="Type it again" htmlFor="passwordConfirmation" error={error('passwordConfirmation')}>
          <Input
            id="passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            required
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            aria-invalid={invalid('passwordConfirmation')}
            aria-describedby={describedBy('passwordConfirmation')}
          />
        </Field>
      </Fieldset>

      <section
        aria-labelledby="mfa-heading"
        className="space-y-2 border-l-2 border-gold-ink bg-gold/10 px-4 py-3 text-sm"
      >
        <h2 id="mfa-heading" className="font-semibold text-gold-ink">
          Then turn on two step sign in, straight away
        </h2>
        <p>
          This account can change everything, so it should not rest on a password alone. Setup ends
          on the dashboard: open the menu under your name, choose <strong>Account and security</strong>,
          and follow <strong>Turn on two step sign in</strong> with an authenticator app on your phone.
          Once it is on, you sign in again, this time with a code from the app as well.
        </p>
      </section>

      <Submit mode={mode} />
    </form>
  );
}
