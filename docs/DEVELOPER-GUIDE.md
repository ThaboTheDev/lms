# Developer guide

## Getting it running

```bash
cp .env.example .env
openssl rand -base64 48          # paste into AUTH_SECRET
docker compose up -d db redis storage mail
npm install
npx prisma migrate dev           # creates the schema
npm run db:seed
npm run dev
```

Seeded accounts and the passphrase are printed by the seed. Mailpit at
http://localhost:8025 catches every email.

## Where things live

```
prisma/schema.prisma      the 95 models, the single source of truth
src/lib                   cross-cutting: env, db, auth, rbac, money, mail, storage, queue
src/server/services       the domain. One file per area, plus a *-rules.ts beside it
src/server/jobs           background handlers
src/app/(app)             authenticated screens
src/app/(auth)            sign in
src/app/api/v1            the JSON API
tests                     the pure rules, in vitest
```

## The pattern worth following

Almost every service area is two files.

**`something-rules.ts`** is pure. No database, no `server-only`, no imports from
Prisma. This is where the actual decisions live: how a mark is banded, when an
attempt may be submitted, which duplicate is likely, what a progression outcome
should be. These are the files with tests, and they are the files to read first
when you want to know how something works.

**`something.ts`** is the service. It loads records, checks permissions, calls
the pure rules, writes, and records an audit entry.

Keeping them apart is why 304 tests run in five seconds without a database, and
why the same rule cannot behave one way on a screen and another way in a job.

## Rules of the codebase

1. **Every mutation checks a permission and writes an audit entry.** No
   exceptions, including for scripts.
2. **Every query is scoped to the institution**, and a record loaded by id is
   re-checked with `requireSameInstitution`.
3. **Every collection paginates.** `parsePaging` at the call site.
4. **Money is integer cents** inside the application, Decimal only at the edge.
5. **Anything that can be decided without the database should be**, in a
   `*-rules.ts` file with tests.
6. **Derive rather than store** where a value can disagree with its inputs:
   invoice status, course marks, attendance percentages.
7. **Say what you did not do.** SKIPPED rather than CLEAN, provisional rather
   than final, "not recorded" rather than a zero.

## Adding a feature

1. Model it in `schema.prisma`, run `npx prisma migrate dev --name what_it_does`.
2. Write the rules as pure functions, with tests, before touching the database.
3. Write the service: permission, scope, rules, write, audit.
4. Write the screen. Server component for reading, server action for writing.
5. Add the permission to `src/lib/rbac/permissions.ts` and the roles that should
   hold it, then `npm run rbac:sync`.

## Testing

```bash
npm test              # vitest, the pure rules
npm run typecheck     # tsc
npm run lint
```

Integration tests against a real database are the gap. The pure rules carry the
logic that matters most, which is why they were separated out, but the services
themselves are currently only checked by the type system.

## Known rough edges

- Course records take the year of study from the enrolment rather than the
  curriculum placement. Right for a one-year programme, needs the curriculum
  lookup for longer ones. Flagged in `academic-records.ts`.
- The gradebook resolves best-attempt in memory. Fine to a few hundred learners.
- Notification fan-out sends one email at a time. The digest batching is written
  and tested but not wired in.
- No caching layer. See `docs/PERFORMANCE.md` for where it will be wanted first.
