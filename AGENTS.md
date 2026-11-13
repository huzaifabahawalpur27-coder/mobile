# EdgeX POS Agent Context

Read this first, then inspect only the modules needed. Treat this as the compact source of truth; see `docs/PROJECT_AUDIT.md` for verified risks and product-quality priorities.

## Architecture

- Root is the shop-facing POS: React 18, Vite 5, Tailwind 4, React Router 6, Supabase, Dexie, and PWA support. Routes are in `src/App.jsx`; most shop pages follow `ProtectedRoute -> Layout -> Page`.
- Platform administration is currently embedded under `/admin` in the root app (`src/components/admin`, `src/pages/admin`). A separate `superadmin/` Vite app also remains, with its own package/dependencies (React 19, Router 7) and Supabase client. Treat it as a distinct/legacy surface; check both apps before changing shared security or admin behavior.
- `src/components/Layout.jsx` owns the full-screen shell and inner scrolling. Business features are mostly page-local under `src/pages/`; POS, Products, Inventory, Sales, Purchases, Customers, Dashboard, Settings, and ledgers are high-traffic.
- Business presets/pricing configuration live in `src/utils/businessPresets.js` (verify actual path before editing); global styling is Tailwind utilities and `src/index.css`. `src/App.css` is not part of the current styling path; do not import template CSS that constrains `#root`.

## Commands And Baseline

Root: `npm run dev`, `npm run build`, `npm run lint`, `npm run preview`.
Standalone admin: `cd superadmin`, then the same npm scripts.

- Root lint currently exits successfully with 0 errors and 113 warnings (hook dependencies, unused values, empty catches, and related cleanup).
- Latest root build compiled, but the command exited nonzero during PWA/temp dependency initialization with Windows `EPERM` resolving `C:\Users\...\AppData`; Vite also warned that the 500.86 kB shared JS chunk exceeds its 500 kB threshold. Recheck in the deployment/CI environment before treating this as a code build failure.
- Route chunks and action-time PDF/XLSX loading are already in use; do not assume the app is one monolithic entry bundle.

## Data, Auth, Offline

- Supabase/RLS header helpers: `src/services/supabase.js`; Dexie schema: `src/services/db.js`; queue runner: `src/services/syncService.js` (30-second interval and `online` event, started by app bootstrap).
- Login is in `src/pages/Login.jsx`, auth state in `src/context/AuthContext.jsx`. Current offline design persists identity/session material and password hashes in browser storage; this is a security-sensitive legacy constraint, not a secure authorization boundary.
- **Never put service-role credentials in browser/Vite `VITE_*` variables.** `src/services/supabaseAdmin.js` and the separate admin client currently do this; privileged work belongs behind a trusted server/Edge Function. Check and rotate any key that may have been deployed.
- Enforce tenant isolation and roles in database RLS/RPC/server code, not only frontend filters or `ProtectedRoute`. Review SQL migrations together; order and duplicate policies materially affect security.
- Preserve shop-scoped localStorage key patterns (`shop_name_${shopId}`, `shop_logo_${shopId}`, `shop_settings_${shopId}`, plan and print settings). Avoid casual changes to sync queue, session, or offline-login behavior. Do not discard queued business writes silently; use idempotency and observable recovery.

## Money Rules

- Shared money maths lives in `src/utils/moneyMath.js` (returns, tenders, ledger row effects, cash-drawer portions). POS, Sales, both ledgers, the cash session and Trash restore use it; change a rule there, not per screen. `npm test` runs `scripts/test_money_math.mjs`.
- Cash / bank account balances change only through `creditBankBalance` / `deductBankBalance` in `src/services/bankService.js`, which send a signed amount to `adjust_bank_balance` (`sql/atomic_bank_balance.sql`) and queue the same call when offline. Never write `current_balance` as an absolute number from a screen.

- A money action that touches more than one thing (an entry plus a balance, an account or stock) goes through `applyMoneyOp` in `src/services/moneyOps.js` (`apply_money_op`, `sql/atomic_money_ops.sql`): one transaction online, one queued call offline. Do not chain separate inserts and balance updates in a page.
- Decide whether an account is the cash drawer with `isCashAccount` / `isCashName` from `moneyMath.js`, never `includes('cash')` (it matches "JazzCash").
- Show messages with `notify()` from `src/utils/toast.js`, not `alert()`. Keep `alert()` only where the page reloads, signs out or prints straight after.

## Quality Gates

- `.github/workflows/ci.yml` runs on every push: `npm test`, lint, production build, and `scripts/db_test.sh` (builds the whole database from nothing in the order of `sql/MIGRATION_ORDER.txt`, then runs `sql/tests/*.test.sql`). Keep it green.
- A new SQL script must be safe to re-run, go at the END of `sql/MIGRATION_ORDER.txt`, and get a check under `sql/tests/` (see `sql/README.md`). Never add a `USING (true)` policy on a table with `shop_id`.
- `.github/workflows/backup.yml` makes an encrypted nightly backup and restores it into a throwaway database (`scripts/backup.sh`, `scripts/restore_check.sh`); it needs the `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` repository secrets.

## UI And Product Conventions

- Keep the app shell full-screen; let `Layout` own available height and pages scroll inside `<main>`. Prefer flex + `min-h-0`/`h-full`, and `dvh` when viewport sizing is unavoidable. Avoid page-local `100vh` subtraction.
- Modals should fit phones: `w-full max-w-*`, bounded `max-h-[90dvh]`, internal scroll, visible close affordance, and stacked actions. For data-heavy mobile workflows prefer compact card/list views over horizontal-only tables.
- POS is the primary repeated-action workflow: keep barcode/search, quantity, cart/totals, customer, tender, and completion reachable with touch and keyboard. Use semantic controls, explicit labels, visible focus, and generous tap targets; do not nest interactive controls.
- Keep changes scoped because business rules are often embedded in page components. Document genuinely new shared patterns here.

## Operational Guardrails

- `api-server.js` exposes email dispatch; require authentication/authorization, strict validation, rate limits, and origin policy before production use.
- PWA caching must not retain authenticated/private API responses across logout or account switching.
- `README.md` is still Vite-template content; do not rely on it for setup/deployment truth. Verify environment names from code/examples without printing secret values.
- For root changes run build/lint as feasible; run standalone admin checks when touching `superadmin/`. Report environment-limited failures distinctly from source failures.
