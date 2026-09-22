import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { NAVIGATION } from '@/components/shell/nav';
import { AppShell } from '@/components/shell/app-shell';
import { unreadNotificationCount } from '@/server/services/notifications';
import { unreadThreadCount } from '@/server/services/messaging';
import '@/server/jobs';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect('/login');

  const [institution, unreadNotifications, unreadMessages] = await Promise.all([
    principal.institutionId
      ? prisma.institution.findUnique({
          where: { id: principal.institutionId },
          select: { name: true, primaryColour: true },
        })
      : Promise.resolve(null),
    unreadNotificationCount(principal),
    unreadThreadCount(principal),
  ]);

  // Menu items the principal cannot reach are removed rather than disabled:
  // a rail full of dead links is noise, and the page guards enforce the same
  // permissions server side regardless of what the menu shows.
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permissions || item.permissions.some((p) => can(principal, p)),
    ),
  })).filter((group) => group.items.length > 0);

  const roleSummary = principal.isSuperAdmin
    ? 'Super administrator'
    : [...new Set(principal.grants.map((g) => g.roleKey))]
        .slice(0, 2)
        .map((key) => key.replace(/_/g, ' ').toLowerCase())
        .join(', ') || 'No role assigned';

  return (
    <AppShell
      groups={groups}
      institutionName={institution?.name ?? 'Platform administration'}
      displayName={principal.displayName}
      roleSummary={roleSummary}
      unreadNotifications={unreadNotifications}
      unreadMessages={unreadMessages}
    >
      {children}
    </AppShell>
  );
}
