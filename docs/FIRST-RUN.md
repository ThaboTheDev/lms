# First run

What to do the first time this is stood up at a real institution, in order.

## Before anybody else sees it

- [ ] `npm ci && npx prisma generate` on a real machine. The generated client is
      what makes the type check meaningful; without it the checker cannot see
      the model types.
- [ ] `npx prisma migrate dev --name initial` against a real Postgres. This is
      the first time the schema is applied for real; expect to fix a small
      number of things and commit the migration.
- [ ] `npm run typecheck` with the client generated, and fix what it finds.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] `npm run db:seed` against a scratch database, and click through the
      screens with the seeded accounts. Do not seed production.

## Standing up the institution

- [ ] Generate a fresh `AUTH_SECRET`.
- [ ] `npm run rbac:sync` (the compose `migrate` service runs it on every
      deploy). Setup needs the system roles, so this comes first.
- [ ] Open `/setup` and create the institution and its first administrator:
      see "First run" in `docs/DEPLOYMENT.md`. `scripts/bootstrap.ts` does the
      same from a shell when the site is not reachable yet.
- [ ] Turn MFA on for that account before doing anything else.
- [ ] The institution's branding and certificate prefix, under Settings.
- [ ] Work down **Administration → Academic setup**: it is a checklist that
      says what is still missing. In order: academic year and terms (mark the
      current ones), faculties and departments, qualifications, the grading
      scheme (before any result is released), programmes with their
      curriculum, courses, then each course scheduled into a term with its
      teaching team. Assigning a lecturer there gives them the role for that
      course only.
- [ ] Invite staff under People and access; register learners under
      Students (each gets an invitation email to choose a password), or
      register a whole programme for a term from the programme's page.
- [ ] Fee structure, if billing runs through the platform.
- [ ] Email templates checked (Administration → Email templates), and a test
      message actually received.
- [ ] The bucket's CORS rule for uploads (see "Object storage" in
      `docs/DEPLOYMENT.md`), then one upload tried from a browser.

## Before the first intake

- [ ] Backups running, and one restore verified end to end.
- [ ] Monitoring alerting on readiness, error rate and backup age.
- [ ] Malware scanner configured, or a recorded decision that it is not.
- [ ] TLS in front, database not reachable from the internet.
- [ ] Penetration test.
- [ ] Accessibility walkthrough with somebody who uses assistive technology.
- [ ] The retention policy read and agreed by whoever is accountable for POPIA.
- [ ] A named person who knows how to run a restore.

## In the first term

- [ ] Watch the proof of payment queue during registration week; that is where
      the volume lands first.
- [ ] Check the moderation compliance signal before the first results are
      released, not after.
- [ ] Wire the notification digests before the first institution-wide
      announcement to a large audience.
- [ ] Review the audit log once, deliberately, so somebody has read it before
      they need to.
