/**
 * src/lib/storage/keys.ts
 *
 * Storage keys and the rules that decide what may be stored under them.
 *
 * This module is imported by client components - the uploader formats the size
 * of the file it has just sent - so it is deliberately free of server-only
 * imports: no `env`, no Prisma, nothing that reads configuration at module
 * load. Anything that needs the environment lives in `./index.ts`.
 */

/** What an institution actually uploads: documents, media and archives. */
const ALLOWED_MIME_TYPES = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/markdown',
  'text/plain',
  // Images
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  // Audio and video
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  // Archives. Windows browsers call a ZIP application/x-zip-compressed.
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
]);

/**
 * Types a browser can render itself rather than hand to a download manager.
 * Kept apart from the allowlist: a ZIP is a perfectly good submission and still
 * has to be downloaded.
 */
const PREVIEWABLE_TYPES = new Set(['application/pdf', 'text/csv', 'text/markdown', 'text/plain']);

/** Binary units, because a file's size on disk is counted in powers of two. */
const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] as const;
const BYTES_PER_UNIT = 1024;

export interface UploadPolicy {
  maxBytes: number;
  /** Types a particular context allows on top of the institution's allowlist. */
  extraMimeTypes?: string[];
}

export interface UploadCheck {
  ok: boolean;
  /** Why the file was refused, in words that can be shown to the uploader. */
  problem: string;
}

/** `image/PNG; charset=binary` and `image/png` are the same type here. */
function normaliseMimeType(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase();
}

/** Rounds the configured limit to something a person can be told about. */
function describeLimit(maxBytes: number): string {
  const megabytes = maxBytes / (BYTES_PER_UNIT * BYTES_PER_UNIT);
  if (megabytes >= 1) return `${Math.round(megabytes)} MB`;
  return `${Math.max(1, Math.round(maxBytes / BYTES_PER_UNIT))} KB`;
}

/**
 * Whether a file may be stored at all. Type is checked before size so that the
 * answer to "what is wrong with my file" is the one thing that is wrong with
 * it, and so that a disallowed type never gets quoted a size limit it would
 * otherwise pass.
 */
export function checkUpload(
  mimeType: string,
  sizeBytes: number | bigint,
  policy: UploadPolicy,
): UploadCheck {
  const type = normaliseMimeType(mimeType);
  const extra = (policy.extraMimeTypes ?? []).map(normaliseMimeType);

  if (!ALLOWED_MIME_TYPES.has(type) && !extra.includes(type)) {
    return { ok: false, problem: 'Files of that type are not accepted.' };
  }

  const bytes = typeof sizeBytes === 'bigint' ? Number(sizeBytes) : sizeBytes;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, problem: 'That file is empty.' };
  }

  if (bytes > policy.maxBytes) {
    return { ok: false, problem: `That file is larger than the ${describeLimit(policy.maxBytes)} limit.` };
  }

  return { ok: true, problem: '' };
}

/**
 * Reduces an uploaded filename to something safe to store and to serve back.
 * Any directory is stripped first, then every run of characters that is not
 * plainly safe collapses into a single underscore, and leading dots go, so
 * there is no way to smuggle a path or a hidden file through a name.
 */
export function sanitiseFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? '';
  const collapsed = basename.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return collapsed.length > 0 ? collapsed : 'file';
}

/**
 * Builds the object key for an upload.
 *
 * The institution id comes first and every segment is sanitised, so one
 * tenant's objects cannot be written into another tenant's prefix and a folder
 * cannot climb out of the prefix it was given. The timestamp keeps two uploads
 * of the same name from overwriting each other.
 */
export function buildStorageKey(
  institutionId: string,
  folder: string,
  filename: string,
  now: Date = new Date(),
): string {
  const prefix = institutionId.replace(/[^A-Za-z0-9_-]/g, '');
  const segments = folder
    .split('/')
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter((segment) => segment.length > 0);

  return [prefix, ...segments, `${now.getTime()}-${sanitiseFilename(filename)}`].join('/');
}

/**
 * Whether a key sits inside an institution's prefix.
 *
 * Compared segment by segment rather than with `startsWith`, because
 * `inst_1/../inst_2/a.pdf` starts with `inst_1/` and belongs to nobody's
 * prefix at all.
 */
export function keyBelongsToInstitution(key: string, institutionId: string): boolean {
  if (!institutionId) return false;
  if (key.length === 0 || key.startsWith('/') || key.includes('\\')) return false;

  const segments = key.split('/');
  if (segments[0] !== institutionId) return false;
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

/** Whether the browser can show this file itself rather than downloading it. */
export function isPreviewable(mimeType: string): boolean {
  const type = normaliseMimeType(mimeType);

  if (type.startsWith('image/')) {
    // SVG is markup, not a picture: opening one in the institution's own origin
    // hands whoever uploaded it a script execution context.
    return type !== 'image/svg+xml';
  }
  if (type.startsWith('video/') || type.startsWith('audio/')) return true;

  return PREVIEWABLE_TYPES.has(type);
}

/**
 * Converts a byte count into a human-readable string.
 *
 * `sizeBytes` is a `BigInt` on a Prisma `FileObject`, so both are accepted.
 * Decimals grow with the unit - a kilobyte is quoted whole, a megabyte to one
 * decimal, a gigabyte to two - because one decimal place on a gigabyte hides a
 * hundred megabytes, which is the difference between a lecture recording and a
 * submission.
 */
export function humanFileSize(bytes: number | bigint): string {
  const value = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (!Number.isFinite(value)) return '—';

  if (Math.abs(value) < BYTES_PER_UNIT) return `${value} B`;

  let scaled = value;
  let unit = -1;
  do {
    scaled /= BYTES_PER_UNIT;
    unit += 1;
  } while (Math.abs(scaled) >= BYTES_PER_UNIT && unit < SIZE_UNITS.length - 1);

  return `${scaled.toFixed(unit)} ${SIZE_UNITS[unit] ?? 'B'}`;
}
