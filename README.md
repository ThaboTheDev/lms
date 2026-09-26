# MSRI learning platform

The learning management system for the Mzuvukile Slabbert Radebe Institute:
admissions through to certification, with the academic administration, quality
assurance and financial records an accredited institution has to keep.

The interface follows the institute site at https://msri-website.vercel.app/:
navy `#0B113B` for structure, gold `#CBA65E` as the single accent, the crest,
and the institute's Candara / Calibri type stack.

This is a working application, not a prototype. All ten phases are implemented:
project setup, database, authentication and role-based access control; student
management, admissions, programmes, curriculum and registration; the course
builder, content library, file uploads and the learner course experience; then
assessments, question banks, quizzes, assignments, rubrics, marking and the
gradebook; academic records, transcripts, progression, certificates and public
verification; attendance, the calendar, messaging, notifications, announcements
and discussion forums; fees, invoices, payments, receipts, payment plans and the
proof of payment review queue; moderation, programme review, compliance, the
audit log and institutional reporting; learning analytics, security hardening,
POPIA operations and the accessibility pass; and deployment, backup, monitoring
and the guides.

Read `docs/FIRST-RUN.md` before standing this up anywhere real. A fresh
deployment starts at `/setup`, which creates the institution and its first
administrator; Administration → Academic setup then walks through everything a
semester needs, in order.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript | Server components keep student data on the server; one deployable artefact |
| Styling | Tailwind CSS with CSS custom properties | MSRI palette, overridable per institution without a rebuild |
| Database | PostgreSQL 16 | Relational integrity for academic records |
| ORM | Prisma 6 | Typed queries and reviewable migrations |
| Auth | First-party, database-backed sessions, Argon2id | No opaque dependency between the institution and its own access control |
| Files | S3-compatible (AWS S3, MinIO, Cloudflare R2) | Large content and submissions never sit in Postgres |
| Email | Driver abstraction (log and SMTP) | Swap providers without touching callers |
| Jobs | Queue abstraction (in-process, BullMQ/Redis) | Certificates, analytics and fan-out run off the request path |

## Running it

```bash
cp .env.example .env
# AUTH_SECRET must be at least 32 characters
openssl rand -base64 48        # paste into AUTH_SECRET

docker compose up -d db redis storage mail
npm install
npm run db:migrate             # creates the schema
npm run db:seed                # fictional institution and people
npm run dev
```

Skip `db:seed` to try first-run setup instead: with no users in the database,
the first visit goes to `/setup`, as it does on a fresh production deployment
(see "First run" in `docs/DEPLOYMENT.md`).

Open http://localhost:3000. The seeded institution is the Mzuvukile Slabbert
Radebe Institute. Accounts all use the passphrase printed by the seed script
(the addresses below are the demo logins; they were not renamed):

| Account | Role |
| --- | --- |
| super.admin@kopano.example.ac.za | Super administrator |
| principal@kopano.example.ac.za | Institutional administrator |
| registrar@kopano.example.ac.za | Registrar |
| academic@kopano.example.ac.za | Academic administrator (can release results) |
| coordinator@kopano.example.ac.za | Programme coordinator (can release results) |
| lecturer@kopano.example.ac.za | Lecturer |
| finance@kopano.example.ac.za | Finance officer |
| lerato.mokoena@student.kopano.example.ac.za | Student |

The public application form is at `/apply`, the seed leaves five fictional
applications at different points in the admissions pipeline, and BUS101 comes
with two published weeks of content so the learner view has something in it.

BUS101 also carries a published quiz drawn from a seeded question bank and a
rubric-marked assignment, so the attempt, marking and gradebook screens have
something real in them. The seed resolves results for three learners and issues
one certificate, printing its verification code so you can try `/verify`.

Uploads work out of the box: with `STORAGE_DRIVER=local` files are written under
`./storage` and served back through the application, and with
`STORAGE_DRIVER=s3` the same code presigns against MinIO, AWS or R2.

Email behaves the same way. `MAIL_DRIVER=log` writes messages to the server log,
and `MAIL_DRIVER=smtp` sends them; the compose stack runs Mailpit on
http://localhost:8025 so you can read what would have gone out.

## Commands

```bash
npm run dev          # development server
npm run build        # production build (runs prisma generate)
npm run typecheck    # TypeScript, no emit
npm test             # vitest
npm run db:migrate   # create and apply a migration
npm run db:studio    # browse the database
npm run rbac:sync    # push new permissions and system roles to the database
npm run worker       # background worker and scheduled jobs, needed when QUEUE_DRIVER=redis
npm run job -- <name>  # run one background job now (atrisk.evaluate, attempts.sweep, invoices.arrears)
```

## Documentation

- `docs/ARCHITECTURE.md` - modules, request lifecycle, tenancy, security model
- `docs/DATABASE.md` - entity design, conventions, indexing and retention
- `docs/SECURITY.md` - what is protected, how, and what is not claimed
- `docs/ACCESSIBILITY.md` - the WCAG 2.2 AA position and the known gaps
- `docs/PERFORMANCE.md` - what is in place and what to watch under load
- `docs/DEPLOYMENT.md` - what it needs, releases, scaling, the pre-intake list
- `docs/BACKUP.md` - three layers, restore, and verifying the restore
- `docs/MONITORING.md` - what to alert on, and what to leave on a dashboard
- `docs/API.md` - conventions, endpoints and how to add one
- `docs/DEVELOPER-GUIDE.md` - the codebase, its rules and its rough edges
- `docs/FIRST-RUN.md` - the checklist for a real institution
- `docs/ADMINISTRATOR-GUIDE.md`, `docs/LECTURER-GUIDE.md`, `docs/STUDENT-GUIDE.md`
- `docs/ROADMAP.md` - MVP definition, the ten phases and what is done

## Security notes

Passwords are Argon2id. Sessions are opaque random tokens stored as keyed
hashes, with an absolute expiry and an idle timeout. Every permission is checked
on the server, in the page or route handler, never only in the navigation.
Tenant scoping is applied to every query and re-checked when a record is loaded
by id. The audit log redacts credential and identity-document fields.
