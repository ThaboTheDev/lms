# Deployment

## What this needs

| Piece | Why | Managed alternative |
| --- | --- | --- |
| PostgreSQL 16 | The records | RDS, Cloud SQL, Neon |
| Redis 7 | Queue and shared rate limiting | ElastiCache, Upstash |
| S3-compatible storage | Content, submissions, proof of payment | S3, R2, MinIO |
| SMTP | Notifications | SES, Postmark, the institution's own relay |
| TLS termination | Everything | A load balancer or Caddy in front |

Redis and the scanner are optional. Without Redis the queue and rate limiter
fall back to in-process behaviour, which is correct on one instance and wrong on
several. Without a scanner, uploads are recorded as SKIPPED rather than CLEAN.

## First deployment

```bash
cp .env.example .env
openssl rand -base64 48        # AUTH_SECRET
# fill in DATABASE_URL, S3_*, SMTP_*, APP_URL

npm ci
npx prisma generate
npx prisma migrate deploy      # never `migrate dev` in production
npm run rbac:sync              # permissions and system roles
npm run build
npm start
```

Or with the compose stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

## Releases

The entrypoint applies migrations and syncs permissions before the process
accepts traffic, so a release is one command. `migrate deploy` applies what is
already committed and never generates anything, which is why a container start
cannot invent a schema change.

The worker runs with `RUN_MIGRATIONS=false`: one process owns the schema, and
two processes racing to migrate is how a deployment corrupts itself.

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

| Task | When | Command |
| --- | --- | --- |
| At-risk refresh | Nightly | `npm run atrisk` |
| Database backup | Nightly | `scripts/backup.sh` |
| Restore verification | Weekly | `scripts/restore.sh` then `scripts/verify-restore.sh` |
| Retention sweeps | On a person's decision | The privacy screen |

Retention sweeps are deliberately not automatic. Deleting learner records on a
timer, with nobody looking, is how an institution discovers it has destroyed
something it needed.

## Scaling

Start with one web process and one worker. Then, in this order:

1. Redis for queue and rate limiting, which is what makes a second web process
   correct rather than merely possible.
2. More web processes behind the load balancer. They are stateless; sessions
   live in the database.
3. More workers. Concurrency is per worker and defaults to five.
4. A read replica for reporting, once the reporting screens start to matter.

## Before the first real intake

- [ ] `AUTH_SECRET` generated fresh, not copied from anywhere
- [ ] Database not reachable from the internet
- [ ] TLS terminating in front, with HSTS already sent by the application
- [ ] Backups running, and one restore actually verified
- [ ] SMTP sending, with SPF and DKIM set up so results do not land in spam
- [ ] Malware scanner configured, or a conscious decision that it is not
- [ ] An administrator account with MFA on
- [ ] Seed data not loaded into production
