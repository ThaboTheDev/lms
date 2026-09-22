/**
 * src/lib/storage/keys.ts
 */

/**
 * Converts a byte count into a human-readable string (e.g., "1.5 MB", "500 KB").
 */
export function humanFileSize(bytes: number, si = true, dp = 1): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return `${bytes.toFixed(dp)} ${units[u]}`;
}

/**
 * Helper to construct standard object keys for storage uploads.
 */
export function buildStorageKey(prefix: string, filename: string): string {
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${cleanPrefix}/${timestamp}-${safeName}`;
}
