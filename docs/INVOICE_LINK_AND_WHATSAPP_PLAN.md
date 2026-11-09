# Shared Bill Link & WhatsApp Outbox: Diagnosis, Plan, and Codebase Audit

Date: 2026-11-09 · Scope: branch `main` (remote `mobile`) at `b8d34a9`. Static review of the code plus one reproduced regex bug. The live Supabase database was **not** inspected; findings marked *(DB check)* need the queries in section 5.

---

## 1. Why the shared bill link fails

### B1. Phone-sale links point at a token the server never stored (Critical)

- `src/pages/POS.jsx:1157` generates `invoiceToken` in the browser and puts it in `saleData`.
- Phone sales go through `supabase.rpc('process_phone_sale', …)` (`POS.jsx:1200-1226`). **No version of that RPC accepts or stores `invoice_token` or `invoice_number`.** There are six definitions across the SQL files, and none of them has the parameter.
- The database then fills `sales.invoice_token` from its default, `upper(substr(md5(gen_random_uuid()::text),1,8))` (`sql/public_invoice_rpc.sql:22`). That is a **different** token.
- `finalSale = { ...saleData, id: saleId }` (`POS.jsx:1292`) keeps the client token. The WhatsApp message and the outbox link use it (`POS.jsx:1663-1686`).
- **Result:** the customer opens `/invoice/INV-<client token>`. RLS is session-scoped, so tiers 1–2 return nothing for someone who isn't logged in. The `get_public_invoice` RPC finds no match, so the customer sees *"Invoice not found or expired"*. On the shop's own device the link *appears to work*, because tier 4 finds the sale in Dexie. That is why it looks fine in testing.

Accessory sales go through a direct `insert` that includes the token, so they work. The outbox only accepts phone sales, though, so **every outbox link is affected**.

### B2. Exchange links use a token invented in the browser (Critical)

- `process_phone_exchange` returns `exchange_number` (sequential, `EXC-00012`) but not `invoice_token` (`sql/phase_7_part2_process_exchange_rpc.sql:899-910`).
- `Exchange.jsx:761`, `:898` and `:971` do `result.invoice_token || generateRandomInvoiceToken()`, so the fallback always runs and the link matches nothing on the server.

### B3. The "sanitizer" corrupts any token that starts with a digit (High, reproduced)

`sanitizeIncrementalInvoiceInText` (`src/services/whatsappQueueService.js:54-68`) runs `/INV\s*[-#]?\s*\d+/gi`. That pattern also matches the first digit of a random token:

```
8K3P9X2M  -> https://shop.app/invoice/INV-8K3P9X2MK3P9X2M   (broken)
K3P9X2M8  -> https://shop.app/invoice/INV-K3P9X2M8          (ok)
3A9F0C1B  -> https://shop.app/invoice/INV-3A9F0C1BA9F0C1B   (broken)
```

That breaks about 25% of client tokens (8 of the 32 alphabet characters are digits) and about 62% of database md5 tokens (10 of 16 hex characters). The sanitizer runs at creation time, inside `renderCustomWhatsAppTemplate`, which POS uses by default. The outbox also reruns it on view, copy and send whenever `/INV-\d+/` matches (`WhatsAppQueue.jsx:85,130,179`), and the link grows again on each pass.

### B4. Silent random-token fallbacks produce dead links (High)

`generateRandomInvoiceToken()` is the last fallback in eight places: `buildPhoneSaleReceiptText`, `renderCustomWhatsAppTemplate`, both exchange builders, `upgradeLegacyWhatsAppMessage`, `POS.jsx:1663,1760`, and the `Exchange.jsx` call sites. A made-up token never resolves. A missing token should mean "no link yet", not a fake link.

### B5. Exchanges can be enumerated through the public RPC (High, security)

`get_public_invoice` matches `upper(e.exchange_number) = upper(p_reference)` (`public_invoice_rpc.sql:118-119`), and exchange numbers are sequential (`EXC-00001`…). Anyone can walk `/invoice/EXC-00001…` and read customer names, phone numbers, IMEIs and balances. The sale path also returns `customer_balance` (the ledger balance) to anyone holding the link.

### B6. Three different numbers for one bill (Medium, UX)

- WhatsApp text shows `INV-8K3P9X2M`, the token.
- The public bill shows `#INV-156`, from `sales.id` (`PublicInvoice.jsx:94`).
- The outbox card shows `INV-` plus the last six characters of the reference (`WhatsAppQueue.jsx:516`), e.g. `INV-3P9X2M`.

Customers and staff can't match these to each other.

### B7. The public page asks the wrong source first (Medium)

