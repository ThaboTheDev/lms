/**
 * What may come out of an uploaded package archive, and how it is served.
 * Pure: the unpacking job and the tests use the same rules.
 */

/** Generous for real packages, small enough that an archive bomb stops early. */
export const PACKAGE_LIMITS = {
  maxEntries: 10_000,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxEntryBytes: 512 * 1024 * 1024,
};

/**
 * A safe relative path for an archive entry, or null for one that must be
 * skipped: directories, absolute paths, anything climbing out with `..`,
 * and the metadata some archivers add.
 */
export function safeEntryPath(name: string): string | null {
  const normalised = name.replace(/\\/g, '/');
  if (normalised.endsWith('/')) return null;
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) return null;
  const parts = normalised.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) return null;
  if (parts[0] === '__MACOSX' || parts.at(-1) === '.DS_Store' || parts.at(-1) === 'Thumbs.db') return null;
  if (parts.some((part) => part.startsWith('__lms'))) return null; // reserved for the player's own files
  return parts.join('/');
}

/**
 * Some tools zip the folder rather than its contents. When every entry sits
 * under one top-level folder that holds the manifest, that folder is dropped.
 */
export function commonRoot(paths: string[], manifest: string): string {
  if (paths.includes(manifest)) return '';
  const roots = new Set(paths.map((path) => path.split('/')[0]));
  if (roots.size !== 1) return '';
  const [root] = [...roots];
  return paths.includes(`${root}/${manifest}`) ? `${root}/` : '';
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  xsd: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf',
  swf: 'application/x-shockwave-flash',
  wasm: 'application/wasm',
};

export function contentTypeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return TYPES[extension] ?? 'application/octet-stream';
}

export function isHtml(path: string): boolean {
  return /\.x?html?$/i.test(path);
}
