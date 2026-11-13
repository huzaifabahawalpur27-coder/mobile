# Session context: where the work stands

Written 13 November 2026 as a handoff, so a new session (on the owner's PC, in
`C:\exmobile`) can continue without the earlier conversation. Read `AGENTS.md` first
for the conventions; this file is the history, the current state and what is open.

## The project and its copies

- **App:** EdgeX POS, a shop system for mobile-phone retailers (React 18, Vite,
  Tailwind 4, Supabase, Dexie for offline, PWA). Shops are tenants separated by
  `shop_id` and row security.
- **Repository:** `github.com/huzaifabahawalpur27-coder/mobile`. This is the only
  repository the work below lives in.
- **Local folder:** `C:\exmobile`. It has two remotes:
  - `mobile` = the repository above. `main` tracks `mobile/main`.
  - `origin` = `BabarJoya/sanitary-pos`, an older sister copy of the app (version
    2.2.0). Do not pull from or push to `origin` for this work; the histories are
    unrelated.
- `edgexmobile/exmobile` on GitHub is empty and unused.

## How the owner wants to work

- **Commit in `C:\exmobile` first, then push to GitHub.** Earlier work was done from a
  cloud session that could only push to GitHub; from now on, local first.
- Push to a work branch; merge to `main` only when the owner says "merge".
- App text is plain English (Roman Urdu was replaced). Explain things in plain
  language, without Git or code jargon where possible.
- Report honestly what was tested and what was not.

## Branches right now

| Branch | Commit | Contains |
|---|---|---|
| `main` | `f7b3d93` | Everything through phase 4 below. CI passed. |
| `claude/transaction-edit-feature-72w8dl` | `276dcd8` + this file | `main` plus the UI work (stages 1 and 2). CI passed. **Not merged yet**: waiting for the owner to look at it locally and say "merge". |

## What has been done

### 1. Money calculation fixes (`891f090`, on main)
Bank / cash balances change by an amount inside the database instead of being
overwritten from the browser; POS credit sales, quotation totals, sale returns and
deletes, both ledgers, the cash-session count and expense edits were corrected. Shared
rules: `src/utils/moneyMath.js`, checked by `npm test`.

### 2. Phases 1 and 2 (`445818c`, on main)
- One-step money actions: `applyMoneyOp` (`src/services/moneyOps.js`) calls
  `apply_money_op` so a customer payment, supplier payment, expense or sale return
  saves the entry, the balance, the account and the stock together, or nothing.
- Bank tables restricted to the shop that owns them.
- Payments linked to their purchase bill; expenses store their account.
- "Correct entry" button on ledger payments; warning before saving an amount ten
  times the usual; Accounts > Statement & Day Book (filters, Excel export, day book,
  balance check); browser `alert()` boxes replaced by in-page messages (`notify`).
- A "JazzCash" account is no longer treated as the cash drawer.

### 3. Phases 3 and 4 (`f7b3d93`, on main)
- GitHub checks on every push: tests, lint, build, and the whole database built from
  nothing in the order of `sql/MIGRATION_ORDER.txt`, then `sql/tests/*.test.sql`.
- Nightly encrypted backup with a restore test (`.github/workflows/backup.yml`).
- Excel backup made complete (it stopped at 1,000 rows and skipped tables).
- Phone card layouts for Customers and Suppliers; larger POS tap targets.

### 4. UI stages 1 and 2 (`276dcd8`, on the work branch only)
- Tokens (`--ui-*` at the end of `src/index.css`) and shared `Button`, `Field`,
  `Modal`, `EmptyState` in `src/components/ui`.
- All 79 pop-ups marked as dialogs; `src/utils/dialog.js` gives each Esc-to-close, a
  focus trap, focus return and a locked page behind.
- 57 `confirm()` boxes replaced by `confirmDialog`.
- 344 fields given an accessible name; 1,018 uses of 8-11px text raised to 12px;
  low-contrast grey darkened; phone header toggles moved into the user menu.
- About 180 Roman Urdu messages rewritten in English.
- Measured on 13 screens (phone, light): text under 12px 356 to 7, contrast failures
  410 to 117, unlabelled fields 41 to 3.

## Waiting on the owner

1. **Look at the UI branch on `localhost:5173`, then say "merge"** (or what to change).
2. **Supabase SQL already run by the owner:** `sql/atomic_bank_balance.sql` and
   `sql/atomic_money_ops.sql` (the owner said "done" after each). Nothing new is needed
   for the UI branch. Not confirmed from this side: that the Accounts page still shows
   the accounts after `atomic_money_ops.sql` restricted the bank tables.
3. **Nightly backup secrets** on GitHub (Settings > Secrets and variables > Actions):
   `SUPABASE_DB_URL` (Session pooler connection string) and `BACKUP_PASSPHRASE`.
   Until both exist the backup job skips itself.
4. **Redeploy the admin API** (`/api` on Vercel), or the Excel backup's new sheets
   report "could not be read".
5. **Stronger login:** needs the live definition from Supabase before it can be
   changed safely:
   `select pg_get_functiondef(oid) from pg_proc where proname = 'secure_login';`
6. **WhatsApp message templates** sent to customers and suppliers are still in Roman
   Urdu on purpose. Ask the owner before changing what their customers receive.

## Open work

### UI plan, remaining stages
- **Stage 3: dark mode and consistency.** Only 24 of 81 screen files have dark styles;
  the POS cart panel (customer selector, totals) stays light in dark mode. Replace the
  836 hard-coded colours with tokens and the 951 emoji used as icons with
  `lucide-react` (already used in 49 files).
- **Stage 4: screen-by-screen polish.** POS first, then Dashboard, Products, Reports,
  Settings. Move pages onto the shared `Button` / `Field` / `Modal`.
- **Stage 5:** add the browser measurements (text size, labels, contrast) to CI.
- Known leftovers from stages 1 and 2: most fields have a screen-reader name but not a
  visible label; a few admin confirm boxes still say "Confirm"; remaining contrast
  failures are brand-colour amounts and text on gradient cards.

### Other
- Purchases screen is not a one-step save yet (batches, split payments).
- Sales and purchase bills have no "correct" button (returns and Edit Payment cover it).
- Reports, Dashboard, Exchange and FIFO batch costing were not re-audited.
- The largest screens (POS is about 4,200 lines) are not broken up.
- Old balances from before the fixes are not corrected automatically; use Reconcile in
  a ledger or Accounts > Check Balances.

## Checking a change

```
npm test          # money rules
npm run lint      # must stay at 0 errors
npm run build
PGDATABASE=edgex_test ./scripts/db_test.sh   # needs a local Postgres and an empty database
```

The app can be opened without the live database for layout checks, but real behaviour
needs the owner's login on `localhost:5173`. Nothing in this history was clicked
through against the live Supabase project from the cloud session.