Tiers 1–2 query `sales` and `exchanges` directly, and those only work with a staff session or open RLS. For a customer they cost two wasted round trips before the RPC. If the open grants in `RESTORE_DATABASE_ACCESS.sql` are live, they become a cross-tenant data leak instead.

---

## 2. Why the WhatsApp outbox misbehaves

### W1. The table definitions conflict, so desktop→mobile sync may silently never happen (Critical, DB check)

- `CREATE_WHATSAPP_QUEUE_TABLE.sql:8` defines `shop_id UUID`.
- `MASTER_SCHEMA_AND_COLUMN_FIXES.sql:1592` defines `shop_id INTEGER`.

Both use `CREATE TABLE IF NOT EXISTS`, so whichever ran first wins. Shops have `SERIAL` (integer) ids. If the UUID version is live, every insert fails with `22P02`. The service only treats `42P01`/`PGRST204`/404 as special and otherwise returns `{ success: true, online: false }` (`whatsappQueueService.js:977-992`). Nobody sees `online:false`, so the message lives only in the selling device's localStorage and Dexie and **never reaches the phone**, even though the outbox is meant to send from mobile.

### W2. The outbox is world-readable and world-writable (Critical, security)

Both schema files create `FOR ALL USING (true) WITH CHECK (true)`. `MASTER_SCHEMA…:1611` also grants `ALL … TO anon`. Policies are OR-ed, so even if `production_security_hardening.sql` added a tenant policy, the `true` policy still opens the table. The anon key ships in the bundle, so anyone can read, edit or delete every shop's customer names, phone numbers and message texts.

### W3. "Send" marks the message sent before WhatsApp opens, and the popup can be blocked (High)

`handleSendViaWhatsApp` (`WhatsAppQueue.jsx:120-149`) first `await`s `markWhatsAppMessageSent` (a network call), then calls `window.open`. After an `await`, mobile Safari, installed PWAs and some Android browsers no longer treat the call as a user action, so they block the popup. The message is then marked **sent** although WhatsApp never opened.

### W4. Three storage layers drift apart (Medium)

Every write goes to localStorage (capped at 200 items), Dexie and Supabase, and failures are swallowed. `getPendingWhatsAppQueueCount` reads only the local stores. Delete and mark-sent run unconditionally on all three, with no shop check. A localStorage item and a server copy with the same id merge, but edits from another device are overwritten by stale local copies.

### W5. Auto-heal code rewrites messages on every load and poll (Medium)

Three things rewrite message text on their own: `fetchWhatsAppQueue` "heals" pending items, the 15 s poll repeats it, and the page also runs `updateExistingQueueMessagesWithWarranty` on mount. Combined with B3, they can keep changing text the cashier has already reviewed or edited. About 400 of the service's 1,300 lines exist only to detect and patch legacy formats.

### W6. Minor issues

- "Mark all sent" loops sequentially over `messages` rather than `phoneMessages`.
- Very long Urdu messages become very long `wa.me` URLs, and some Android intents truncate them.
- `status: 'dismissed'` is defined in the schema but never used.

---

## 3. Remediation plan

### Phase 0: Hotfix (≈1–2 days, highest value)

1. **Make the server the only source of the token.**
   - SQL: add `p_invoice_token TEXT DEFAULT NULL` to `process_phone_sale`. Store `invoice_token = COALESCE(p_invoice_token, default)` and `invoice_number = 'INV-' || invoice_token`, and return both in the JSON.
   - Return `invoice_token` from `process_phone_exchange`.
   - Client: build links only from the RPC result. Until the SQL is deployed, a stopgap is to `select invoice_token from sales where id = :sale_id` after a successful RPC and use that.
2. **Delete `sanitizeIncrementalInvoiceInText`** and every `/INV-\d+/` "re-upgrade" trigger in `WhatsAppQueue.jsx` and `updateExistingQueueMessagesWithWarranty`. Templates no longer contain sequential ids, so the sanitizer protects against nothing and actively breaks links.
3. **Remove every `|| generateRandomInvoiceToken()` fallback used for links.** If there's no server token (offline sale), queue the message with `link_pending: true` and fill the link in when the sale syncs.
4. **Fix the outbox send order.** Call `window.open` / `location.href = waUrl` synchronously inside the click handler first, then mark the message as `opened`. Either let the cashier confirm "sent", or auto-mark it when they return to the tab (`visibilitychange`).
5. **Repair existing messages with a one-off script.** For each pending row with `reference_data.sale_id` or `exchange_id`, read the real token and rewrite the link.
6. **Lock down the DB.**
   - `whatsapp_queue.shop_id INTEGER`.
   - Drop the `USING (true)` policies and revoke the anon grant.
   - Add `shop_id = current_user_shop_id()` scope.
   - In `get_public_invoice`, remove the `exchange_number` match and require a token of at least 8 characters.

