'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { saveSettings } from './actions';

export interface SettingsValues {
  name: string;
  shortName: string;
  registrationNo: string;
  accreditationNo: string;
  primaryColour: string;
  secondaryColour: string;
  contactEmail: string;
  contactPhone: string;
  emailFromName: string;
  emailFromAddress: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  timezone: string;
  locale: string;
  currency: string;
  certificatePrefix: string;
  footerText: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving' : 'Save settings'}
    </Button>
  );
}

export function SettingsForm({ values }: { values: SettingsValues }) {
  const [state, action] = useActionState<FormState, FormData>(saveSettings, {});

  return (
    <form action={action} className="space-y-6">
      <FormMessage status={state.status} message={state.message} />

      <Panel title="Identity">
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <Field label="Institution name" htmlFor="name" error={state.fieldErrors?.name}>
            <Input id="name" name="name" defaultValue={values.name} required maxLength={160} />
          </Field>

          <Field label="Short name" htmlFor="shortName" hint="Used where there is no room for the full name.">
            <Input id="shortName" name="shortName" defaultValue={values.shortName} maxLength={40} />
          </Field>

          <Field label="Registration number" htmlFor="registrationNo">
            <Input id="registrationNo" name="registrationNo" defaultValue={values.registrationNo} maxLength={60} />
          </Field>

          <Field label="Accreditation number" htmlFor="accreditationNo">
            <Input id="accreditationNo" name="accreditationNo" defaultValue={values.accreditationNo} maxLength={60} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Branding"
        description="Applied as CSS custom properties, so a change here needs no rebuild."
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <Field label="Primary colour" htmlFor="primaryColour" error={state.fieldErrors?.primaryColour}>
            <Input
              id="primaryColour"
              name="primaryColour"
              defaultValue={values.primaryColour}
              required
              pattern="#[0-9a-fA-F]{6}"
              className="font-mono"
            />
          </Field>

          <Field label="Secondary colour" htmlFor="secondaryColour" error={state.fieldErrors?.secondaryColour}>
            <Input
              id="secondaryColour"
              name="secondaryColour"
              defaultValue={values.secondaryColour}
              required
              pattern="#[0-9a-fA-F]{6}"
              className="font-mono"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Footer text" htmlFor="footerText" hint="Printed at the bottom of outgoing email.">
              <Input id="footerText" name="footerText" defaultValue={values.footerText} maxLength={200} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title="Contact details">
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <Field label="Contact email" htmlFor="contactEmail">
            <Input id="contactEmail" name="contactEmail" type="email" defaultValue={values.contactEmail} />
          </Field>

          <Field label="Contact phone" htmlFor="contactPhone">
            <Input id="contactPhone" name="contactPhone" defaultValue={values.contactPhone} maxLength={40} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Street address" htmlFor="addressLine1">
              <Input id="addressLine1" name="addressLine1" defaultValue={values.addressLine1} maxLength={160} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Address line two" htmlFor="addressLine2">
              <Input id="addressLine2" name="addressLine2" defaultValue={values.addressLine2} maxLength={160} />
            </Field>
          </div>

          <Field label="City" htmlFor="city">
            <Input id="city" name="city" defaultValue={values.city} maxLength={80} />
          </Field>

          <Field label="Province" htmlFor="province">
            <Input id="province" name="province" defaultValue={values.province} maxLength={80} />
          </Field>

          <Field label="Postal code" htmlFor="postalCode">
            <Input id="postalCode" name="postalCode" defaultValue={values.postalCode} maxLength={12} />
          </Field>

          <Field label="Country" htmlFor="country" hint="Two letter code, e.g. ZA.">
            <Input id="country" name="country" defaultValue={values.country} maxLength={2} className="font-mono" />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Outgoing email"
        description="The name and address every automated message is sent from. Leaving these blank sends from the platform default."
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <Field label="From name" htmlFor="emailFromName">
            <Input id="emailFromName" name="emailFromName" defaultValue={values.emailFromName} maxLength={120} />
          </Field>

          <Field label="From address" htmlFor="emailFromAddress" error={state.fieldErrors?.emailFromAddress}>
            <Input id="emailFromAddress" name="emailFromAddress" type="email" defaultValue={values.emailFromAddress} />
          </Field>
        </div>
      </Panel>

      <Panel title="Locale and certificates">
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <Field label="Timezone" htmlFor="timezone" hint="An IANA name, e.g. Africa/Johannesburg.">
            <Input id="timezone" name="timezone" defaultValue={values.timezone} required maxLength={64} />
          </Field>

          <Field label="Locale" htmlFor="locale" hint="e.g. en-ZA">
            <Input id="locale" name="locale" defaultValue={values.locale} required maxLength={12} />
          </Field>

          <Field label="Currency" htmlFor="currency" hint="Three letter code, e.g. ZAR.">
            <Input id="currency" name="currency" defaultValue={values.currency} required maxLength={3} className="font-mono" />
          </Field>

          <Field
            label="Certificate prefix"
            htmlFor="certificatePrefix"
            hint="Printed on every certificate number, so changing it changes how past certificates read."
            error={state.fieldErrors?.certificatePrefix}
          >
            <Input
              id="certificatePrefix"
              name="certificatePrefix"
              defaultValue={values.certificatePrefix}
              required
              maxLength={8}
              className="font-mono"
            />
          </Field>
        </div>
      </Panel>

      <div className="flex items-center gap-4">
        <Submit />
        <p className="text-sm text-muted">Changing these is recorded in the audit log.</p>
      </div>
    </form>
  );
}
