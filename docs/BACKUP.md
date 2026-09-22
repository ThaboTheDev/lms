# Backup and recovery

An institution's academic records are the one thing it cannot rebuild. A learner
who graduated in 2019 may need their transcript in 2041.

## Targets

| | |
| --- | --- |
| Recovery point objective | 15 minutes |
| Recovery time objective | 4 hours |
| Retention, daily dumps | 35 days |
| Retention, monthly archives | 7 years |
| Retention, academic records | Indefinite |

The nightly dump alone gives an RPO of 24 hours, which is not the target. Meet
it with continuous WAL archiving.

## Three layers

**1. Nightly logical dump.** `scripts/backup.sh` writes a compressed
custom-format dump with a checksum beside it, and prunes past the window. This
is what you restore from for a mistake: a bad import, a deletion somebody
regrets.

**2. Continuous WAL archiving.** Configure the database to stream write-ahead
logs to object storage. This is what gets you to a 15 minute RPO and lets you
recover to a point in time, which matters when the problem was discovered hours
after it started.

```
archive_mode = on
archive_command = 'aws s3 cp %p s3://institution-wal/%f'
wal_level = replica
```

**3. Object storage.** Enable versioning on the bucket holding content,
submissions, proof of payment and certificates. Lifecycle to cold storage after
90 days. Replicate the submission and certificate prefixes to a second region.
Deleting a file in the application removes the object; versioning is what makes
that recoverable.

## Restoring

```bash
# Always into a scratch database first.
./scripts/restore.sh backups/lms-20260301T020000Z.dump lms_restore_check
./scripts/verify-restore.sh lms_restore_check
```

The restore script refuses to write over the live database unless told twice,
because the moment you need it is the moment you are least careful.

## Verifying

Weekly, restore the most recent dump into a scratch database and run
`verify-restore.sh`. It checks the table count, the records an institution would
notice losing, and a referential integrity spot check.

**A backup nobody has restored is a hypothesis.** The first restore should not
be during an incident.

## What is not covered

- Redis holds queued jobs and rate limit counters. Losing it costs in-flight
  jobs, not records. It is not backed up on purpose.
- The `.env` file. Keep secrets in a secret store, not in a backup.
