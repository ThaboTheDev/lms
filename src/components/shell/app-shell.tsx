'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { NavGroup } from './nav';
import { Sidebar } from './sidebar';
import { Topbar, type ShellLabels } from './topbar';

export function AppShell({
  groups,
  displayName,
  roleSummary,
  unreadNotifications,
  unreadMessages,
  brand,
  labels,
  locale = 'en',
  children,
}: {
  brand?: { logoUrl: string | null; shortName: string; name: string };
  labels: ShellLabels;
  locale?: string;
  groups: NavGroup[];
  displayName: string;
  roleSummary: string;
  unreadNotifications: number;
  unreadMessages: number;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div lang={locale} className="min-h-dvh lg:grid lg:grid-cols-[17.5rem_1fr] print:block">
      <a href="#main" className="skip-link">
        {labels.skip}
      </a>

      <div
        data-shell="rail"
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-72 border-r-2 border-gold-bright bg-rail transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar groups={groups} brand={brand} signOutLabel={labels.signOut} />
      </div>

      {navOpen && (
        <button
          type="button"
          aria-label={labels.closeNav}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-20 bg-navy/60 lg:hidden"
        />
      )}

      <div className="flex min-w-0 flex-col">
        <Topbar
          displayName={displayName}
          roleSummary={roleSummary}
          unreadNotifications={unreadNotifications}
          unreadMessages={unreadMessages}
          labels={labels}
          onToggleNav={() => setNavOpen((open) => !open)}
        />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[75rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
