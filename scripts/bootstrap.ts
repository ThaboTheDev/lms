/**
 * Headless first-run setup: what /setup does, from a shell. For a server whose
 * web port is not reachable yet, or for provisioning that runs unattended.
 *
 *   read -rs PW && printf '%s' "$PW" | npx tsx --env-file=.env scripts/bootstrap.ts \
 *     --institution-name "Mzuvukile Slabbert Radebe Institute" \
 *     --first-name Palesa --last-name Ndlovu --email palesa@example.ac.za \
 *     --password-stdin
 *
 * It needs DATABASE_URL and nothing else (tsx does not read .env by itself,
 * hence --env-file).
 *
 * In the production compose stack, run it in the migrate container, which has
 * the source, tsx and DATABASE_URL (and needs -T to take a piped password):
 *
 *   printf '%s' "$PW" | docker compose -f docker-compose.prod.yml run --rm -T \
 *     migrate npx tsx scripts/bootstrap.ts --institution-name ... --password-stdin
 *
 * It follows the page's rules because it runs the page's service: the same
 * guards under the same advisory lock, the same validation, the same password
 * policy, and it refuses exactly when the page would. It does not ask for
 * SETUP_TOKEN: a shell on the server is already more than the token proves.
 *
 * Exit codes: 0 set up, 1 refused or invalid input, 2 usage error.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../src/lib/errors';
import {
  completeSetup,
  parseSetupSubmission,
  readSetupState,
  setupAuditEntry,
} from '../src/server/services/setup';

const prisma = new PrismaClient();

const USAGE = `Usage: npx tsx --env-file=.env scripts/bootstrap.ts [options] --password-stdin

Creates the first institution and its first administrator on a database that
has no users. Refuses, and changes nothing, once anybody has an account.

  --institution-name <name>  The institution's name. Required when the database
                             has no institution; refused when it already has one,
                             because the administrator is attached to that one.
  --institution-slug <slug>  Its short name. Derived from the name when omitted.
  --first-name <name>        The administrator's first name.
  --last-name <name>         The administrator's last name.
  --email <address>          The address the administrator signs in with.
  --password-stdin           Read the password from stdin. It is never taken as
                             an argument, where shell history and ps can see it.
  -h, --help                 Show this help.`;

const FLAGS: Record<string, string> = {
  mode: 'setup state',
  institutionName: '--institution-name',
  institutionSlug: '--institution-slug',
  firstName: '--first-name',
  lastName: '--last-name',
  email: '--email',
  password: 'password',
  passwordConfirmation: 'password',
};

function printFieldErrors(fieldErrors: Record<string, string | undefined>) {
  for (const [field, message] of Object.entries(fieldErrors)) {
    if (message) console.error(`  ${FLAGS[field] ?? field}: ${message}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  // One trailing newline is what `echo` or a here-string adds, not the password.
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        'institution-name': { type: 'string' },
        'institution-slug': { type: 'string' },
        'first-name': { type: 'string' },
        'last-name': { type: 'string' },
        email: { type: 'string' },
        'password-stdin': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${USAGE}`);
    return 2;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values['password-stdin']) {
    console.error(`Pass the password on stdin with --password-stdin.\n\n${USAGE}`);
    return 2;
  }
  if (process.stdin.isTTY) {
    // Typed straight into the terminal it would echo. Pipe it in instead.
    console.error(`--password-stdin reads a piped password, for example:\n  read -rs PW && printf '%s' "$PW" | npx tsx --env-file=.env scripts/bootstrap.ts ... --password-stdin`);
    return 2;
  }
  const password = await readStdin();

  const state = await readSetupState(prisma);
  if (state.mode === 'closed') {
    console.error('Setup has already been completed: this database has users. Nothing was changed.');
    return 1;
  }
  if (state.mode === 'ambiguous') {
    console.error(
      'This database holds more than one institution and no users, and setup will not guess which one the administrator belongs to. Nothing was changed.',
    );
    return 1;
  }
  if (!state.rolesReady) {
    console.error('The system roles do not exist yet. Run `npm run rbac:sync` first. Nothing was changed.');
    return 1;
  }
  if (state.mode === 'attach' && (values['institution-name'] || values['institution-slug'])) {
    console.error(
      `An institution already exists: ${state.institution.name} (${state.institution.slug}). The administrator is attached to it; run again without --institution-name and --institution-slug. Nothing was changed.`,
    );
    return 1;
  }

  const submission = parseSetupSubmission({
    mode: state.mode,
    institutionName: values['institution-name'],
    institutionSlug: values['institution-slug'],
    firstName: values['first-name'] ?? '',
    lastName: values['last-name'] ?? '',
    email: values.email ?? '',
    password,
    passwordConfirmation: password,
  });
  if (!submission.success) {
    console.error('Nothing was changed. Fix these and run it again:');
    printFieldErrors(submission.fieldErrors);
    return 1;
  }

  const result = await completeSetup(prisma, submission.data);

  // The page records this through recordAudit, which is server-only; the row
  // itself is the same.
  try {
    await prisma.auditLog.create({ data: setupAuditEntry(result, 'bootstrap_script') });
  } catch (error) {
    console.error('Warning: set up, but the audit entry could not be written.', error);
  }

  const appUrl = process.env.APP_URL?.replace(/\/$/, '') ?? '';
  console.log(
    [
      'Setup complete.',
      `  Institution:   ${result.institution.name} (${result.institution.slug})${result.institutionCreated ? ', created' : ', existing'}`,
      `  Administrator: ${result.email}`,
      '',
      `Sign in at ${appUrl}/login, then turn on two step sign in straight away:`,
      'the menu under your name, Account and security (/security).',
    ].join('\n'),
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof AppError) {
      console.error(`${error.message} Nothing was changed.`);
      if (error.details && typeof error.details === 'object') {
        printFieldErrors(error.details as Record<string, string>);
      }
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
