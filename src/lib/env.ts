import { z } from 'zod';

/**
 * Environment is validated once at boot. A missing or malformed variable fails
 * fast instead of surfacing as a confusing runtime error in a request handler.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('Institutional LMS'),
  /** Tenant served by the public pages (application form, certificate verification). */
  PUBLIC_INSTITUTION_SLUG: z.string().optional(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().min(1),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(120),

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('af-south-1'),
  S3_BUCKET: z.string().default('lms-files'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),

  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Institutional LMS <no-reply@example.ac.za>'),

  REDIS_URL: z.string().optional(),
  QUEUE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  RATE_LIMIT_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** Optional malware scanner. Without it uploads are marked SKIPPED, not CLEAN. */
  MALWARE_SCANNER_URL: z.string().url().optional(),
  MALWARE_SCANNER_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
