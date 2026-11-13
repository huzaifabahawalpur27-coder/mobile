#!/usr/bin/env bash
# Builds the whole database from nothing, in the order of sql/MIGRATION_ORDER.txt, and
# stops at the first error. Connection comes from the usual PG* variables
# (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE). Use an EMPTY test database.
set -euo pipefail
cd "$(dirname "$0")/.."

# Roles that Supabase provides and the scripts grant to
psql -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

count=0
while IFS= read -r file; do
  case "$file" in ''|\#*) continue ;; esac
  if [ ! -f "$file" ]; then echo "MISSING: $file" >&2; exit 1; fi
  if ! out=$(psql -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
    echo "FAILED: $file" >&2
    echo "$out" | grep -v '^psql:.*NOTICE' | tail -15 >&2
    exit 1
  fi
  count=$((count + 1))
done < sql/MIGRATION_ORDER.txt
echo "Database built: $count scripts applied in order."