**Phase 0 status (branch `fix/invoice-link-phase0`):**

- Steps 1–5 are done in code. For phone sales, POS now writes its token onto the RPC-created row (or reads back the server's) via `persistSaleInvoiceToken`. `exchangeService` attaches the exchange's stored token. The sanitizer and all random-token link fallbacks are gone, and a message with no confirmed token has no link instead of a dead one. The outbox opens WhatsApp before marking a message sent, and `repairQueueInvoiceLinks` rewrites pending links to the server token whenever the outbox loads.
- Step 6 is written as `sql/phase0_invoice_link_and_outbox_fix.sql` but **not yet applied**. Run it in Supabase after `public_invoice_rpc.sql` and `production_security_hardening.sql`. Its outbox lockdown is skipped, with a warning, if the hardening isn't in place.
- The step 1 SQL variant (a `p_invoice_token` parameter on `process_phone_sale`) was replaced by the client-side write-back plus a `sales` trigger that keeps `invoice_number` equal to `'INV-' || invoice_token`.

**Follow-up batch (branch `fix/audit-batch-2`):**

- **Old customer links:** `sql/phase0b_legacy_invoice_tokens.sql` adds `legacy_invoice_tokens` to `sales` and `exchanges`, backfills it from outbox rows, and lets `get_public_invoice` match it. When the outbox loads, the app also uploads old tokens that exist only on shop devices (`registerLegacyInvoiceTokens`), and the repair step now keeps the token a message had before. `PublicInvoice` undoes the old sanitizer's corruption (`INV-8K3P9X2MK3P9X2M` → `INV-8K3P9X2M`) and skips the direct-table lookups when no staff session exists.
- **Supabase builder `.catch()` bugs:** query builders have no `.catch`, so these writes were never sent. Fixed in `Sales.jsx` (balance reversal when a credit sale is deleted), `PurchaseHistory.jsx` (supplier refund on a purchase return) and `Settings.jsx` (removing the logo, choosing a print template).
- **`syncService`:** after a failed sales insert, it now checks the idempotency key before retrying, and it keeps `idempotency_key` in the retry payload, which audit item A5 flagged as being stripped.
- **Warranty terms kept reverting:**
  - Settings saved them only to this browser's localStorage. The server had no `shops.warranty_terms` column and `update_shop_settings` had no parameter for it, so other devices, re-logins and the customer's online bill fell back to the built-in 3 points.
  - The bill template also carried a hard-coded 3-point copy that the message builder never replaced.
  - "Apply warranty to outbox" skipped messages that already had warranty text.

  Fixes:
  - `sql/phase1_warranty_settings.sql` adds the columns and the RPC parameters.
  - Settings saves the terms to the server and prefers the server copy on load.
  - The default template uses a `[Warranty Terms]` placeholder, and old saved templates are converted to it.
  - Messages replace the standard warranty section with the saved terms.
  - Saving changed terms updates pending outbox messages.
- **Deploy order:** `public_invoice_rpc.sql` → `production_security_hardening.sql` → `phase1_warranty_settings.sql` → `phase0_invoice_link_and_outbox_fix.sql` → `phase0b_legacy_invoice_tokens.sql` → `phase1b_bill_customer_backfill.sql` → **`get_public_invoice.sql` (always last)**. Every file can be re-run safely.
- **Public lookup (`get_public_invoice`):** it is defined only in `sql/get_public_invoice.sql`. Earlier copies assumed `sale_items.imei_snapshot` was JSONB and crashed with `42883 operator does not exist: text ->> unknown` on databases where it is TEXT, so every customer saw "Invoice Not Found". The new version reads optional columns through `to_jsonb(row)` and parses snapshots in any form; it also runs on its own as an immediate fix.

### Phase 1: Simplify and make it observable (≈1 week)

7. Add one `getInvoiceLink(record)` helper (token in, URL out, `null` if there's no token), with a single sale/exchange template renderer behind it. Remove the legacy-English detection, the auto-heal, and the warranty "inject" heuristics. Warranty text becomes a normal `[Warranty Terms]` placeholder.
8. Use one consistent bill identity everywhere, e.g. **"Bill #156"** with the verification link carrying the token. The WhatsApp text, the outbox card and the PDF all show the same number.
9. Make Supabase the source of truth for the outbox, with Dexie as an offline cache that syncs through `syncService` (idempotent by `id`), and remove the localStorage copy. Show a per-card badge: *Synced* / *Only on this device* / *Link pending*.
10. Change `PublicInvoice` to call the RPC first. Keep the Dexie fallback for logged-in staff only, and drop the direct table tiers. Trim the RPC payload: no ledger balance and a masked phone number, unless the shop opts in.
11. Add unit tests (Vitest) for the token, template rendering, the phone normaliser and the link helper. These are pure functions and quick to cover.

### Phase 2: Product upgrades (optional)

- WhatsApp Business Cloud API (server-side via an Edge Function) for real automatic sending and delivery status, so manual `wa.me` becomes the fallback rather than the main path.
- Expiring or revocable links, and a QR code on the printed receipt that resolves to the same token.
- A per-shop analytics view: messages queued, sent and opened.

---

## 4. Wider codebase audit: top improvements

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| A1 | **Critical (process)** | `main` (remote `mobile`) and `origin/main` have **no common ancestor**: 119 commits only on `main`, 117 only on `origin/main`. The admin-api Edge Function, the `raw_password` drop, session-only `sessions`, the theme tokens and wholesale mode exist only on `origin`. The invoice and PDF work exists only on `mobile`. `AGENTS.md` describes the `origin` line. | Choose one canonical repository. Port the other line's features into it (cherry-pick or re-apply), then retire the other remote. Until then, every fix has to be made twice. |
| A2 | Critical | `main` still reads and writes `raw_password` (27 references in `src/components/admin/*`, 27 more in `superadmin/src/*`). | Port the `security_followups_migration` work from `origin`: drop the column and never display passwords. |
| A3 | Critical | About 70 SQL files with competing definitions: six versions of `process_phone_sale`, two conflicting `whatsapp_queue` tables, and `RESTORE_DATABASE_ACCESS.sql` granting `ALL` to anon. That last one undoes the hardening if anyone reruns it. | Move to ordered `supabase/migrations/`, archive the historical scripts, make `production_security_hardening.sql` final, and add negative cross-tenant tests. |
| A4 | High | Public data exposure: the B5 exchange enumeration, W2 open outbox, and B7 direct table reads. | Covered in Phase 0, step 6. |
| A5 | High | Accessory checkout is not atomic: header, lines, stock and balance are separate requests (existing audit H4). The sync retry also strips `idempotency_key` (`syncService.js:385`), which defeats its own duplicate guard. | Make a single idempotent `process_sale` RPC for all carts, and never strip `idempotency_key`. |
| A6 | High | Offline login uses fast SHA-256 hashes in browser storage (existing audit H3). | Use a server-side slow hash and expire legacy sessions. |
| A7 | Medium | Very large components: `POS.jsx` 4,097 lines, `Reports` 2,903, `Exchange` 2,534, `Settings` 2,202, `PublicInvoice` 1,517. Business rules live inside the UI. | Extract `checkoutService`, `exchangeService` (already started) and `invoiceService`, and keep pages as views. |
| A8 | Medium | Zero automated tests. | Start with Vitest on the pure utils (pricing, tokens, templates, phone numbers), then add Playwright smoke tests for POS → outbox → public link. |
| A9 | Medium | Silent `catch (_) {}` everywhere hides exactly the failures behind W1, B1 and B2. | Log to the audit or dead-letter table and show a visible status; lint `no-empty` as an error in services. |
| A10 | Medium | Untranslated mixed UI strings (Urdu, English and Roman Urdu in the same screens), and raw palette classes on `main`, whose theme work is only on `origin`. | Add a small i18n dictionary and port the theme tokens (see A1). |
| A11 | Low | `PROJECT_CONTEXT_FOR_CLAUDE.md` says to push only to `mobile`, while `AGENTS.md` describes the `origin` line. | Resolve together with A1 and keep one agent-context file. |

---

## 5. Database checks to run (read-only, in the Supabase SQL editor)

```sql
-- W1: which whatsapp_queue schema is live?
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='whatsapp_queue' and column_name in ('shop_id','created_by');

-- W2/B7: which policies are live on the public-facing tables?
select tablename, policyname, roles, qual, with_check from pg_policies
where schemaname='public' and tablename in ('whatsapp_queue','sales','exchanges','customers');

-- B1: do recent phone sales carry a token that matches what was messaged?
select s.id, s.invoice_token, s.invoice_number, q.reference_id
from sales s left join whatsapp_queue q on (q.reference_data->>'sale_id')::int = s.id
order by s.id desc limit 20;
```

Expected outcome if the diagnosis is right: `shop_id` is `uuid` or the queue is empty, `qual = true` policies are present, and `q.reference_id` never equals `'INV-' || s.invoice_token`.
