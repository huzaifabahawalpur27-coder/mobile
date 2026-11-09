-- ============================================================================
-- Phase 0: shared bill link + WhatsApp outbox fixes
-- Run AFTER sql/public_invoice_rpc.sql (and, for step 3, after
-- sql/production_security_hardening.sql). Safe to re-run.
--
-- 1. Guarantee every sale/exchange row has an unguessable invoice_token (reusing a
--    sale's existing INV-<code> where it has one) and fill sales.invoice_number where
--    empty (process_phone_sale never set either). Existing codes are never replaced.
-- 2. Normalize whatsapp_queue.shop_id to INTEGER (shops.id is SERIAL; a UUID column
--    made every server insert fail, so desktop messages never reached the phone).
-- 3. Remove the world-readable/writable USING (true) policies on whatsapp_queue and
--    scope it to the caller's session shop.
-- 4. (moved) The public lookup get_public_invoice now lives only in
--    sql/get_public_invoice.sql; it resolves only unguessable references.
-- ============================================================================

-- 1. Invoice tokens -----------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_token TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS invoice_token TEXT;

ALTER TABLE public.sales ALTER COLUMN invoice_token SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8));
ALTER TABLE public.exchanges ALTER COLUMN invoice_token SET DEFAULT upper(substr(md5(gen_random_uuid()::text), 1, 8));

-- Older sales keep their public code only in invoice_number (e.g. INV-JNXKG8DN), and
-- customers already hold links with it. Use that code as the token where none is
-- stored, so the link and the token agree and nothing a customer holds changes.
UPDATE public.sales s
SET invoice_token = upper(substr(s.invoice_number, 5))
WHERE (s.invoice_token IS NULL OR trim(s.invoice_token) = '')
  AND s.invoice_number ~* '^INV-[A-Z0-9]{8,64}$'
  AND substr(s.invoice_number, 5) !~ '^[0-9]+$'
  AND NOT EXISTS (
      SELECT 1 FROM public.sales o
      WHERE o.id <> s.id AND upper(o.invoice_token) = upper(substr(s.invoice_number, 5))
  );

UPDATE public.sales
SET invoice_token = upper(substr(md5(gen_random_uuid()::text), 1, 8))
WHERE invoice_token IS NULL OR trim(invoice_token) = '';

UPDATE public.exchanges
SET invoice_token = upper(substr(md5(gen_random_uuid()::text), 1, 8))
WHERE invoice_token IS NULL OR trim(invoice_token) = '';

-- Fill invoice_number only where it is empty. Never replace an existing code: it may be
-- the one in a link a customer already has (get_public_invoice matches both columns).
UPDATE public.sales
SET invoice_number = 'INV-' || upper(invoice_token)
WHERE invoice_token IS NOT NULL
  AND (invoice_number IS NULL OR trim(invoice_number) = '');

CREATE OR REPLACE FUNCTION public.sync_sales_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NEW.invoice_token IS NOT NULL AND trim(NEW.invoice_token) <> '' THEN
        NEW.invoice_token := upper(trim(NEW.invoice_token));
        -- Only fill an empty invoice_number, or keep one that merely mirrored the old token
        IF NEW.invoice_number IS NULL OR trim(NEW.invoice_number) = ''
           OR (TG_OP = 'UPDATE' AND OLD.invoice_token IS NOT NULL
               AND upper(NEW.invoice_number) = 'INV-' || upper(OLD.invoice_token)) THEN
            NEW.invoice_number := 'INV-' || NEW.invoice_token;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_sync_invoice_number ON public.sales;
CREATE TRIGGER trg_sales_sync_invoice_number
    BEFORE INSERT OR UPDATE OF invoice_token ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.sync_sales_invoice_number();

-- 2. whatsapp_queue.shop_id -> INTEGER ----------------------------------------
DO $$
DECLARE
    v_type TEXT;
BEGIN
    SELECT data_type INTO v_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_queue' AND column_name = 'shop_id';

    IF v_type = 'uuid' THEN
        -- Integer shop ids could never be stored in a UUID column, so no valid
        -- shop_id values exist to convert; rows keep their other data.
        ALTER TABLE public.whatsapp_queue ALTER COLUMN shop_id TYPE INTEGER USING NULL;
        RAISE NOTICE 'whatsapp_queue.shop_id converted from uuid to integer';
    END IF;
END;
$$;

-- 3. whatsapp_queue tenant isolation ------------------------------------------
DO $$
DECLARE
    pol RECORD;
BEGIN
    IF to_regclass('public.whatsapp_queue') IS NULL THEN
        RAISE NOTICE 'whatsapp_queue does not exist; skipping policy changes';
        RETURN;
    END IF;

    IF to_regprocedure('public.current_user_shop_id()') IS NULL THEN
        RAISE WARNING 'public.current_user_shop_id() missing: apply sql/production_security_hardening.sql, then re-run this file. whatsapp_queue policies were NOT changed.';
        RETURN;
    END IF;

    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_queue' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_queue', pol.policyname);
    END LOOP;

    ALTER TABLE public.whatsapp_queue ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.whatsapp_queue FROM PUBLIC;
    REVOKE ALL ON public.whatsapp_queue FROM anon, authenticated;

    CREATE POLICY whatsapp_queue_tenant_scope ON public.whatsapp_queue
        FOR ALL TO anon, authenticated
        USING (shop_id = public.current_user_shop_id())
        WITH CHECK (shop_id = public.current_user_shop_id());

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_queue TO anon, authenticated;
END;
$$;

-- get_public_invoice is defined ONLY in sql/get_public_invoice.sql (run it last).
-- Earlier copies here assumed sale_items.imei_snapshot was JSONB and crashed with
-- "operator does not exist: text ->> unknown" on databases where it is TEXT.
NOTIFY pgrst, 'reload schema';
