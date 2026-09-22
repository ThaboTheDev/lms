import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can, requirePermission } from '@/lib/rbac/authorize';
import { parsePaging } from '@/lib/http';
import { Button, DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'People and access' };

const statusTone = {
  ACTIVE: 'active',
  INVITED: 'caution',
  SUSPENDED: 'danger',
  DEACTIVATED: 'neutral',
} as const;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const principal = await requirePrincipal();
  requirePermission(principal, 'user.read');

  const params = await searchParams;
  const { page, perPage, skip } = parsePaging(params, 50);
  const query = params.q?.trim() ?? '';

  const where = {
    institutionId: principal.institutionId,
    deletedAt: null,
    ...(query
      ? {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' as const } },
            { lastName: { contains: query, mode: 'insensitive' as const } },
            { email: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: perPage,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        lastLoginAt: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const canManage = can(principal, 'user.manage');

  const pageHref = (target: number): Route => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    next.set('page', String(target));
    return `/admin/users?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">People and access</h1>
          <p className="mt-1 text-sm text-muted">
            {total} {total === 1 ? 'account' : 'accounts'} in this institution.
          </p>
        </div>
        {canManage && (
          <Link href="/admin/users/invite">
            <Button>Invite someone</Button>
          </Link>
        )}
      </div>

      <Panel>
        <form className="flex gap-2 border-b border-line px-4 py-3" role="search">
          <label htmlFor="q" className="sr-only">
            Search people by name or email address
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Name or email address"
            className="h-9 w-full max-w-sm rounded border border-line bg-paper px-3 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>

        {users.length === 0 ? (
          <EmptyState
            title={query ? 'No accounts match that search' : 'No accounts yet'}
            hint={
              query
                ? 'Check the spelling, or search by the email address the account was created with.'
                : 'Invite your registrar, academic administrators and lecturers to get started.'
            }
            action={canManage ? <Link href="/admin/users/invite"><Button size="sm">Invite someone</Button></Link> : undefined}
          />
        ) : (
          <DataTable
            caption="Accounts in this institution"
            head={['Name', 'Email address', 'Roles', 'Status', 'Last signed in']}
          >
            {users.map((user) => (
              <tr key={user.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/users/${user.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {user.lastName}, {user.firstName}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted">{user.email}</td>
                <td className="px-4 py-2.5 text-muted">
                  {user.userRoles.map((r) => r.role.name).join(', ') || 'None'}
                </td>
                <td className="px-4 py-2.5">
                  <Tag tone={statusTone[user.status]}>{user.status.toLowerCase()}</Tag>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {user.lastLoginAt
                    ? user.lastLoginAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
                    : 'Never'}
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        {totalPages > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="rounded border border-line px-3 py-1.5">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={pageHref(page + 1)} className="rounded border border-line px-3 py-1.5">
                  Next
                </Link>
              )}
            </div>
          </nav>
        )}
      </Panel>
    </div>
  );
}
