import { describe, expect, it } from 'vitest';
import {
  decideSetup,
  SETUP_TOKEN_MIN_LENGTH,
  setupFormSchema,
  setupTokenSchema,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  slugify,
} from '@/lib/validation/setup';
import {
  parseSetupSubmission,
  setupConflictFields,
  setupTokenAccepted,
} from '@/server/services/setup';

const STRONG_PASSWORD = 'Winter-Harbour-Lantern-42';

function form(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'create',
    institutionName: 'Mzuvukile Slabbert Radebe Institute',
    institutionSlug: '',
    firstName: 'Palesa',
    lastName: 'Ndlovu',
    email: 'palesa.ndlovu@example.ac.za',
    password: STRONG_PASSWORD,
    passwordConfirmation: STRONG_PASSWORD,
    ...overrides,
  };
}

function fieldErrors(raw: Record<string, unknown>) {
  const result = parseSetupSubmission(raw);
  return result.success ? {} : result.fieldErrors;
}

describe('when setup is open', () => {
  it.each([
    { users: 0, institutions: 0, mode: 'create' },
    { users: 0, institutions: 1, mode: 'attach' },
    { users: 0, institutions: 2, mode: 'ambiguous' },
    { users: 0, institutions: 7, mode: 'ambiguous' },
    { users: 1, institutions: 0, mode: 'closed' },
    { users: 1, institutions: 1, mode: 'closed' },
    { users: 3, institutions: 5, mode: 'closed' },
  ] as const)('$users users and $institutions institutions is $mode', ({ users, institutions, mode }) => {
    expect(decideSetup({ users, institutions })).toBe(mode);
  });

  it('fails closed on a user count that is not an exact zero', () => {
    expect(decideSetup({ users: Number.NaN, institutions: 0 })).toBe('closed');
    expect(decideSetup({ users: -1, institutions: 0 })).toBe('closed');
    expect(decideSetup({ users: 0.5, institutions: 0 })).toBe('closed');
  });

  it('refuses rather than guess on an institution count it cannot read', () => {
    expect(decideSetup({ users: 0, institutions: Number.NaN })).toBe('ambiguous');
    expect(decideSetup({ users: 0, institutions: -1 })).toBe('ambiguous');
  });
});

