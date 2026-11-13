#!/usr/bin/env bash
# Full backup of the shop data (schema "public") into one encrypted file.
#
#   DATABASE_URL        Postgres connection string of the live database
#                       (Supabase: Project Settings > Database > Connection string > URI,
#                        use the "Session pooler" one)
#   BACKUP_PASSPHRASE   password used to encrypt the file; without it the backup
#                       cannot be opened, so keep it somewhere safe
#   OUT_DIR             where to write (default: ./backups)
#
# Result: backups/edgex-YYYYMMDD-HHMM.dump.gpg  (restore: scripts/restore_check.sh)
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the live database connection string}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to the password for encrypting the backup}"
OUT_DIR="${OUT_DIR:-backups}"
mkdir -p "$OUT_DIR"
stamp=$(date -u +%Y%m%d-%H%M)
plain="$OUT_DIR/edgex-$stamp.dump"

# Custom format: compressed, and pg_restore can restore all of it or a single table
pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges --format=custom --file="$plain"

gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 --output "$plain.gpg" "$plain" 3<<<"$BACKUP_PASSPHRASE"
rm -f "$plain"
echo "$plain.gpg"
