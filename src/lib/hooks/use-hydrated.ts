'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the HTML the server sends, and for as long as that HTML is all the
 * browser has: before the scripts arrive, or when they never do. True once
 * React is running.
 *
 * Forms that show fields depending on an earlier choice use it to show every
 * field until they can react to that choice. Otherwise a form submitted before
 * the scripts load, or with scripts off, posts without the field the choice
 * needed and fails for a reason the person filling it in cannot see.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