describe('short names', () => {
  it('derives a short name from the institution name', () => {
    expect(slugify('Mzuvukile Slabbert Radebe Institute')).toBe('mzuvukile-slabbert-radebe-institute');
    expect(slugify('MSRI')).toBe('msri');
  });

  it('folds accents and drops apostrophes instead of splitting on them', () => {
    expect(slugify("École Supérieure d'Art")).toBe('ecole-superieure-dart');
    expect(slugify('St Mary’s College')).toBe('st-marys-college');
  });

  it('collapses punctuation and spacing into single hyphens, trimmed at both ends', () => {
    expect(slugify('  --Arts & Culture__College!!  ')).toBe('arts-culture-college');
    expect(slugify('Campus   2026 / North')).toBe('campus-2026-north');
  });

  it('gives up with an empty string when nothing usable survives', () => {
    expect(slugify('大学')).toBe('');
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('truncates long names without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} college of everything`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toMatch(SLUG_PATTERN);
  });

  it('only ever produces something the pattern accepts, and is stable when repeated', () => {
    const names = [
      'Mzuvukile Slabbert Radebe Institute',
      'Ünïcödé Ïnstitütë of Tëchnology',
      'A.B.C. Training (Pty) Ltd',
      '123 Numbers First',
      'x'.repeat(200),
    ];
    for (const name of names) {
      const slug = slugify(name);
      expect(slug).toMatch(SLUG_PATTERN);
      expect(slugify(slug)).toBe(slug);
    }
  });
});

describe('the setup form', () => {
  it('fills the short name in from the institution name when it is left blank', () => {
    const result = setupFormSchema.parse(form());
    expect(result).toMatchObject({
      mode: 'create',
      institution: {
        name: 'Mzuvukile Slabbert Radebe Institute',
        slug: 'mzuvukile-slabbert-radebe-institute',
      },
    });
  });

  it('takes a short name that was typed, trimmed and lowercased', () => {
    const result = setupFormSchema.parse(form({ institutionSlug: '  MSRI ' }));
    expect(result.mode === 'create' && result.institution.slug).toBe('msri');
  });

  it.each(['bad slug', '-msri', 'msri-', 'ms--ri', 'm', 'ñu', 'x'.repeat(SLUG_MAX_LENGTH + 1)])(
    'rejects the short name %j',
    (institutionSlug) => {
      expect(fieldErrors(form({ institutionSlug }))).toHaveProperty('institutionSlug');
    },
  );

  it('asks for a short name when the institution name yields none', () => {
    const errors = fieldErrors(form({ institutionName: '大学' }));
    expect(errors).toHaveProperty('institutionSlug');
    expect(errors).not.toHaveProperty('institutionName');
  });

  it('needs an institution name in create mode, and reports only that for it', () => {
    const errors = fieldErrors(form({ institutionName: ' ' }));
    expect(errors).toHaveProperty('institutionName');
    expect(errors).not.toHaveProperty('institutionSlug');
  });

  it('ignores institution fields in attach mode', () => {
    const result = setupFormSchema.parse(
      form({ mode: 'attach', institutionName: undefined, institutionSlug: 'not a slug' }),
    );
    expect(result).toEqual({
      mode: 'attach',
      admin: {
        firstName: 'Palesa',
        lastName: 'Ndlovu',
        email: 'palesa.ndlovu@example.ac.za',
        password: STRONG_PASSWORD,
      },
    });
  });

  it('refuses a mode it does not know', () => {
    expect(fieldErrors(form({ mode: 'closed' }))).toHaveProperty('mode');
  });

  it('trims names and normalises the email address, but never trims the password', () => {
    const padded = ` ${STRONG_PASSWORD} `;
    const result = setupFormSchema.parse(
      form({
        firstName: '  Palesa ',
        email: '  Palesa.Ndlovu@Example.AC.ZA ',
        password: padded,
        passwordConfirmation: padded,
      }),
    );
    expect(result.admin).toMatchObject({
      firstName: 'Palesa',
      email: 'palesa.ndlovu@example.ac.za',
      password: padded,
    });
  });

  it('rejects one-letter names and an address that is not one', () => {
    const errors = fieldErrors(form({ firstName: 'P', email: 'palesa-at-example' }));
    expect(errors).toHaveProperty('firstName');
    expect(errors).toHaveProperty('email');
  });

  it('reports mismatched passwords against the confirmation field', () => {
    const errors = fieldErrors(form({ passwordConfirmation: `${STRONG_PASSWORD}!` }));
    expect(Object.keys(errors)).toEqual(['passwordConfirmation']);
  });
});

describe('the password policy on the setup form', () => {
  it('accepts a strong password', () => {
    expect(parseSetupSubmission(form()).success).toBe(true);
  });

  it('lists every problem with a weak password at once', () => {
    const errors = fieldErrors(form({ password: 'short', passwordConfirmation: 'short' }));
    expect(errors.password).toContain('12 characters');
    expect(errors.password).toContain('uppercase');
    expect(errors.password).toContain('number');
  });

  it("refuses a password built from the administrator's own name", () => {
    const password = 'Palesa-Was-Here-2026';
    expect(fieldErrors(form({ password, passwordConfirmation: password }))).toHaveProperty('password');
  });

  it('accepts a long passphrase without mixed case or numbers', () => {
    const password = 'lantern harbour winter kettle';
    expect(parseSetupSubmission(form({ password, passwordConfirmation: password })).success).toBe(true);
  });

  it('reports policy problems together with the rest of the form, in one pass', () => {
    const errors = fieldErrors(
      form({ email: 'nope', institutionSlug: 'Bad Slug!', password: 'weak', passwordConfirmation: 'weak' }),
    );
    expect(Object.keys(errors).sort()).toEqual(['email', 'institutionSlug', 'password']);
  });
});

describe('the setup token', () => {
  const TOKEN = 'k3Jd9-Qp2Lx8Vn4Rt7Wz';

  it('treats an absent, empty or blank variable as unset', () => {
    expect(setupTokenSchema.parse(undefined)).toBeUndefined();
    expect(setupTokenSchema.parse('')).toBeUndefined();
    expect(setupTokenSchema.parse('   ')).toBeUndefined();
    expect(setupTokenSchema.parse('\n')).toBeUndefined();
  });

  it('refuses a token too short to be worth setting, so the server will not boot with it', () => {
    const short = 'x'.repeat(SETUP_TOKEN_MIN_LENGTH - 1);
    expect(setupTokenSchema.safeParse(short).success).toBe(false);
  });

  it('trims a configured token, such as one read from a file with a newline', () => {
    expect(setupTokenSchema.parse(`${TOKEN}\n`)).toBe(TOKEN);
  });

  it('asks for nothing when no token is configured', () => {
    expect(setupTokenAccepted(undefined, null)).toBe(true);
    expect(setupTokenAccepted(undefined, 'anything')).toBe(true);
    expect(setupTokenAccepted('', null)).toBe(true);
  });

  it('accepts the configured token, allowing for stray whitespace around it', () => {
    expect(setupTokenAccepted(TOKEN, TOKEN)).toBe(true);
    expect(setupTokenAccepted(TOKEN, ` ${TOKEN}\n`)).toBe(true);
  });

  it('rejects a wrong, missing or non-text token', () => {
    expect(setupTokenAccepted(TOKEN, 'k3Jd9-Qp2Lx8Vn4Rt7Wy')).toBe(false);
    expect(setupTokenAccepted(TOKEN, '')).toBe(false);
    expect(setupTokenAccepted(TOKEN, '   ')).toBe(false);
    expect(setupTokenAccepted(TOKEN, null)).toBe(false);
    expect(setupTokenAccepted(TOKEN, new Blob([TOKEN]))).toBe(false);
  });

  it('rejects a token of a different length without throwing', () => {
    expect(() => setupTokenAccepted(TOKEN, TOKEN.slice(0, -1))).not.toThrow();
    expect(setupTokenAccepted(TOKEN, TOKEN.slice(0, -1))).toBe(false);
    expect(setupTokenAccepted(TOKEN, `${TOKEN}x`)).toBe(false);
  });
});

describe('unique conflicts', () => {
  it('maps a clash on the short name to that field, whichever engine reported it', () => {
    const native = { code: 'P2002', meta: { target: ['slug'] } };
    const adapter = { code: 'P2002', meta: { modelName: 'Institution', target: 'Institution_slug_key' } };
    expect(setupConflictFields(native)).toHaveProperty('institutionSlug');
    expect(setupConflictFields(adapter)).toHaveProperty('institutionSlug');
  });

  it('maps a clash on the email address to that field', () => {
    expect(setupConflictFields({ code: 'P2002', meta: { target: ['email'] } })).toHaveProperty('email');
  });

  it('leaves every other error alone', () => {
    expect(setupConflictFields({ code: 'P2003', meta: { target: ['slug'] } })).toBeNull();
    expect(setupConflictFields(new Error('slug'))).toBeNull();
    expect(setupConflictFields(null)).toBeNull();
  });
});
