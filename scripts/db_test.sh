#!/usr/bin/env bash
# Builds a fresh database (scripts/db_build.sh) and runs every sql/tests/*.test.sql
# against it. Any failed check stops with an error. Needs the PG* variables and an
# EMPTY test database.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/db_build.sh
for t in sql/tests/*.test.sql; do
  echo "== $t"
  psql -v ON_ERROR_STOP=1 -q -f "$t"
done
echo "Database checks passed."
