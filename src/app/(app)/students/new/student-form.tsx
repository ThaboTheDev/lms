'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Fieldset, FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { registerStudent } from './actions';

interface Option {
  id: string;
  code: string;
  title?: string;
  name?: string;
  label?: string;
  year?: number;
  isCurrent?: boolean;
  programmeId?: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Registering' : 'Register student'}
    </Button>
  );
}

export function StudentForm({
  programmes,
  academicYears,
  cohorts,
}: {
  programmes: Option[];
  academicYears: { id: string; year: number; label: string; isCurrent: boolean }[];
  cohorts: Option[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(registerStudent, {});
  const error = (field: string) => state.fieldErrors?.[field];
  const currentYear = academicYears.find((year) => year.isCurrent) ?? academicYears[0];

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <FormMessage status={state.status} message={state.message} />

      <Panel className="p-4">
        <Fieldset legend="Learner">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" error={error('firstName')}>
              <Input id="firstName" name="firstName" required aria-invalid={Boolean(error('firstName'))} />
            </Field>
            <Field label="Surname" htmlFor="lastName" error={error('lastName')}>
              <Input id="lastName" name="lastName" required aria-invalid={Boolean(error('lastName'))} />
            </Field>
            <Field label="Preferred name" htmlFor="preferredName" hint="Optional" error={error('preferredName')}>
              <Input id="preferredName" name="preferredName" />
            </Field>
            <Field label="Home language" htmlFor="homeLanguage" hint="Optional" error={error('homeLanguage')}>
              <Input id="homeLanguage" name="homeLanguage" />
            </Field>
            <Field label="Email address" htmlFor="email" error={error('email')}>
              <Input id="email" name="email" type="email" required aria-invalid={Boolean(error('email'))} />
            </Field>
            <Field label="Phone" htmlFor="phone" hint="For example 0821234567" error={error('phone')}>
              <Input id="phone" name="phone" type="tel" />
            </Field>
          </div>
        </Fieldset>
      </Panel>

      <Panel className="p-4">
        <Fieldset legend="Enrolment">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Programme" htmlFor="programmeId" error={error('programmeId')}>
              <Select id="programmeId" name="programmeId" required defaultValue="">
                <option value="" disabled>
                  Choose a programme
                </option>
                {programmes.map((programme) => (
                  <option key={programme.id} value={programme.id}>
                    {programme.code} · {programme.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Academic year" htmlFor="academicYearId" error={error('academicYearId')}>
              <Select id="academicYearId" name="academicYearId" required defaultValue={currentYear?.id ?? ''}>
                {academicYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cohort" htmlFor="cohortId" hint="Optional" error={error('cohortId')}>
              <Select id="cohortId" name="cohortId" defaultValue="">
                <option value="">No cohort</option>
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.code} · {cohort.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Fieldset>
      </Panel>

      <Panel className="p-4">
        <Fieldset
          legend="Identity"
          description="Restricted information. Only roles holding the sensitive student permission can read these fields afterwards."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Identity number" htmlFor="nationalIdRef" hint="13 digits, optional" error={error('nationalIdRef')}>
              <Input id="nationalIdRef" name="nationalIdRef" inputMode="numeric" />
            </Field>
            <Field label="Passport number" htmlFor="passportNumber" hint="For international learners" error={error('passportNumber')}>
              <Input id="passportNumber" name="passportNumber" />
            </Field>
            <Field label="Date of birth" htmlFor="dateOfBirth" error={error('dateOfBirth')}>
              <Input id="dateOfBirth" name="dateOfBirth" type="date" />
            </Field>
            <Field label="Nationality" htmlFor="nationality" error={error('nationality')}>
              <Input id="nationality" name="nationality" defaultValue="South African" />
            </Field>
          </div>
        </Fieldset>
      </Panel>

      <Panel className="p-4">
        <Fieldset legend="Address and next of kin">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Street address" htmlFor="addressLine1" error={error('addressLine1')}>
              <Input id="addressLine1" name="addressLine1" />
            </Field>
            <Field label="Suburb" htmlFor="addressLine2" error={error('addressLine2')}>
              <Input id="addressLine2" name="addressLine2" />
            </Field>
            <Field label="City or town" htmlFor="city" error={error('city')}>
              <Input id="city" name="city" />
            </Field>
            <Field label="Province" htmlFor="province" error={error('province')}>
              <Input id="province" name="province" />
            </Field>
            <Field label="Postal code" htmlFor="postalCode" error={error('postalCode')}>
              <Input id="postalCode" name="postalCode" inputMode="numeric" />
            </Field>
            <input type="hidden" name="country" value="ZA" />
            <Field label="Emergency contact" htmlFor="emergencyName" error={error('emergencyName')}>
              <Input id="emergencyName" name="emergencyName" />
            </Field>
            <Field label="Emergency phone" htmlFor="emergencyPhone" error={error('emergencyPhone')}>
              <Input id="emergencyPhone" name="emergencyPhone" type="tel" />
            </Field>
            <Field label="Relationship" htmlFor="emergencyRelation" error={error('emergencyRelation')}>
              <Input id="emergencyRelation" name="emergencyRelation" />
            </Field>
          </div>
        </Fieldset>
      </Panel>

      <div className="flex gap-3">
        <Submit />
        <Button type="reset" variant="secondary">
          Clear the form
        </Button>
      </div>
    </form>
  );
}
