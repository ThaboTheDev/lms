import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { parsePaging } from '@/lib/http';
import { admissionsPipeline } from '@/server/services/reporting';
import {
  ACTIVE_APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@/server/services/admissions-workflow';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/navigation';

export const metadata: Metadata = { title: 'Admissions' };

const tone: Partial<Record<ApplicationStatus, 'active' | 'caution' | 'danger' | 'neutral'>> = {
  SUBMITTED: 'caution',
  DOCUMENTS_OUTSTANDING: 'caution',
  UNDER_REVIEW: 'caution',
  INTERVIEW: 'caution',
  OFFER: 'active',
  CONDITIONAL_OFFER: 'active',
  ACCEPTED: 'active',
  ENROLLED: 'active',
  REJECTED: 'danger',
  DECLINED: 'neutral',
  WITHDRAWN: 'neutral',
  DRAFT: 'neutral',
};

export default async function AdmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  requirePermission(principal, 'application.read');

  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 50);
  const statusFilter = params.status as ApplicationStatus | undefined;

  const where = {
    institutionId: principal.institutionId ?? undefined,
    ...(statusFilter
      ? { status: statusFilter }
      : { status: { in: ACTIVE_APPLICATION_STATUSES } }),
    ...(params.q
      ? {
          OR: [
            { referenceNumber: { contains: params.q, mode: 'insensitive' as const } },
            { lastName: { contains: params.q, mode: 'insensitive' as const } },
            { email: { contains: params.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [pipeline, total, applications] = await Promise.all([
    admissionsPipeline(principal),
    prisma.application.count({ where: where as never }),
    prisma.application.findMany({
      where: where as never,
      skip,
      take: perPage,
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        referenceNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        submittedAt: true,
        programme: { select: { code: true } },
        academicYear: { select: { year: true } },
        _count: { select: { documents: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const buildHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'page') next.set(key, value);
    }
    next.set('page', String(target));
    return `/admissions?${next.toString()}`;
  };

  const stageCounts = ACTIVE_APPLICATION_STATUSES.map((status) => ({
    status,
    label: APPLICATION_STATUS_LABELS[status],
    count: pipeline.find((row) => row.status === status)?.count ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Admissions</h1>
        <p className="mt-1 text-sm text-muted">
          Applications move through the pipeline from submission to enrolment.
        </p>
      </div>

      <ol className="grid gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-7">
        {stageCounts.map((stage) => (
          <li key={stage.status} className="bg-surface px-3 py-3">
            <Link href={`/admissions?status=${stage.status}`} className="block">
              <span className="block text-xs text-muted">{stage.label}</span>
              <span className="mt-0.5 block font-serif text-2xl font-semibold tabular-nums">
                {stage.count}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <Panel
        title={statusFilter ? APPLICATION_STATUS_LABELS[statusFilter] : 'Live applications'}
        description={`${total} ${total === 1 ? 'application' : 'applications'}`}
        action={
          statusFilter ? (
            <Link href="/admissions" className="text-sm text-accent underline underline-offset-2">
              Show all live applications
            </Link>
          ) : undefined
        }
      >
        {applications.length === 0 ? (
          <EmptyState
            title="No applications here"
            hint="New applications arrive through the public application form."
          />
        ) : (
          <DataTable
            caption="Applications"
            head={['Reference', 'Applicant', 'Programme', 'Year', 'Documents', 'Status', 'Waiting since']}
          >
            {applications.map((application) => (
              <tr key={application.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admissions/${application.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {application.referenceNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {application.lastName}, {application.firstName}
                  <span className="block text-xs text-muted">{application.email}</span>
                </td>
                <td className="px-4 py-2.5 text-muted">{application.programme.code}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{application.academicYear.year}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{application._count.documents}</td>
                <td className="px-4 py-2.5">
                  <Tag tone={tone[application.status as ApplicationStatus] ?? 'neutral'}>
                    {APPLICATION_STATUS_LABELS[application.status as ApplicationStatus]}
                  </Tag>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {application.submittedAt
                    ? application.submittedAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
                    : 'Not submitted'}
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
      </Panel>
    </div>
  );
}
