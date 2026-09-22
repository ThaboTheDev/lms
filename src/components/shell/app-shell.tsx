'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { NavGroup } from './nav';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({
  groups,
  institutionName,
  displayName,
  roleSummary,
  unreadNotifications,
  unreadMessages,
  children,
}: {
  groups: NavGroup[];
  institutionName: string;
  displayName: string;
  roleSummary: string;
  unreadNotifications: number;
  unreadMessages: number;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-60 bg-ink transition-transform lg:static lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar groups={groups} institutionName={institutionName} />
      </div>

      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-20 bg-ink/40 lg:hidden"
        />
      )}

      <div className="flex min-w-0 flex-col">
        <Topbar
          displayName={displayName}
          roleSummary={roleSummary}
          unreadNotifications={unreadNotifications}
          unreadMessages={unreadMessages}
          onToggleNav={() => setNavOpen((open) => !open)}
        />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[75rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}
