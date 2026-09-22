import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { resolvePublicInstitution } from '@/server/services/tenancy';
import { displayInstitutionName } from '@/lib/brand';
import { PublicFrame } from '@/components/brand/public-frame';
import { ApplicationForm } from './application-form';

export const metadata: Metadata = { title: 'Apply to study' };

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ institution?: string }>;
}) {
  const { institution: slug } = await searchParams;
  const institution = await resolvePublicInstitution(slug);

  const [programmes, academicYears] = await Promise.all([
    prisma.programme.findMany({
      where: { institutionId: institution.id, isActive: true },
      select: {
        id: true,
        code: true,
        title: true,
        qualification: { select: { title: true, nqfLevel: true } },
      },
      orderBy: { title: 'asc' },
    }),
    prisma.academicYear.findMany({
      where: { institutionId: institution.id, endsOn: { gte: new Date() } },
      select: {
        id: true,
        label: true,
        isCurrent: true,
        terms: { select: { id: true, name: true }, orderBy: { startsOn: 'asc' } },
      },
      orderBy: { year: 'asc' },
    }),
  ]);

  return (
    <PublicFrame width="lg">
      <h1 className="font-serif text-3xl font-semibold">Apply to study</h1>
      <p className="mt-1 text-sm text-muted">{displayInstitutionName(institution.name)}</p>
      <p className="mt-2 max-w-prose text-muted">
        The form takes a few minutes. You will get a reference number when you send it,
        and we will email you as the application moves along.
      </p>

      <ApplicationForm
        institutionSlug={institution.slug}
        programmes={programmes}
        academicYears={academicYears}
      />
    </PublicFrame>
  );
}
