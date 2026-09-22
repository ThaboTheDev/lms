#!/bin/sh
# Checks that a restored database is actually usable. Run weekly against the
# latest dump, in a scratch database. A backup you have never restored is a
# hypothesis.
set -eu

TARGET="${1:?usage: verify-restore.sh <restored database>}"
HOST="${PGHOST:-db}"
USER="${POSTGRES_USER:?POSTGRES_USER is required}"

run() {
  psql --host="$HOST" --username="$USER" --dbname="$TARGET" --tuples-only --no-align -c "$1"
}

echo "[verify] tables present"
TABLES="$(run "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
echo "  ${TABLES} tables"
[ "$TABLES" -gt 50 ] || { echo "  too few tables, the restore is incomplete" >&2; exit 1; }

echo "[verify] the records an institution would notice losing"
for pair in "User:users" "StudentProfile:learners" "CourseEnrolment:course results" \
            "Certificate:certificates" "Payment:payments" "AuditLog:audit entries"; do
  TABLE="${pair%%:*}"
  LABEL="${pair##*:}"
  COUNT="$(run "SELECT count(*) FROM \"${TABLE}\";" 2>/dev/null || echo "missing")"
  echo "  ${LABEL}: ${COUNT}"
  [ "$COUNT" != "missing" ] || { echo "  table ${TABLE} is missing" >&2; exit 1; }
done

echo "[verify] referential integrity spot check"
ORPHANS="$(run "SELECT count(*) FROM \"CourseEnrolment\" e LEFT JOIN \"StudentProfile\" s ON s.id = e.\"studentId\" WHERE s.id IS NULL;")"
echo "  orphaned course enrolments: ${ORPHANS}"
[ "$ORPHANS" = "0" ] || { echo "  the restore has dangling references" >&2; exit 1; }

echo "[verify] this restore is usable"
