import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { getInstitutionSettings } from '@/server/services/institution-settings';
import { Breadcrumbs } from '@/components/ui/navigation';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Institution settings' };

/** Blank rather than "null" in an input. */
function value(value: string | null | undefined): string {
  return value ?? '';
}

export default async function SettingsPage() {
  const principal = await requirePrincipal();
  const institution = await getInstitutionSettings(principal);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Settings' }]} />

      <div>
        <h1 className="font-serif text-2xl font-semibold">Institution settings</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The profile, branding and contact details this institution is known by: on every screen,
          in every email, and on every certificate it issues.
        </p>
      </div>

      <SettingsForm
        values={{
          name: institution.name,
          shortName: value(institution.shortName),
          registrationNo: value(institution.registrationNo),
          accreditationNo: value(institution.accreditationNo),
          primaryColour: institution.primaryColour,
          secondaryColour: institution.secondaryColour,
          contactEmail: value(institution.contactEmail),
          contactPhone: value(institution.contactPhone),
          emailFromName: value(institution.emailFromName),
          emailFromAddress: value(institution.emailFromAddress),
          addressLine1: value(institution.addressLine1),
          addressLine2: value(institution.addressLine2),
          city: value(institution.city),
          province: value(institution.province),
          postalCode: value(institution.postalCode),
          country: institution.country,
          timezone: institution.timezone,
          locale: institution.locale,
          currency: institution.currency,
          certificatePrefix: institution.certificatePrefix,
          footerText: value(institution.footerText),
        }}
      />
    </div>
  );
}
