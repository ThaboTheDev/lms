/**
 * Content security policy, built per request so that every response carries a
 * fresh nonce.
 *
 * Next.js renders the React Server Component payload and its bootstrap as
 * inline scripts. A policy of `script-src 'self'` blocks those, and with them
 * every client component: forms still post, but nothing hydrates, so uploads,
 * the quiz clock, autosave and lesson progress silently do nothing. The
 * middleware generates a nonce, puts this policy on the request (which is how
 * Next.js learns the nonce and stamps it on its own scripts) and on the
 * response (which is what the browser enforces).
 *
 * Pure on purpose: the middleware, the tests and anything else that needs the
 * policy build it the same way.
 */

export interface CspOptions {
  /** Base64 nonce for this response. */
  nonce: string;
  /** S3-compatible endpoint the browser uploads to and previews media from. */
  storageEndpoint?: string | null;
  /** Development needs 'unsafe-eval' for React's debugging and may be framed by a preview pane. */
  production: boolean;
  /** upgrade-insecure-requests only makes sense where the site itself is served over HTTPS. */
  https: boolean;
}

/** The origin of an http(s) storage endpoint, or null for anything else. */
export function storageOrigin(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({ nonce, storageEndpoint, production, https }: CspOptions): string {
  const storage = storageOrigin(storageEndpoint);
  const plusStorage = (directive: string) => (storage ? `${directive} ${storage}` : directive);

  // 'strict-dynamic' lets the nonced bootstrap load the rest of the bundle;
  // browsers that understand it ignore 'self', older ones fall back to it.
  const scripts = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(production ? [] : ["'unsafe-eval'"])];

  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    // Per-institution branding sets CSS custom properties inline.
    "style-src 'self' 'unsafe-inline'",
    plusStorage("img-src 'self' data: blob:"),
    plusStorage("media-src 'self' blob:"),
    "font-src 'self' data:",
    plusStorage("connect-src 'self'"),
    production ? "frame-ancestors 'none'" : 'frame-ancestors *',
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** 128 random bits, base64. Works in the edge runtime and in Node. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
