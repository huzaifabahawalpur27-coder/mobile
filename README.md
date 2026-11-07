# EdgeX POS

EdgeX POS is a shop-facing point-of-sale application built with React, Vite, Supabase, and Dexie. It supports inventory, purchases, sales, customer and supplier ledgers, phone inventory, offline work, and a platform administration interface. `superadmin/` is a separate Vite app retained for standalone administration.

## Local development

Install the root dependencies with `npm install`. Copy `.env.example` to `.env` and set the Supabase URL and public anon key. The service-role key and `ADMIN_SESSION_SECRET` are server-only values; never use a `VITE_` prefix for them.

Run the API and root UI in separate terminals:

```sh
npm run api
npm run dev
```

The Vite development server proxies `/api` to the API on port 3001. The API requires `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SESSION_SECRET`, and `APP_ORIGINS`; email broadcast additionally requires `RESEND_API_KEY` and optionally `RESEND_FROM_EMAIL`. Production deployments must route `/api/*` to the API server and restrict origins to the deployed app domains.

For the standalone admin UI, install `superadmin/` dependencies and run its Vite commands from that directory. It uses the root API server.

## Database setup

For an existing EdgeX database, apply [production_security_hardening.sql](sql/production_security_hardening.sql) once in the Supabase SQL Editor. It is the consolidated final security migration; it replaces the unsafe policies and grants regardless of earlier migration order. It assumes the core `shops`, `users`, `sessions`, `sales`, `purchases`, and `subscription_plans` tables exist. Review the target schema and try it in staging first. Do not concatenate or rerun the historical setup scripts: some insert demo records, redefine the same RPCs, or grant broad access. This migration requires active rows in `sessions` and `users` for shop-scoped access.

For a brand-new Supabase project, this file is not a complete base-schema installer. The repository does not yet contain a clean, demo-free, ordered fresh-install bundle; do not use `COMPLETE_SUPABASE_SETUP.sql` as a production one-click installer because it seeds demo credentials/data and includes broad grants that need to be reviewed.

## Checks

```sh
npm run lint
npm run build
```

Run the same commands from `superadmin/` when changing that app. Existing lint warnings and large export/admin bundles are tracked cleanup items.
