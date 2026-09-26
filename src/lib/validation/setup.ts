import { z } from 'zod';
import { emailSchema, nameSchema } from './common';

/**
 * First-run setup: when it is open, and what its form accepts.
 *
 * Everything here is pure and safe on either side of the network. The form
 * imports `slugify` for its live preview, the server action and
 * scripts/bootstrap.ts validate with the same schema, and env.ts reads
 * SETUP_TOKEN through `setupTokenSchema` - so nothing in this file may reach
 * the database, node:crypto or a module marked server-only.
 */

// ------------------------------------------------------------------ guards --

/**
 * - `closed`: somebody already has an account, so setup is over. Every user
 *   row counts, suspended and soft-deleted ones included, so deactivating
 *   people can never reopen it.
 * - `create`: an empty database. Create the institution and its administrator.
 * - `attach`: one institution exists but nobody runs it (it was created by
 *   hand, or its people were removed). Attach the administrator to it.
 * - `ambiguous`: several institutions and nobody to run them. Setup refuses
 *   rather than guess which one the new administrator belongs to.
 */
export type SetupMode = 'closed' | 'create' | 'attach' | 'ambiguous';

export function decideSetup(counts: { users: number; institutions: number }): SetupMode {
  // Only an exact zero opens setup. A count that is somehow negative, NaN or
  // fractional fails closed rather than open.
  if (counts.users !== 0) return 'closed';
  if (counts.institutions === 0) return 'create';
  if (counts.institutions === 1) return 'attach';
  return 'ambiguous';
}

// -------------------------------------------------------------------- slug --

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 48;

/**
 * Turns an institution's name into its short name: "École Supérieure d'Art"
 * becomes `ecole-superieure-dart`. Returns an empty string when nothing in
 * the input survives, for example a name written entirely in another script.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // é -> e: drop the accents NFKD split off
    .toLowerCase()
    .replace(/['\u2019]/g, '') // St Mary's -> st-marys, not st-mary-s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, ''); // the cut can land just after a hyphen
}

function slugProblem(slug: string): string | null {
  if (!slug) return 'Choose a short name made of letters and numbers.';
  if (slug.length < 2) return 'Use at least two characters.';
  if (slug.length > SLUG_MAX_LENGTH) return `Keep this to ${SLUG_MAX_LENGTH} characters or fewer.`;
  if (!SLUG_PATTERN.test(slug)) {
    return 'Use lowercase letters, numbers and single hyphens, like msri or city-college.';
  }
  return null;
}

// -------------------------------------------------------------------- form --

export const INSTITUTION_NAME_MAX_LENGTH = 120;
export const PASSWORD_MAX_LENGTH = 256;

/** Every field the setup form can report an error against. */
export type SetupField =
  | 'setupToken'
  | 'institutionName'
  | 'institutionSlug'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'password'
  | 'passwordConfirmation';

export interface SetupAdmin {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

/**
 * What a valid submission becomes. The mode is the one the form was rendered
 * for; the service checks it again under its lock and refuses if the database
 * has changed underneath the person filling it in.
 */
export type SetupInput =
  | { mode: 'create'; institution: { name: string; slug: string }; admin: SetupAdmin }
  | { mode: 'attach'; admin: SetupAdmin };

/**
 * The form's shape. The password policy is deliberately not here: it lives in
 * src/lib/auth/password, beside argon2, which cannot be shipped to a browser.
 * `parseSetupSubmission` in the setup service applies both in one pass.
 */
export const setupFormSchema = z
  .object({
    mode: z.enum(['create', 'attach'], {
      errorMap: () => ({ message: 'Reload the page and start again.' }),
    }),
    // Only read in create mode. Attach mode's form has no institution fields.
    institutionName: z
      .string()
      .trim()
      .max(INSTITUTION_NAME_MAX_LENGTH, `Keep this under ${INSTITUTION_NAME_MAX_LENGTH} characters.`)
      .optional(),
    institutionSlug: z.string().trim().toLowerCase().optional(),
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
    // Never trimmed: a space is as good a character in a password as any.
    password: z
      .string()
      .min(1, 'Choose a password.')
      .max(PASSWORD_MAX_LENGTH, `Keep this under ${PASSWORD_MAX_LENGTH} characters.`),
    passwordConfirmation: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.password && data.password !== data.passwordConfirmation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passwordConfirmation'],
        message: 'The two passwords do not match.',
      });
    }

    if (data.mode !== 'create') return;

    const name = data.institutionName ?? '';
    if (name.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['institutionName'],
        message: "Enter the institution's name.",
      });
      return;
    }

    // A blank short name is derived from the name, so a form submitted
    // without JavaScript (and so without the live preview) still works.
    const problem = slugProblem(data.institutionSlug || slugify(name));
    if (problem) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['institutionSlug'], message: problem });
    }
  })
  .transform((data): SetupInput => {
    const admin: SetupAdmin = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
    };

    if (data.mode === 'attach') return { mode: 'attach', admin };

    const name = data.institutionName ?? '';
    return {
      mode: 'create',
      institution: { name, slug: data.institutionSlug || slugify(name) },
      admin,
    };
  });

// ------------------------------------------------------------------- token --

export const SETUP_TOKEN_MIN_LENGTH = 16;

/**
 * SETUP_TOKEN as read from the environment. Optional: when it is set, /setup
 * also asks for it.
 *
 * Blank means unset. A copied `SETUP_TOKEN=` line and compose's `${VAR:-}`
 * both deliver an empty string rather than leaving the variable out, and a
 * bare `.optional()` accepts "" as a value that is present. That is a token
 * which is "required" and equal to nothing, or, with a length rule attached,
 * a boot that fails over a variable nobody meant to set. Real values are
 * trimmed, since a trailing newline from a secrets file is not part of the
 * token, and must be long enough to be worth guessing at.
 */
export const setupTokenSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .min(
      SETUP_TOKEN_MIN_LENGTH,
      `SETUP_TOKEN must be at least ${SETUP_TOKEN_MIN_LENGTH} characters, or left unset.`,
    )
    .optional(),
);
