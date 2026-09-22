import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { verifyCertificate } from '@/server/services/certificates';
import { rateLimit } from '@/lib/rate-limit';
import { hashIp } from '@/lib/crypto';

export const metadata: Metadata = {
  title: 'Certificate verification',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Public page, so it is rate limited per address: the codes are long enough
 * that guessing them is hopeless, and a limit makes it slower still.
 */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const limit = await rateLimit(`verify:${hashIp(ipAddress) ?? 'unknown'}`, 30, 300);

  if (!limit.allowed) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-serif text-2xl font-semibold">Too many checks</h1>
        <p className="mt-3 text-muted">Wait a few minutes and try again.</p>
      </main>
    );
  }

  const result = await verifyCertificate(decodeURIComponent(code), {
    ipAddress,
    userAgent: requestHeaders.get('user-agent'),
  });

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      {result.outcome === 'VALID' && result.certificate && (
        <>
          <p className="inline-block border-l-2 border-brand pl-3 font-serif text-lg text-brand">
            This certificate is valid
          </p>
          <h1 className="mt-4 font-serif text-3xl font-semibold">{result.certificate.title}</h1>
          <dl className="mt-6 space-y-3 border-t border-line pt-6">
            {[
              { term: 'Awarded to', value: result.certificate.holder },
              { term: 'Awarded by', value: result.certificate.institution },
              {
                term: 'Completed',
                value: result.certificate.completionDate.toLocaleDateString('en-ZA', { dateStyle: 'long' }),
              },
              {
                term: 'Issued',
                value: result.certificate.issuedOn.toLocaleDateString('en-ZA', { dateStyle: 'long' }),
              },
              ...(result.certificate.nqfLevel
                ? [{ term: 'NQF level', value: String(result.certificate.nqfLevel) }]
                : []),
              { term: 'Certificate number', value: result.certificate.number },
            ].map((item) => (
              <div key={item.term} className="flex justify-between gap-4">
                <dt className="text-muted">{item.term}</dt>
                <dd className="text-right">{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-sm text-muted">
            This page confirms the award only. Marks, the academic record and the holder&apos;s
            contact details are not shown, and this check has been logged.
          </p>
        </>
      )}

      {result.outcome === 'REVOKED' && result.certificate && (
        <>
          <p className="inline-block border-l-2 border-danger pl-3 font-serif text-lg text-danger">
            This certificate was withdrawn
          </p>
          <h1 className="mt-4 font-serif text-3xl font-semibold">{result.certificate.title}</h1>
          <p className="mt-4 text-muted">
            Certificate {result.certificate.number} was issued by {result.certificate.institution} and
            has since been revoked. It should not be relied on. Contact the institution if you need to
            know more.
          </p>
        </>
      )}

      {result.outcome === 'NOT_FOUND' && (
        <>
          <p className="inline-block border-l-2 border-danger pl-3 font-serif text-lg text-danger">
            No certificate with that code
          </p>
          <p className="mt-4 text-muted">
            The code is well formed but does not match anything we have issued. Check that you have
            copied it exactly, then contact the institution that appears on the document.
          </p>
        </>
      )}

      {result.outcome === 'MALFORMED' && (
        <>
          <p className="inline-block border-l-2 border-caution pl-3 font-serif text-lg text-caution">
            That code does not look right
          </p>
          <p className="mt-4 text-muted">
            A verification code is twelve characters, usually printed in three groups of four. This
            one does not pass its own check digit, which almost always means a character was mistyped
            rather than that the certificate is false.
          </p>
        </>
      )}

      <Link href="/verify" className="mt-8 inline-block text-accent underline underline-offset-2">
        Check another certificate
      </Link>
    </main>
  );
}
