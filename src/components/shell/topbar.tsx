'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives';

export function Topbar({
  displayName,
  roleSummary,
  unreadNotifications,
  unreadMessages,
  onToggleNav,
}: {
  displayName: string;
  roleSummary: string;
  unreadNotifications: number;
  unreadMessages: number;
  onToggleNav: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
      <button
        type="button"
        onClick={onToggleNav}
        className="rounded p-2 text-ink hover:bg-ink/5 lg:hidden"
        aria-label="Open navigation"
      >
        <span aria-hidden className="block h-0.5 w-5 bg-current shadow-[0_6px_0_0_currentColor,0_-6px_0_0_currentColor]" />
      </button>

      <form action="/search" role="search" className="flex-1 max-w-md">
        <label htmlFor="global-search" className="sr-only">
          Search students, courses and records
        </label>
        <input
          id="global-search"
          name="q"
          type="search"
          placeholder="Search students, courses, records"
          className="h-9 w-full rounded border border-line bg-paper px-3 text-sm"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        <Link
          href="/messages"
          className="rounded px-2 py-1.5 text-sm text-muted hover:bg-ink/5"
          aria-label={
            unreadMessages > 0 ? `Messages, ${unreadMessages} unread` : 'Messages'
          }
        >
          Messages
          {unreadMessages > 0 && (
            <span className="ml-1.5 rounded bg-brand px-1.5 py-0.5 text-2xs font-medium text-white tabular-nums">
              {unreadMessages}
            </span>
          )}
        </Link>
        <Link
          href="/notifications"
          className="rounded px-2 py-1.5 text-sm text-muted hover:bg-ink/5"
          aria-label={
            unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : 'Notifications'
          }
        >
          Notices
          {unreadNotifications > 0 && (
            <span className="ml-1.5 rounded bg-brand px-1.5 py-0.5 text-2xs font-medium text-white tabular-nums">
              {unreadNotifications}
            </span>
          )}
        </Link>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-ink/5"
        >
          <span className="hidden sm:block">
            <span className="block text-sm font-medium leading-tight">{displayName}</span>
            <span className="block text-xs text-muted">{roleSummary}</span>
          </span>
          <span aria-hidden className="text-muted">▾</span>
        </button>

        {menuOpen && (
          <div role="menu" className="absolute right-0 z-20 mt-1 w-56 border border-line bg-surface py-1 shadow-sm">
            <Link role="menuitem" href="/security" className="block px-3 py-2 text-sm hover:bg-ink/5">
              Account and security
            </Link>
            <Link role="menuitem" href="/notifications" className="block px-3 py-2 text-sm hover:bg-ink/5">
              Notifications
            </Link>
            <form action="/api/v1/auth/sign-out" method="post" className="border-t border-line px-3 py-2">
              <Button type="submit" variant="ghost" size="sm" className="w-full justify-start px-0">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
