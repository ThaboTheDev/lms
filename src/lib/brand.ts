import type { CSSProperties } from 'react';

/**
 * Visual identity for the Mzuvukile Slabbert Radebe Institute, taken from the
 * public site (msri-website: assets/css/global.css). Navy is structure, gold is
 * the single accent. Space-separated RGB is what the Tailwind tokens expect.
 */

export const BRAND = {
  shortName: 'MSRI',
  name: 'Mzuvukile Slabbert Radebe Institute',
  tagline: 'Transforming the African landscape. Grounded in innovation.',
  established: '2015',
  website: 'https://msri-website.vercel.app/',
  navy: '#0B113B',
  gold: '#CBA65E',
  goldBright: '#E9C176',
} as const;

/** Colours the original schema shipped with, before this deployment was MSRI. */
const LEGACY_PRIMARY = new Set(['#12333F', '#12333f']);
const LEGACY_SECONDARY = new Set(['#0F6E5C', '#0f6e5c']);
const LEGACY_NAME = /kopano|institutional lms/i;

export function hexToChannels(hex: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const value = Number.parseInt(digits, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/**
 * The chrome says MSRI unless an administrator has deliberately named the
 * institution something else. A database still carrying the fictional Kopano
 * seed should not keep that name on screen.
 */
export function displayInstitutionName(name?: string | null): string {
  if (!name || LEGACY_NAME.test(name)) return BRAND.name;
  return name;
}

/**
 * CSS variables for a signed-in institution. Applied on a wrapper so they
 * inherit into the shell. The historical defaults are left unset: those rows
 * predate the MSRI palette, and injecting them would paint the old green back
 * over the stylesheet.
 *
 * Only the structural tokens are overridden. Text colours stay with the
 * stylesheet so a dark colour scheme can still flip them.
 */
export function institutionBrandStyle(
  primary?: string | null,
  secondary?: string | null,
): CSSProperties | undefined {
  if (!primary || !secondary) return undefined;
  if (LEGACY_PRIMARY.has(primary) && LEGACY_SECONDARY.has(secondary)) return undefined;

  const navy = hexToChannels(primary);
  const gold = hexToChannels(secondary);
  if (!navy || !gold) return undefined;

  return {
    '--navy': navy,
    '--rail': navy,
    '--brand': gold,
    '--gold': gold,
    '--rail-accent': gold,
    '--on-brand': navy,
  } as CSSProperties;
}
