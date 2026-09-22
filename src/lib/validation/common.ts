import { z } from 'zod';

/** South African mobile and landline numbers, accepting +27 or 0 prefixes. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?27|0)[1-9]\d{8}$/, 'Enter a valid South African phone number.')
  .optional()
  .or(z.literal(''));

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least two characters.')
  .max(80, 'Keep this under 80 characters.');

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
  .transform((value) => new Date(`${value}T00:00:00Z`));

/** Form actions return this shape so every form renders errors the same way. */
export interface FormState {
  status?: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const flat = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flat)
      .filter(([, messages]) => messages && messages.length > 0)
      .map(([field, messages]) => [field, messages![0]!]),
  );
}
