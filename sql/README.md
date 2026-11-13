# Database scripts

**Building a database from nothing:** the scripts listed in `MIGRATION_ORDER.txt`, in
that order. `scripts/db_build.sh` applies them to an empty Postgres and stops at the
first error. CI does this on every push, then runs the checks in `sql/tests/`, so the
order is known to work.

**Updating a live database:** run only the new script(s) named in the release notes,
in the Supabase SQL Editor. Every script in the list is safe to re-run.

**Adding a script:** make it safe to re-run (`IF NOT EXISTS`, `CREATE OR REPLACE`,
`DROP POLICY IF EXISTS`), add it at the END of `MIGRATION_ORDER.txt`, and add a check
for it under `sql/tests/`. Never add a policy with `USING (true)` on a table that has
a `shop_id`: it lets every shop read and change every other shop's rows.

**Scripts not in the list** (most `*.sql` files in the repository root, and a few here)
are older, one-off or superseded: earlier versions of login and row-security fixes,
repair scripts for specific incidents, and verification queries. They are kept for
history. Do not run them on a live database without reading them first; several of
them re-open access that `production_security_hardening.sql` closes.

| Script here, not in the list | Why |
|---|---|
| `fix_bank_accounts_and_transactions_rls.sql` | Repair script; the same policies are set by `atomic_money_ops.sql` |
| `phase_7_phone_exchange_workflow.sql` | Single-file copy of `phase_7_part1..3` |
| `phase_8_batch_fifo_costing.sql` | Index file pointing at `phase_8_part1..4` |
| `phase_8_end_to_end_verification.sql`, `phase_8_test_suite.sql` | Manual verification queries |

## Checks

```
createdb edgex_test
PGDATABASE=edgex_test ./scripts/db_test.sh
```

## Backups

`scripts/backup.sh` writes one encrypted file of all shop data;
`scripts/restore_check.sh` restores it into an empty test database and counts the rows.
The "Nightly backup" GitHub workflow runs both every night once the
`SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` repository secrets are set.
