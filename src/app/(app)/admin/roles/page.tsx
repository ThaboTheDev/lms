import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listRoles } from '@/server/services/roles';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { CreateRoleForm, RolePermissionsForm } from './role-forms';

export const metadata: Metadata = { title: 'Roles and permissions' };

export default async function RolesPage() {
  const principal = await requirePrincipal();
  const roles = await listRoles(principal);
  const canManage = can(principal, 'role.manage');

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'People and access', href: '/admin/users' }, { label: 'Roles' }]} />

      <div>
        <h1 className="font-serif text-2xl font-semibold">Roles and permissions</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          What a person can reach is decided entirely by the roles they hold. System roles are
          shipped with the platform and kept in step by the permission sync, so they are read here;
          institution roles can be composed freely.
        </p>
      </div>

      {roles.map((role) => (
        <Panel
          key={role.id}
          title={role.name}
          description={role.description ?? role.key}
          action={
            <div className="flex items-center gap-2">
              {role.isSystem && <Tag tone="neutral">system</Tag>}
              <Tag tone={role.memberCount > 0 ? 'active' : 'neutral'}>
                {role.memberCount} {role.memberCount === 1 ? 'person' : 'people'}
              </Tag>
            </div>
          }
        >
          <div className="px-4 py-4">
            {role.permissionKeys.length === 0 ? (
              <p className="text-sm text-muted">
                This role grants nothing yet, which is the safe default for a new one.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {role.permissionKeys.map((key) => (
                  <li
                    key={key}
                    className="border border-line px-2 py-0.5 font-mono text-xs text-muted"
                    title={key}
                  >
                    {key}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canManage && !role.isSystem && <RolePermissionsForm role={role} />}
        </Panel>
      ))}

      {canManage && <CreateRoleForm />}
    </div>
  );
}
