import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { getPerson, listAssignableRoles } from '@/server/services/user-admin';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { RevokeRoleForm, StatusForm } from './person-forms';
import { ActionButton, ActionForm } from '@/components/ui/action-form';
import { grantRoleAction, resendInvitationAction } from '../actions';

export const metadata: Metadata = { title: 'Person' };

export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const principal = await requirePrincipal();
  const { userId } = await params;

  const [person, roles] = await Promise.all([getPerson(principal, userId), listAssignableRoles(principal)]);

  const canAssign = can(principal, 'role.assign');
  const canManage = can(principal, 'user.manage');

  const held = new Set(person.userRoles.map((grant) => grant.roleId));
  // A role can be held in several places (an examiner on two courses), so
  // scoped grants do not remove it from the list.
  const available = canAssign ? roles : [];
  void held;
  const institutionId = principal.institutionId ?? '';
  const scopes = canAssign
    ? {
        programmes: await prisma.programme.findMany({ where: { institutionId, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true } }),
        offerings: await prisma.courseOffering.findMany({
          where: { institutionId, status: { in: ['OPEN', 'ACTIVE'] } },
          orderBy: [{ course: { code: 'asc' } }],
          select: { id: true, sectionCode: true, course: { select: { code: true } }, academicTerm: { select: { name: true, academicYear: { select: { year: true } } } } },
        }),
      }
    : { programmes: [], offerings: [] };
  const scopeNames = new Map<string, string>([
    ...scopes.programmes.map((programme) => [programme.id, programme.code] as [string, string]),
    ...scopes.offerings.map((offering) => [offering.id, `${offering.course.code} ${offering.sectionCode}`] as [string, string]),
  ]);

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
                  <p className="font-mono text-xs text-muted">
                    {grant.role.key}
                    {grant.scopeType !== 'INSTITUTION' ? ` · ${grant.scopeType.toLowerCase()} ${scopeNames.get(grant.scopeId ?? '') ?? ''}` : ''}
                    {grant.expiresAt ? ` · until ${grant.expiresAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}` : ''}
                  </p>
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

        {canAssign && available.length > 0 && (
          <ActionForm
            bare
            action={grantRoleAction}
            submitLabel="Grant"
            columns={3}
            fields={[
              { name: 'userId', label: '', type: 'hidden', defaultValue: person.id },
              { name: 'roleId', label: 'Grant a role', type: 'select', required: true, options: available.map((role) => ({ value: role.id, label: role.name })) },
              {
                name: 'scope',
                label: 'Where it applies',
                type: 'select',
                defaultValue: 'INSTITUTION',
                options: [
                  { value: 'INSTITUTION', label: 'The whole institution' },
                  ...scopes.programmes.map((programme) => ({ value: `PROGRAMME:${programme.id}`, label: `Programme ${programme.code}` })),
                  ...scopes.offerings.map((offering) => ({ value: `COURSE:${offering.id}`, label: `Course ${offering.course.code} ${offering.sectionCode} · ${offering.academicTerm.name} ${offering.academicTerm.academicYear.year}` })),
                ],
              },
              { name: 'expiresAt', label: 'Until', type: 'date', hint: 'Optional: an external examiner\'s access can end with the moderation' },
            ]}
          />
        )}
        {canManage && person.status === 'INVITED' && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">They have not set a password yet.</span>
            <ActionButton action={resendInvitationAction} hidden={{ userId: person.id }} label="Send a new invitation" />
          </div>
        )}
      </Panel>

      {canManage && <StatusForm userId={person.id} status={person.status} />}
    </div>
  );
}
