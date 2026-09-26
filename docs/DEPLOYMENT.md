# Deployment

## What this needs

| Piece | Why | Managed alternative |
| --- | --- | --- |
| PostgreSQL 16 | The records | RDS, Cloud SQL, Neon |
| Redis 7 | Queue and shared rate limiting | ElastiCache, Upstash |
| S3-compatible storage | Content, submissions, proof of payment | S3, R2, MinIO |
| SMTP | Notifications | SES, Postmark, the institution's own relay |
| TLS termination | Everything | The Apache or Nginx that already owns ports 80/443, a load balancer, or Caddy on a free port |

Redis and the scanner are optional. Without Redis the queue and rate limiter
fall back to in-process behaviour, which is correct on one instance and wrong on
several. Without a scanner, uploads are recorded as SKIPPED rather than CLEAN.

## The compose file on a shared VPS

`docker-compose.prod.yml` is sized for a 4 GB VPS that already runs another
site. Every service has a `mem_limit` with a matching `memswap_limit`, so the
LMS cannot spill into swap and starve the other site: db 512m, redis 128m,
app 700m, worker 400m, migrate 400m, backup 256m. Postgres is tuned to its
512 MB cgroup (`max_connections=40`, `shared_buffers=64MB`), Redis is capped at
96 MB with `noeviction` for the job queue, and the app binds
`127.0.0.1:3000` only.

Migrations run in the one-shot `migrate` service, not in the web entrypoint.
The app and the worker both wait for `migrate` to complete successfully, and
the web entrypoint runs with `RUN_MIGRATIONS=false` and `SYNC_RBAC=false`:
the web image is a Next.js standalone build and has no Prisma CLI.

Use `docker compose -f docker-compose.prod.yml` for this. Do **not** deploy
with `docker-compose.yml`: it is the local development stack, with Postgres
published on 5432 and development credentials.

The stack will not boot until `prisma/migrations` exists. The `migrate`
service exits 1 when it finds no `migration.sql`, because an empty database
must not count as a successful start. Generate the initial migration on a
machine with Postgres and commit it first:

```bash
npx prisma migrate dev --name initial
git add prisma/migrations && git commit -m "initial migration"
```

