#!/usr/bin/env bash
# Proves a backup can be restored: decrypts it, restores it into an EMPTY test database
# and counts the rows of the tables that matter. A backup that has never been restored
# is only a hope.
#
#   scripts/restore_check.sh backups/edgex-YYYYMMDD-HHMM.dump.gpg
#
#   BACKUP_PASSPHRASE   the password the backup was encrypted with
#   PG* variables       an EMPTY test database to restore into (never the live one)
#
# To restore for real after a disaster, run the same pg_restore against a new, empty
# Supabase project's database.
set -euo pipefail
file="${1:?Usage: scripts/restore_check.sh <backup.dump.gpg>}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to the password the backup was encrypted with}"
plain=$(mktemp)
trap 'rm -f "$plain"' EXIT
gpg --batch --yes --decrypt --passphrase-fd 3 --output "$plain" "$file" 3<<<"$BACKUP_PASSPHRASE"

# Roles the policies and grants refer to
psql -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

# Some objects (extension-owned functions on Supabase) may not restore on a plain test
# server; the data must. So restore errors are listed, and the table check decides.
pg_restore --no-owner --no-privileges --dbname="${PGDATABASE:?Set PGDATABASE}" "$plain" 2> restore-errors.log || true
errors=$(grep -c 'pg_restore: error' restore-errors.log || true)
echo "Restore finished with $errors non-fatal message(s) (see restore-errors.log)."

missing=0
for t in shops users products customers suppliers sales sale_items purchases bank_accounts bank_account_transactions; do
  if n=$(psql -Atq -c "SELECT count(*) FROM public.$t" 2>/dev/null); then
    printf '  %-28s %s rows\n' "$t" "$n"
  else
    printf '  %-28s MISSING\n' "$t"
    missing=$((missing + 1))
  fi
done
if [ "$missing" -gt 0 ]; then
  echo "RESTORE CHECK FAILED: $missing table(s) did not come back." >&2
  exit 1
fi
echo "Restore check passed: every key table came back."
