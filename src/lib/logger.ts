/**
 * Structured logging. One line of JSON per event, because a log an operator has
 * to parse with their eyes at two in the morning is a log that does not get
 * read. Fields are named the same way everywhere so a query works across every
 * service.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  event: string;
  institutionId?: string | null;
  userId?: string | null;
  durationMs?: number;
  count?: number;
  [key: string]: unknown;
}

/** Never logged, whatever a caller passes. */
const FORBIDDEN = new Set([
  'password', 'passwordHash', 'token', 'tokenHash', 'secret', 'mfaSecret',
  'authorization', 'cookie', 'nationalIdRef', 'idNumber', 'cardNumber',
]);

function scrub(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) =>
      FORBIDDEN.has(key) ? [key, '[redacted]'] : [key, value],
    ),
  );
}

function emit(level: LogLevel, fields: LogFields) {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    ...scrub(fields),
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (fields: LogFields) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', fields);
  },
  info: (fields: LogFields) => emit('info', fields),
  warn: (fields: LogFields) => emit('warn', fields),
  error: (fields: LogFields & { error?: unknown }) =>
    emit('error', {
      ...fields,
      error:
        fields.error instanceof Error
          ? { message: fields.error.message, name: fields.error.name }
          : fields.error,
    }),
};

/** Times a block and logs how long it took, whatever the outcome. */
export async function timed<T>(event: string, work: () => Promise<T>, fields: Partial<LogFields> = {}) {
  const startedAt = Date.now();
  try {
    const result = await work();
    log.info({ event, durationMs: Date.now() - startedAt, ...fields });
    return result;
  } catch (error) {
    log.error({ event, durationMs: Date.now() - startedAt, error, ...fields });
    throw error;
  }
}
