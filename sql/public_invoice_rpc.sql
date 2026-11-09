-- ============================================================
-- Invoice tokens for the public digital receipt (the lookup function itself is in
-- sql/get_public_invoice.sql)
-- Protects against Insecure Direct Object Reference (IDOR) by
-- requiring unguessable random tokens (e.g. INV-8K3P9X2M) instead
-- of sequential incremental integer IDs.
-- ============================================================

-- 1. Ensure invoice_token columns exist on sales and exchanges
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_token TEXT;
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS invoice_token TEXT;

-- 2. Backfill existing records with unique random tokens. Sales that already have a
--    public code in invoice_number (e.g. INV-JNXKG8DN, in links customers hold) reuse it.
UPDATE public.sales s
SET invoice_token = upper(substr(s.invoice_number, 5))
WHERE s.invoice_token IS NULL
  AND s.invoice_number ~* '^INV-[A-Z0-9]{8,64}$'
  AND substr(s.invoice_number, 5) !~ '^[0-9]+$'
  AND NOT EXISTS (
      SELECT 1 FROM public.sales o
      WHERE o.id <> s.id AND upper(o.invoice_token) = upper(substr(s.invoice_number, 5))
  );

UPDATE public.sales
SET invoice_token = upper(substr(md5(id::text || '-edgex-salt-' || coalesce(created_at::text, '') || '-' || gen_random_uuid()::text), 1, 8))
WHERE invoice_token IS NULL;

UPDATE public.exchanges
SET invoice_token = upper(substr(md5(id::text || '-edgex-salt-' || coalesce(created_at::text, '') || '-' || gen_random_uuid()::text), 1, 8))
WHERE invoice_token IS NULL;

-- 3. Set default for future inserts
ALTER TABLE public.sales ALTER COLUMN invoice_token SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8));
ALTER TABLE public.exchanges ALTER COLUMN invoice_token SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8));

-- 4. Unique indexes for instant lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoice_token ON public.sales (upper(invoice_token)) WHERE invoice_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchanges_invoice_token ON public.exchanges (upper(invoice_token)) WHERE invoice_token IS NOT NULL;

-- get_public_invoice is defined ONLY in sql/get_public_invoice.sql (run it last).
-- Earlier copies here assumed sale_items.imei_snapshot was JSONB and crashed with
-- "operator does not exist: text ->> unknown" on databases where it is TEXT.
