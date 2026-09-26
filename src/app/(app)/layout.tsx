import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentPrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { institutionBrandStyle } from '@/lib/brand';
import { NAVIGATION } from '@/components/shell/nav';
import { AppShell } from '@/components/shell/app-shell';
import { unreadNotificationCount } from '@/server/services/notifications';
import { unreadThreadCount } from '@/server/services/messaging';
import { logoUrlFor } from '@/server/services/branding';
import { resolveLocale, translator } from '@/lib/i18n/messages';
import '@/server/jobs';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect('/login');

  const [institution, unreadNotifications, unreadMessages] = await Promise.all([
    principal.institutionId
      ? prisma.institution.findUnique({
          where: { id: principal.institutionId },
          select: { id: true, name: true, shortName: true, logoFileId: true, primaryColour: true, secondaryColour: true, locale: true },
        })
      : Promise.resolve(null),
    unreadNotificationCount(principal),
    unreadThreadCount(principal),
  ]);

  // Menu items the principal cannot reach are removed rather than disabled:
  // a rail full of dead links is noise, and the page guards enforce the same
  // permissions server side regardless of what the menu shows.
  const userLocale = await prisma.user.findUnique({ where: { id: principal.userId }, select: { locale: true } });
  const locale = resolveLocale(userLocale?.locale, institution?.locale);
  const tr = translator(locale);

  const groups = NAVIGATION.map((group) => ({
    label: tr(group.labelKey),
    items: group.items
      .filter(
        (item) =>
          !item.permissions ||
          item.permissions.some((p) =>
            can(principal, p, item.institutionWide ? { institutionId: principal.institutionId ?? '' } : undefined),
          ),
      )
      .map((item) => ({ label: tr(item.labelKey), href: item.href })),
  })).filter((group) => group.items.length > 0);

  const labels = {
    skip: tr('shell.skip'),
    openNav: tr('shell.openNav'),
    closeNav: tr('shell.closeNav'),
    searchLabel: tr('shell.searchLabel'),
    searchPlaceholder: tr('shell.searchPlaceholder'),
    messages: tr('shell.messages'),
    notices: tr('shell.notices'),
    notifications: tr('shell.notifications'),
    unreadMessages: tr('shell.unread', { label: tr('shell.messages'), count: unreadMessages }),
    unreadNotifications: tr('shell.unread', { label: tr('shell.notifications'), count: unreadNotifications }),
    security: tr('shell.security'),
    signOut: tr('auth.signOut'),
  };

  const roleSummary = principal.isSuperAdmin
    ? 'Super administrator'
    : [...new Set(principal.grants.map((g) => g.roleKey))]
        .slice(0, 2)
        .map((key) => key.replace(/_/g, ' ').toLowerCase())
        .join(', ') || 'No role assigned';

  const brandStyle = institutionBrandStyle(institution?.primaryColour, institution?.secondaryColour);
  const brand = institution
    ? { logoUrl: logoUrlFor(institution), shortName: institution.shortName || institution.name, name: institution.name }
    : undefined;

  return (
    <div style={brandStyle}>
      <AppShell
        groups={groups}
        displayName={principal.displayName}
        roleSummary={roleSummary}
        unreadNotifications={unreadNotifications}
        unreadMessages={unreadMessages}
        brand={brand}
        labels={labels}
        locale={locale}
      >
        {children}
      </AppShell>
    </div>
  );
}
