import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listAssignableRoles } from '@/server/services/user-admin';
import { Breadcrumbs } from '@/components/ui/navigation';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Invite somebody' };

export default async function InvitePage() {
  const principal = await requirePrincipal();
  const roles = await listAssignableRoles(principal);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'People and access', href: '/admin/users' }, { label: 'Invite' }]} />

      <div>
        <h1 className="font-serif text-2xl font-semibold">Invite somebody</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Registrars, lecturers, finance officers and anyone else who works here. Their account is
          created with no usable password until they set one themselves.
        </p>
      </div>

      <InviteForm roles={roles.map((role) => ({ id: role.id, name: role.name, isSystem: role.isSystem }))} />
    </div>
  );
}
