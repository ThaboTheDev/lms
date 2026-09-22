import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { loadCertificate } from '@/server/services/certificates';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { RevokeForm } from './revoke-form';

export const metadata: Metadata = { title: 'Certificate' };

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const principal = await requirePrincipal();
  const { certificateId } = await params;
  const { certificate, verifyUrl } = await loadCertificate(principal, certificateId);

  // The QR code is generated here rather than stored, so it always points at
  // the current verification address even if the institution changes domain.
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });

  const metadata = (certificate.metadata ?? {}) as { issuedByException?: string };

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        trail={[{ label: 'Certificates', href: '/certificates' }, { label: certificate.number }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{certificate.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {certificate.student.user.firstName} {certificate.student.user.lastName} ·{' '}
            {certificate.number}
          </p>
        </div>
        <Tag tone={certificate.status === 'REVOKED' ? 'danger' : 'active'}>
          {certificate.status.toLowerCase()}
        </Tag>
      </div>

      {certificate.status === 'REVOKED' && (
        <p className="border-l-2 border-danger bg-danger/5 px-4 py-3 text-sm text-danger">
          This certificate was revoked: {certificate.revokedReason}. Anyone checking the code now sees
          that it was withdrawn.
        </p>
      )}

      {metadata.issuedByException && (
        <p className="border-l-2 border-caution bg-caution/5 px-4 py-3 text-sm text-caution">
          Issued by exception: {metadata.issuedByException}
        </p>
      )}

      <Panel title="The award">
        <DescriptionList
          items={[
            { term: 'Awarded to', value: `${certificate.student.user.firstName} ${certificate.student.user.lastName}` },
            { term: 'Student number', value: certificate.student.studentNumber },
            { term: 'Award', value: certificate.title },
            { term: 'Kind', value: certificate.kind.toLowerCase().replace(/_/g, ' ') },
            { term: 'NQF level', value: certificate.qualification?.nqfLevel ?? 'Not applicable' },
            { term: 'Completed', value: certificate.completionDate.toLocaleDateString('en-ZA', { dateStyle: 'long' }) },
            { term: 'Issued', value: certificate.issuedOn.toLocaleDateString('en-ZA', { dateStyle: 'long' }) },
            { term: 'Institution', value: certificate.institution.name },
          ]}
        />
      </Panel>

      <Panel title="Verification" description="Printed on the certificate next to the QR code.">
        <div className="flex flex-wrap items-center gap-6 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR code linking to ${verifyUrl}`} width={160} height={160} />
          <div className="space-y-1 text-sm">
            <p className="font-serif text-2xl tabular-nums tracking-wide">{certificate.verificationCode}</p>
            <p className="text-muted">{verifyUrl}</p>
            <p className="text-muted">
              Checked {certificate.verifications.length === 10 ? 'at least 10' : certificate.verifications.length} times
              {certificate.verifications[0]
                ? `, most recently on ${certificate.verifications[0].verifiedAt.toLocaleDateString('en-ZA', { dateStyle: 'long' })}`
                : ''}
              .
            </p>
          </div>
        </div>
      </Panel>

      <p className="text-sm">
        <Link href={`/records/${certificate.student.id}`} className="text-accent underline underline-offset-2">
          Open the academic record
        </Link>
      </p>

      {can(principal, 'certificate.issue') && certificate.status !== 'REVOKED' && (
        <RevokeForm certificateId={certificateId} />
      )}
    </div>
  );
}
