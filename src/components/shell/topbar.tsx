'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SignOutForm } from './sign-out-form';

/** The shell's words, already in the viewer's language (see src/lib/i18n/messages.ts). */
export interface ShellLabels {
  skip: string;
  openNav: string;
  closeNav: string;
  searchLabel: string;
  searchPlaceholder: string;
  messages: string;
  notices: string;
  notifications: string;
  unreadMessages: string;
  unreadNotifications: string;
  security: string;
  signOut: string;
}

export function Topbar({
  displayName,
  roleSummary,
  unreadNotifications,
  unreadMessages,
  labels,
  onToggleNav,
}: {
  labels: ShellLabels;
  displayName: string;
  roleSummary: string;
  unreadNotifications: number;
  unreadMessages: number;
  onToggleNav: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header data-shell="topbar" className="sticky top-0 z-40 flex h-14 items-center gap-3 overflow-visible border-b border-line bg-surface px-4 shadow-card">
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gold" aria-hidden />
      <button
        type="button"
        onClick={onToggleNav}
        className="rounded-md p-2 text-ink hover:bg-navy/5 lg:hidden"
        aria-label={labels.openNav}
      >
        <span aria-hidden className="block h-0.5 w-5 bg-current shadow-[0_6px_0_0_currentColor,0_-6px_0_0_currentColor]" />
      </button>

      <form action="/search" role="search" className="max-w-md flex-1">
        <label htmlFor="global-search" className="sr-only">
          {labels.searchLabel}
        </label>
        <input
          id="global-search"
          name="q"
          type="search"
          placeholder={labels.searchPlaceholder}
          className="h-9 w-full rounded-md border border-line bg-paper px-3 text-sm"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        <Link
          href="/messages"
          className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-navy/5 hover:text-ink"
          aria-label={unreadMessages > 0 ? labels.unreadMessages : labels.messages}
        >
          {labels.messages}
          {unreadMessages > 0 && (
            <span className="ml-1.5 rounded bg-brand px-1.5 py-0.5 text-2xs font-semibold text-on-brand tabular-nums">
              {unreadMessages}
            </span>
          )}
        </Link>
        <Link
          href="/notifications"
          className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-navy/5 hover:text-ink"
          aria-label={unreadNotifications > 0 ? labels.unreadNotifications : labels.notifications}
        >
          {labels.notices}
          {unreadNotifications > 0 && (
            <span className="ml-1.5 rounded bg-brand px-1.5 py-0.5 text-2xs font-semibold text-on-brand tabular-nums">
              {unreadNotifications}
            </span>
          )}
        </Link>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-navy/5"
        >
          <span className="hidden sm:block">
            <span className="block text-sm font-semibold leading-tight">{displayName}</span>
            <span className="block text-xs text-muted">{roleSummary}</span>
          </span>
          <span aria-hidden className="text-muted">▾</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            onPointerDown={(event) => event.stopPropagation()}
            className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-card"
          >
            <Link role="menuitem" href="/security" className="block px-3 py-2 text-sm hover:bg-navy/5">
              {labels.security}
            </Link>
            <Link role="menuitem" href="/notifications" className="block px-3 py-2 text-sm hover:bg-navy/5">
              {labels.notifications}
            </Link>
            <SignOutForm
              className="border-t border-line p-2"
              buttonClassName="flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-3 text-sm font-semibold text-on-brand hover:brightness-95"
              label={labels.signOut}
            />
          </div>
        )}
      </div>
    </header>
  );
}
