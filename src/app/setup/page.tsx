import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { PublicFrame } from '@/components/brand/public-frame';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '@/lib/validation/setup';
import { readSetupState } from '@/server/services/setup';
import { SetupForm } from './setup-form';

export const metadata: Metadata = { title: 'First-run setup' };

// Asked of the database on every request. Prerendered, the page would carry
// whatever the build machine's database happened to say.
export const dynamic = 'force-dynamic';

/**
 * Creates the first institution and its first administrator, and exists only
 * until then: once anybody has an account, it redirects to sign in before it
 * renders anything.
 */
export default async function SetupPage() {
  const state = await readSetupState(prisma);
  if (state.mode === 'closed') redirect('/login');

  return (
    <PublicFrame width="lg" showApply={false}>
      <p className="eyebrow">First run</p>
      <h1 className="font-serif text-3xl font-semibold">Set up the platform</h1>

      {state.mode === 'ambiguous' ? (
        <Blocked title="Setup cannot choose an institution">
          <p>
            This database already holds more than one institution, and nobody has an account to run
            them. Setup attaches the first administrator to a single institution and will not guess
            which one you mean.
          </p>
          <p>
            Remove the institutions that should not be there, or create the administrator by hand, and
            then sign in.
          </p>
        </Blocked>
      ) : !state.rolesReady ? (
        <Blocked title="The system roles are missing">
          <p>
            The first administrator is given the institution administrator role, and that role does
            not exist yet. It is created by <Code>npm run rbac:sync</Code>, which the migrate service
            runs on every deploy.
          </p>
          <p>Run it against this database, then reload this page.</p>
        </Blocked>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-sm text-muted">
            {state.mode === 'create'
              ? 'Nobody has an account yet. Name the institution and create its first administrator.'
              : 'Nobody has an account yet. Create the first administrator for the institution below.'}{' '}
            This page closes for good as soon as that account exists.
          </p>

          <SetupForm
            mode={state.mode}
            institution={
              state.mode === 'attach'
                ? { name: state.institution.name, slug: state.institution.slug }
                : undefined
            }
            tokenRequired={Boolean(env.SETUP_TOKEN)}
            suggestedSlug={suggestedSlug(env.PUBLIC_INSTITUTION_SLUG)}
          />
        </>
      )}
    </PublicFrame>
  );
}

/**
 * The public pages look an institution up by PUBLIC_INSTITUTION_SLUG when it
 * is set, so a new institution should start with that short name.
 */
function suggestedSlug(configured: string | undefined): string | undefined {
  const slug = configured?.trim().toLowerCase();
  return slug && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug) ? slug : undefined;
}

function Blocked({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 space-y-3 border-l-2 border-danger bg-danger/5 px-4 py-4 text-sm">
      <h2 className="font-semibold text-danger">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-navy/5 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}
