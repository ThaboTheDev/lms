'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Checkbox, Fieldset, FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { applyNow } from './actions';

interface ProgrammeOption {
  id: string;
  code: string;
  title: string;
  qualification: { title: string; nqfLevel: number | null };
}

interface YearOption {
  id: string;
  label: string;
  isCurrent: boolean;
  terms: { id: string; name: string }[];
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Sending' : 'Send my application'}
    </Button>
  );
}

export function ApplicationForm({
  institutionSlug,
  programmes,
  academicYears,
}: {
  institutionSlug: string;
  programmes: ProgrammeOption[];
  academicYears: YearOption[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(applyNow, {});
  const [yearId, setYearId] = useState(academicYears[0]?.id ?? '');
  const error = (field: string) => state.fieldErrors?.[field];
  const terms = academicYears.find((year) => year.id === yearId)?.terms ?? [];

  return (
    <form action={formAction} className="mt-8 space-y-8">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="institutionSlug" value={institutionSlug} />

      <Fieldset legend="About you">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={error('firstName')}>
            <Input id="firstName" name="firstName" required autoComplete="given-name" />
          </Field>
          <Field label="Surname" htmlFor="lastName" error={error('lastName')}>
            <Input id="lastName" name="lastName" required autoComplete="family-name" />
          </Field>
          <Field label="Email address" htmlFor="email" hint="We send the outcome here" error={error('email')}>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={error('phone')}>
            <Input id="phone" name="phone" type="tel" autoComplete="tel" />
          </Field>
          <Field label="Date of birth" htmlFor="dateOfBirth" error={error('dateOfBirth')}>
            <Input id="dateOfBirth" name="dateOfBirth" type="date" />
          </Field>
          <Field label="Nationality" htmlFor="nationality" error={error('nationality')}>
            <Input id="nationality" name="nationality" defaultValue="South African" />
          </Field>
        </div>
      </Fieldset>

      <Fieldset legend="What you want to study">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Programme" htmlFor="programmeId" error={error('programmeId')}>
            <Select id="programmeId" name="programmeId" required defaultValue="">
              <option value="" disabled>
                Choose a programme
              </option>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}
                  {programme.qualification.nqfLevel ? ` (NQF ${programme.qualification.nqfLevel})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year you want to start" htmlFor="academicYearId" error={error('academicYearId')}>
            <Select
              id="academicYearId"
              name="academicYearId"
              required
              value={yearId}
              onChange={(event) => setYearId(event.target.value)}
            >
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </Select>
          </Field>
          {terms.length > 0 && (
            <Field label="Intake" htmlFor="intakeTermId" hint="Optional">
              <Select id="intakeTermId" name="intakeTermId" defaultValue="">
                <option value="">No preference</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Fieldset>

      <Fieldset legend="Your schooling">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Highest qualification" htmlFor="highestQualification" error={error('highestQualification')}>
            <Input id="highestQualification" name="highestQualification" placeholder="National Senior Certificate" />
          </Field>
          <Field label="School or institution" htmlFor="schoolOrInstitution" error={error('schoolOrInstitution')}>
            <Input id="schoolOrInstitution" name="schoolOrInstitution" />
          </Field>
          <Field label="Year completed" htmlFor="yearCompleted" error={error('yearCompleted')}>
            <Input id="yearCompleted" name="yearCompleted" inputMode="numeric" maxLength={4} />
          </Field>
        </div>
      </Fieldset>

      <Checkbox
        id="popiaConsent"
        name="popiaConsent"
        error={error('popiaConsent')}
        label="I agree that the institution may process the information in this form to assess my application, as set out in its privacy notice."
      />

      <Submit />

      <p className="text-sm text-muted">
        You will be asked for certified copies of your documents after you send this form.
      </p>
    </form>
  );
}
