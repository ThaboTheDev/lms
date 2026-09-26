import { z } from 'zod';
import { setupTokenSchema } from './validation/setup';

/**
 * `KEY=` in a .env file (and `${KEY:-}` in compose) arrives as an empty
 * string, not as a missing key. For an optional setting, empty means unset:
 * otherwise a blank MALWARE_SCANNER_URL fails URL validation and the whole
 * application refuses to boot.
 */
const blankAsUnset = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalString = z.preprocess(blankAsUnset, z.string().optional());
const optionalUrl = z.preprocess(blankAsUnset, z.string().url().optional());
const optionalInt = z.preprocess(blankAsUnset, z.coerce.number().int().optional());

/** z.coerce.boolean() turns the string "false" into true; this does not. */
const flag = (fallback: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
  }, z.boolean());

/**
 * Environment is validated once at boot. A missing or malformed variable fails
 * fast instead of surfacing as a confusing runtime error in a request handler.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('MSRI'),
  /** Tenant served by the public pages (application form, certificate verification). */
  PUBLIC_INSTITUTION_SLUG: optionalString,
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().min(1),
  /**
   * Optional second key for the first-run /setup page. Blank counts as unset;
   * see setupTokenSchema for why that has to be explicit.
   */
  SETUP_TOKEN: setupTokenSchema,

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(120),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('af-south-1'),
  S3_BUCKET: z.string().default('lms-files'),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: flag(true),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),

  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalInt,
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  MAIL_FROM: z.string().default('MSRI <no-reply@msri.online>'),

  REDIS_URL: optionalString,
  QUEUE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  RATE_LIMIT_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** Optional malware scanner. Without it uploads are marked SKIPPED, not CLEAN. */
  /** Extra https origins lessons may frame, beyond the players in src/lib/embed.ts. */
  EMBED_ALLOWED_ORIGINS: optionalString,
  MALWARE_SCANNER_URL: optionalUrl,
  MALWARE_SCANNER_TOKEN: optionalString,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
