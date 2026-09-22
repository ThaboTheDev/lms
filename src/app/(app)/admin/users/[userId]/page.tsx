import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { getPerson, listAssignableRoles } from '@/server/services/user-admin';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { GrantRoleForm, RevokeRoleForm, StatusForm } from './person-forms';

export const metadata: Metadata = { title: 'Person' };

export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const principal = await requirePrincipal();
  const { userId } = await params;

  const [person, roles] = await Promise.all([getPerson(principal, userId), listAssignableRoles(principal)]);

  const canAssign = can(principal, 'role.assign');
  const canManage = can(principal, 'user.manage');

  const held = new Set(person.userRoles.map((grant) => grant.roleId));
  const available = canAssign ? roles.filter((role) => !held.has(role.id)) : [];

  const statusTone =
    person.status === 'ACTIVE' ? 'active' : person.status === 'SUSPENDED' ? 'danger' : 'neutral';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'People and access', href: '/admin/users' },
          { label: `${person.firstName} ${person.lastName}` },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">
            {person.preferredName || person.firstName} {person.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted">{person.email}</p>
        </div>
        <Tag tone={statusTone}>{person.status.toLowerCase()}</Tag>
      </div>

      <Panel title="Account">
        <DescriptionList
          items={[
            { term: 'Email address', value: person.email },
            { term: 'Phone', value: person.phone ?? '-' },
            {
              term: 'Last signed in',
              value: person.lastLoginAt
                ? person.lastLoginAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
                : 'Never',
            },
            { term: 'Email verified', value: person.emailVerifiedAt ? 'Yes' : 'No' },
            { term: 'Two factor', value: person.mfaEnabled ? 'On' : 'Off' },
            {
              term: 'Account created',
              value: person.createdAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' }),
            },
            { term: 'Student number', value: person.studentProfile?.studentNumber ?? '-' },
          ]}
        />
      </Panel>

      <Panel
        title="Roles"
        description="Everything this person can reach comes from this list."
      >
        {person.userRoles.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">
            They hold no roles, so they can sign in and see nothing.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {person.userRoles.map((grant) => (
              <li key={grant.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-ink">{grant.role.name}</p>
                  <p className="font-mono text-xs text-muted">{grant.role.key}</p>
                </div>
                <div className="flex items-center gap-3">
                  {grant.role.isSystem && <Tag tone="neutral">system</Tag>}
                  {canAssign && (
                    <RevokeRoleForm userId={person.id} roleId={grant.roleId} roleName={grant.role.name} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canAssign && <GrantRoleForm userId={person.id} available={available} />}
      </Panel>

      {canManage && <StatusForm userId={person.id} status={person.status} />}
    </div>
  );
}
