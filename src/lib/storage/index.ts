/**
 * src/lib/storage/index.ts
 *
 * Object storage behind one interface, with two implementations: an S3
 * compatible service (AWS, MinIO, R2) and a local directory for development.
 *
 * The application never holds file bytes. It hands the browser a short-lived
 * URL to PUT to and, later, one to read from, which is what keeps a large
 * intake from turning the web tier into a file proxy. The local driver breaks
 * that rule deliberately - it writes to a directory on this machine - so the
 * whole flow can be exercised without running MinIO.
 *
 * Keys are the security boundary: every object lives under the id of the
 * institution that owns it, and every key is checked against the caller's
 * institution before it is signed or read. See `./keys.ts`.
 */
import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { checkUpload, keyBelongsToInstitution, sanitiseFilename } from './keys';

/** Long enough for a slow connection to start, short enough to leak little. */
const SIGNED_URL_TTL_SECONDS = 300;

export interface StorageDriver {
  /** Short-lived URL the browser PUTs the file bytes to. */
  presignUpload(key: string, mimeType: string): Promise<string>;
  /** Short-lived URL a browser can be redirected to in order to read the file. */
  presignDownload(key: string, filename: string): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Server-side reads and writes. Browsers still upload and download directly;
   * these are for the work the server does with a file itself: streaming it to
   * a ClamAV scanner, unpacking a SCORM or H5P package, storing a generated
   * document.
   */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

/**
 * The bucket an object is recorded against. Local storage has no buckets, so
 * it gets a name that says what it is rather than a borrowed S3 one.
 */
export const storageBucket = env.STORAGE_DRIVER === 's3' ? env.S3_BUCKET : 'local';

/** RFC 6266 attachment header, with the filename escaped for non-ASCII names. */
function contentDisposition(filename: string): string {
  const safe = sanitiseFilename(filename).replace(/"/g, '');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/* -------------------------------------------------------------------- s3 --- */

let s3: S3Client | null = null;

function s3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      // MinIO and most S3-compatible services need paths rather than subdomains.
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      // Without an explicit key pair the SDK falls back to its own chain, which
      // is how a deployment on IAM roles or an instance profile works.
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  return s3;
}

const s3Driver: StorageDriver = {
  async presignUpload(key, mimeType) {
    return getSignedUrl(
      s3Client(),
      new PutObjectCommand({ Bucket: storageBucket, Key: key, ContentType: mimeType }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  },

  async presignDownload(key, filename) {
    return getSignedUrl(
      s3Client(),
      new GetObjectCommand({
        Bucket: storageBucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(filename),
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  },

  async delete(key) {
    await s3Client().send(new DeleteObjectCommand({ Bucket: storageBucket, Key: key }));
  },

  async put(key, body, contentType) {
    await s3Client().send(
      new PutObjectCommand({ Bucket: storageBucket, Key: key, Body: body, ContentType: contentType }),
    );
  },

  async get(key) {
    try {
      const object = await s3Client().send(new GetObjectCommand({ Bucket: storageBucket, Key: key }));
      return object.Body ? await object.Body.transformToByteArray() : null;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw error;
    }
  },
};

/* ----------------------------------------------------------------- local --- */

/** Development storage, ignored by git and mounted nowhere in production. */
const LOCAL_ROOT = path.resolve(process.cwd(), 'storage');

/**
 * Resolves a key to a path underneath the storage root.
 *
 * The check is the point: a key that climbs out of the root - however it was
 * built - is refused here rather than written wherever it points.
 */
function localPath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (resolved !== LOCAL_ROOT && !resolved.startsWith(LOCAL_ROOT + path.sep)) {
    throw new AppError('That storage key is not valid.', 400, 'bad_request');
  }
  return resolved;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

const localDriver: StorageDriver = {
  // The browser PUTs to the application route that stands in for S3; it is the
  // only place the local driver differs from a real object store.
  async presignUpload(key) {
    return `${env.APP_URL.replace(/\/$/, '')}/api/v1/files/local?key=${encodeURIComponent(key)}`;
  },

  async presignDownload(key) {
    return `${env.APP_URL.replace(/\/$/, '')}/api/v1/files/local?key=${encodeURIComponent(key)}`;
  },

  async put(key, body) {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  },

  async get(key) {
    try {
      return await readFile(localPath(key));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  },

  async delete(key) {
    await rm(localPath(key), { force: true });
  },
};

export const storage: StorageDriver = env.STORAGE_DRIVER === 's3' ? s3Driver : localDriver;

/* ------------------------------------------------------------------ rules --- */

/**
 * Stops an upload that the institution does not accept.
 *
 * The limit comes from `MAX_UPLOAD_MB` rather than from the caller, so a
 * browser that never ran the check still cannot talk its way past it.
 */
export function assertUploadAllowed(mimeType: string, sizeBytes: number | bigint): void {
  const result = checkUpload(mimeType, sizeBytes, { maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024 });
  if (!result.ok) throw new AppError(result.problem, 422, 'upload_rejected');
}

/**
 * Asserts that a key belongs to the caller's institution before it is signed,
 * read or deleted. Signed URLs outlive the request that issued them, so this is
 * the last chance to refuse one that points at another tenant's objects.
 */
export function assertKeyOwnedBy(key: string, institutionId: string): void {
  if (!keyBelongsToInstitution(key, institutionId)) {
    throw new AppError('That file does not belong to this institution.', 403, 'forbidden');
  }
}

export {
  buildStorageKey,
  checkUpload,
  humanFileSize,
  isPreviewable,
  keyBelongsToInstitution,
  sanitiseFilename,
} from './keys';
export type { UploadCheck, UploadPolicy } from './keys';
