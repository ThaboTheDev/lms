import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { parsePaging } from '@/lib/http';
import { listCertificates } from '@/server/services/certificates';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Pagination } from '@/components/ui/navigation';

export const metadata: Metadata = { title: 'Certificates' };

export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 50);

  const { total, certificates } = await listCertificates(
    principal,
    { query: params.q?.trim(), status: params.status },
    { skip, perPage },
  );

  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/certificates?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Certificates</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Every certificate carries a number and a verification code. Anyone holding the document can
          check it at {`${process.env.APP_URL ?? ''}/verify`} without seeing the learner&apos;s record.
          Certificates are issued from a learner&apos;s academic record.
        </p>
      </div>

      <Panel title="Issued" description={`${total} certificates`}>
        <form className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3" role="search">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="q" className="sr-only">
              Search by number, title, name or student number
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={params.q ?? ''}
              placeholder="Certificate number, name or student number"
              className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="status" className="sr-only">Status</label>
            <Select id="status" name="status" defaultValue={params.status ?? ''} className="h-9 w-40">
              <option value="">Any status</option>
              <option value="ISSUED">Issued</option>
              <option value="REVOKED">Revoked</option>
              <option value="REPLACED">Replaced</option>
              <option value="DRAFT">Draft</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>

        {certificates.length === 0 ? (
          <EmptyState
            title="Nothing issued yet"
            hint="Open a learner's academic record to issue their certificate."
          />
        ) : (
          <DataTable
            caption="Issued certificates"
            head={['Number', 'Holder', 'Award', 'Issued', 'Checks', 'Status']}
          >
            {certificates.map((certificate) => (
              <tr key={certificate.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">
                  <Link
                    href={`/certificates/${certificate.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {certificate.number}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {certificate.student.user.lastName}, {certificate.student.user.firstName}
                  <span className="block text-xs tabular-nums text-muted">
                    {certificate.student.studentNumber}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {certificate.title}
                  <span className="block text-xs text-muted">
                    {certificate.kind.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {certificate.issuedOn.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{certificate._count.verifications}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={certificate.status === 'REVOKED' ? 'danger' : 'active'}>
                    {certificate.status.toLowerCase()}
                  </Tag>
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / perPage))} buildHref={buildHref} />
      </Panel>
    </div>
  );
}