Do not seed production. `npx prisma db seed` is for local development; the
first institution and administrator are created through the first-run page,
`/setup` (see [First run](#first-run)), not through seed data.

## First deployment

```bash
cp .env.example .env
openssl rand -base64 48        # AUTH_SECRET
# fill in DATABASE_URL, S3_*, SMTP_*, APP_URL, DB_POOL, DB_POOL_WORKER

npm ci
npx prisma generate
npx prisma migrate deploy      # never `migrate dev` in production
npm run rbac:sync              # permissions and system roles
npm run build
npm start
```

Or with the compose stack (after `prisma/migrations` is committed):

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f migrate app
```

## First run

A fresh deployment has no institution and nobody who can sign in. `/setup`
creates both in one step. Sign-in forwards there while the database has no
users, so opening the site's address is enough:

1. Open `https://learn.msri.online/setup`.
2. Name the institution. Its short name is filled in from the name; change it
   now if you want another, because links such as the application form's use
   it. Everything else about the institution (contact details, logo, colours,
   the certificate prefix) is edited afterwards under Settings.
3. Create the first administrator: name, email address and a password of at
   least 12 characters with upper and lower case letters and a number, or of
   20 characters or more. The account holds the institution administrator
   role.
4. Submit. You land on the dashboard, signed in.
5. **Turn on two step sign in straight away.** Open the menu under your name,
   choose Account and security, and follow Turn on two step sign in. Once it
   is on, you sign in again, this time with a code from your phone as well.

Then invite everybody else from `/admin/users/invite`. Setup creates one
account, once.

What the page does depends on what the database already holds:

| The database has | `/setup` |
| --- | --- |
| No users and no institution | Creates the institution and its administrator |
| No users and one institution | Creates only the administrator, attached to that institution |
| No users and several institutions | Refuses: it will not guess which one the administrator belongs to |
| Any user at all | Redirects to sign in before rendering anything |

So it closes for good the moment the first account exists, and it does not
reopen when accounts are later suspended or deleted. The check is repeated
inside the transaction, under an advisory lock, so two people submitting at
once cannot both become the first administrator. Submissions are limited to
five an hour per connection.

Setup needs the system roles, so `npm run rbac:sync` must have run first. The
`migrate` service does this on every deploy; the page says so if it has not
happened. If `PUBLIC_INSTITUTION_SLUG` is set, the short name starts as that
value: keep the two the same, or the application form will not find the
institution.

### Protecting setup with a token

Until somebody completes setup, whoever reaches the server first can claim
it. If the server is public before you get to it, set `SETUP_TOKEN` in `.env`
(16 characters or more) and the page asks for it as well:

```bash
openssl rand -base64 24        # SETUP_TOKEN
```

The compose stack passes it to the app only when it is set, and a blank value
counts as unset. Remove it once setup is done; it has no use after that.

### Headless fallback

`scripts/bootstrap.ts` does the same from a shell, for a server whose web port
is not reachable yet, or for provisioning that runs unattended. It runs the
page's own service, so it applies the same rules and refuses in the same
cases. It needs only `DATABASE_URL`, does not ask for `SETUP_TOKEN` (a shell on
the server already proves more), and reads the password from stdin so that it
never lands in shell history:

```bash
read -rs PW && printf '%s' "$PW" | npx tsx --env-file=.env scripts/bootstrap.ts \
  --institution-name "Mzuvukile Slabbert Radebe Institute" \
  --first-name Palesa --last-name Ndlovu --email palesa@example.ac.za \
  --password-stdin
```

In the compose stack, run it in the `migrate` container, which has the source
and tsx; `-T` lets the password be piped in:

```bash
read -rs PW && printf '%s' "$PW" | docker compose -f docker-compose.prod.yml \
  run --rm -T migrate npx tsx scripts/bootstrap.ts \
  --institution-name "Mzuvukile Slabbert Radebe Institute" \
  --first-name Palesa --last-name Ndlovu --email palesa@example.ac.za \
  --password-stdin
```

Leave out `--institution-name` when the database already holds its one
institution; the administrator is attached to it. `--institution-slug` sets the
short name instead of deriving it, and `--help` lists the rest. Then sign in and
turn on two step sign in, as above.

## Reverse proxy

Moodle already owns ports 80 and 443 on this VPS, so do not install a second
web server on top of them. The app listens on `127.0.0.1:3000` only; the
existing Apache or Nginx should proxy `learn.msri.online` to it. For Nginx:

```nginx
server {
    listen 443 ssl;
    server_name learn.msri.online;
    # ssl_certificate ... as issued for this name

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

For Apache, the same shape with `ProxyPreserveHost On`,
`ProxyPass / http://127.0.0.1:3000/` and `ProxyPassReverse / ...` after
enabling `mod_proxy` and `mod_http2`. Caddy is an option only on a host where
ports 80 and 443 are actually free; here they are not.

## Releases

Migrations and the RBAC sync run in the one-shot `migrate` service before the
web or worker containers start — not in the web entrypoint, which runs with
`RUN_MIGRATIONS=false`. `migrate deploy` applies what is already committed and
never generates anything, which is why a container start cannot invent a
schema change, and why a missing `prisma/migrations` fails the deployment
instead of producing an empty database.

The worker depends on `migrate` completing successfully and on a healthy
Redis, not on the app process: a queue consumer's lifecycle is its own. One
process owns the schema, and two processes racing to migrate is how a
deployment corrupts itself.

### Zero downtime

1. Deploy the migration first, and make it additive. Add a column, backfill it,
   deploy the code that reads it, and only then remove the old column in a later
   release.
2. Roll the web processes one at a time; the health gate holds traffic back
   until `/api/v1/health` answers.
3. Roll the workers afterwards. Jobs are retried, so a worker restarting
   mid-job costs a retry rather than the work.

### Rolling back

Roll the image back. Do not roll a migration back automatically: an additive
migration is safe under the old code, and a destructive one needs a person
looking at it. This is why migrations are additive in the first place.

## Scheduled work

The worker registers these with BullMQ as job schedulers when it starts, so
they run without cron, survive restarts and run once even with several
workers. Times are Africa/Johannesburg.

| Task | When | Job |
| --- | --- | --- |
| Submit abandoned timed attempts (recorded at their deadline) | Every 5 minutes | `attempts.sweep` |
| At-risk refresh | 01:00 nightly | `atrisk.evaluate` |
| Mark overdue invoices and instalments | 02:00 nightly | `invoices.arrears` |
| Database backup | Nightly | the `backup` service, `scripts/backup.sh` |
| Restore verification | Weekly | `scripts/restore.sh` then `scripts/verify-restore.sh` |
| Retention sweeps | On a person's decision | The privacy screen |

Run any job by hand (or from host cron on a deployment without the worker):

```bash
docker compose -f docker-compose.prod.yml run --rm worker npx tsx --conditions=react-server scripts/run-job.ts attempts.sweep
npm run job -- atrisk.evaluate      # from a checkout
```

Retention sweeps are deliberately not automatic. Deleting learner records on a
timer, with nobody looking, is how an institution discovers it has destroyed
something it needed.

Backups keep 7 days on the VPS (`BACKUP_RETENTION_DAYS`). Dumps must be
copied off that disk every night: 35 days of dumps will not fit on a 50 GB
disk shared with Moodle. 35 days becomes the retention target only once the
copies live somewhere else — see docs/BACKUP.md.

## Time zone

`TZ=Africa/Johannesburg` is set in both images and in the compose file. Times
typed into forms (a due date of 17:00) carry no zone and are read in the
server's; pages format times in it too. On UTC every deadline lands two hours
late. Change `TZ` only for an institution in another zone.

## Object storage

Browsers upload straight to the bucket, so the bucket must accept a `PUT`
from the site's origin. Without this rule every upload fails in the browser
(MinIO in the development stack allows any origin, which hides the problem):

```json
[{ "AllowedOrigins": ["https://learn.msri.online"], "AllowedMethods": ["PUT", "GET"],
   "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3000 }]
```

The content security policy is built per request (with a nonce) from the
runtime `S3_ENDPOINT`, so changing the endpoint no longer needs a rebuild.

## Scaling

Start with one web process and one worker. Then, in this order:

1. Redis for queue and rate limiting, which is what makes a second web process
   correct rather than merely possible.
2. More web processes behind the load balancer. They are stateless; sessions
   live in the database.
3. More workers. Concurrency is per worker and defaults to five.
4. A read replica for reporting, once the reporting screens start to matter.

On the current 4 GB VPS, scale vertically first: the memory caps above leave
no room for a second app or worker without raising the box.

## Before the first real intake

- [ ] `prisma/migrations` committed, and the `migrate` service exits 0 on deploy
- [ ] `AUTH_SECRET` generated fresh, not copied from anywhere
- [ ] Database not reachable from the internet
- [ ] TLS terminating in front (existing Apache or Nginx proxying
      `learn.msri.online` to `127.0.0.1:3000`), with HSTS already sent by the
      application
- [ ] Backups running nightly, copied off the VPS, and one restore actually
      verified
- [ ] SMTP sending, with SPF and DKIM set up so results do not land in spam
- [ ] Malware scanner configured, or a conscious decision that it is not
- [ ] First administrator created through `/setup` (or `scripts/bootstrap.ts`),
      with MFA on
- [ ] `SETUP_TOKEN` removed from `.env`, if it was set
- [ ] Seed data not loaded into production
