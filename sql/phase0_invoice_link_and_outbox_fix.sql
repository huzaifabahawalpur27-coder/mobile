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
-- 4. get_public_invoice: stop resolving sequential numbers (EXC-00001, INV-156),
--    which let anyone enumerate other customers' bills.
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

-- 4. get_public_invoice: token-only lookups ------------------------------------
-- Recreated from sql/public_invoice_rpc.sql with token-only matching.
CREATE OR REPLACE FUNCTION public.get_public_invoice(p_reference TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_clean TEXT;
    v_res JSONB;
BEGIN
    IF p_reference IS NULL OR trim(p_reference) = '' THEN
        RETURN NULL;
    END IF;

    -- Strip leading prefixes: #, INV-, EXC-
    v_clean := upper(trim(regexp_replace(p_reference, '^#|^(INV-|EXC-)', '', 'i')));

    -- Only unguessable references resolve: reject sequential/short numbers.
    IF length(v_clean) < 8 OR v_clean ~ '^[0-9]+$' THEN
        RETURN NULL;
    END IF;

    -- 1. Check for Phone Exchange by invoice_token or unique exchange_number
    -- (Strictly disallows incremental integer IDs)
    SELECT jsonb_build_object(
        'type', 'exchange',
        'id', e.id,
        'invoice_no', COALESCE('EXC-' || e.invoice_token, e.exchange_number),
        'invoice_token', COALESCE(e.invoice_token, e.exchange_number),
        'reference_id', COALESCE('EXC-' || e.invoice_token, e.exchange_number),
        'created_at', e.created_at,
        'sale_amount', e.sale_amount,
        'trade_in_credit', e.trade_in_credit,
        'settlement_amount', e.settlement_amount,
        'settlement_direction', e.settlement_direction,
        'settlement_payment_method', COALESCE(e.settlement_payment_method, 'Cash'),
        'settlement_paid_amount', e.settlement_paid_amount,
        'customer_name', COALESCE(c.name, e.customer_name, 'Valued Customer'),
        'customer_phone', COALESCE(c.phone, e.customer_phone, ''),
        'customer_balance', COALESCE(c.outstanding_balance, 0),
        'status', e.status,
        'shop', jsonb_build_object(
            'id', sh.id,
            'name', COALESCE(sh.name, 'EdgeX Mobile Store'),
            'phone', COALESCE(sh.phone, ''),
            'address', COALESCE(sh.address, ''),
            'logo_url', COALESCE(sh.logo_url, ''),
            'warranty_terms', COALESCE(sh.warranty_terms, '')
        ),
        'incoming_items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ei.id,
                'product_name', ei.product_name,
                'brand', COALESCE(ei.brand, ''),
                'model', COALESCE(ei.model, ''),
                'storage', COALESCE(ei.storage, ''),
                'color', COALESCE(ei.color, ''),
                'condition', COALESCE(ei.condition, ''),
                'pta_status', COALESCE(ei.pta_status, ''),
                'imei_1', COALESCE(ei.imei_1, ''),
                'imei_2', COALESCE(ei.imei_2, ''),
                'assessed_value', ei.assessed_value,
                'quantity', ei.quantity,
                'subtotal', ei.subtotal,
                'battery_health', ei.inspection_details->>'battery_health'
            ))
            FROM public.exchange_items ei
            WHERE ei.exchange_id = e.id AND ei.item_direction = 'incoming_trade_in'
        ), '[]'::jsonb),
        'outgoing_items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ei.id,
                'product_name', ei.product_name,
                'brand', COALESCE(ei.brand, ''),
                'model', COALESCE(ei.model, ''),
                'storage', COALESCE(ei.storage, ''),
                'color', COALESCE(ei.color, ''),
                'condition', COALESCE(ei.condition, ''),
                'pta_status', COALESCE(ei.pta_status, ''),
                'imei_1', COALESCE(ei.imei_1, ''),
                'imei_2', COALESCE(ei.imei_2, ''),
                'price', ei.assessed_value,
                'quantity', ei.quantity,
                'subtotal', ei.subtotal
            ))
            FROM public.exchange_items ei
            WHERE ei.exchange_id = e.id AND ei.item_direction = 'outgoing_sale'
        ), '[]'::jsonb)
    ) INTO v_res
    FROM public.exchanges e
    LEFT JOIN public.customers c ON c.id = e.customer_id
    LEFT JOIN public.shops sh ON sh.id = e.shop_id
    WHERE upper(e.invoice_token) = v_clean;

    IF v_res IS NOT NULL THEN
        RETURN v_res;
    END IF;

    -- 2. Check for Sale record by secure random invoice_token or UUID
    -- (Strictly disallows raw incremental numeric guessing)
    SELECT jsonb_build_object(
        'type', 'sale',
        'id', s.id,
        'invoice_no', COALESCE('INV-' || s.invoice_token, 'INV-' || s.id),
        'invoice_token', COALESCE(s.invoice_token, s.id::text),
        'reference_id', COALESCE('INV-' || s.invoice_token, 'INV-' || s.id),
        'created_at', s.created_at,
        'subtotal', COALESCE(s.total_amount, s.net_amount, 0),
        'discount', COALESCE(s.discount, 0),
        'total', COALESCE(s.net_amount, s.total_amount, 0),
        'net_amount', COALESCE(s.net_amount, s.total_amount, 0),
        'total_amount', COALESCE(s.total_amount, s.net_amount, 0),
        'paid_amount', COALESCE(s.paid_amount, s.amount_paid, s.net_amount, s.total_amount, 0),
        'payment_type', COALESCE(s.payment_type, s.payment_method, 'cash'),
        'customer_name', COALESCE(NULLIF(s.customer_name, ''), c.name, 'Valued Customer'),
        'customer_phone', COALESCE(NULLIF(s.customer_phone, ''), c.phone, ''),
        'customer_balance', COALESCE(c.outstanding_balance, 0),
        'status', COALESCE(s.status, 'completed'),
        'shop', jsonb_build_object(
            'id', sh.id,
            'name', COALESCE(sh.name, 'EdgeX Mobile Store'),
            'phone', COALESCE(sh.phone, ''),
            'address', COALESCE(sh.address, ''),
            'logo_url', COALESCE(sh.logo_url, ''),
            'warranty_terms', COALESCE(sh.warranty_terms, '')
        ),
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', si.id,
                'name', COALESCE(
                    CASE 
                        WHEN (si.imei_snapshot->>'imei_1') IS NOT NULL AND si.product_name NOT LIKE '%' || (si.imei_snapshot->>'imei_1') || '%'
                        THEN si.product_name || ' [IMEI: ' || (si.imei_snapshot->>'imei_1') || ']'
                        WHEN ph.imei_1 IS NOT NULL AND si.product_name NOT LIKE '%' || ph.imei_1 || '%'
                        THEN si.product_name || ' [IMEI: ' || ph.imei_1 || ']'
                        ELSE si.product_name
                    END,
                    p.name, 
                    ph.model, 
                    'Phone / Accessory'
                ),
                'brand', COALESCE(ph.brand, (si.imei_snapshot->>'brand'), ''),
                'model', COALESCE(ph.model, (si.imei_snapshot->>'model'), ''),
                'storage', COALESCE(ph.storage, (si.imei_snapshot->>'storage'), ''),
                'color', COALESCE(ph.color, (si.imei_snapshot->>'color'), ''),
                'condition', COALESCE(ph.condition, (si.imei_snapshot->>'condition'), ''),
                'pta_status', COALESCE(ph.pta_status, (si.imei_snapshot->>'pta_status'), ''),
                'imei_1', COALESCE(
                    si.imei_1,
                    CASE
                        WHEN jsonb_typeof(si.imei_snapshot) = 'object' THEN si.imei_snapshot->>'imei_1'
                        WHEN jsonb_typeof(si.imei_snapshot) = 'string' THEN trim(both '"' from si.imei_snapshot::text)
                        ELSE NULL
                    END,
                    ph.imei_1,
                    ''
                ),
                'imei_2', COALESCE(
                    si.imei_2,
                    CASE
                        WHEN jsonb_typeof(si.imei_snapshot) = 'object' THEN si.imei_snapshot->>'imei_2'
                        ELSE NULL
                    END,
                    ph.imei_2,
                    ''
                ),
                'quantity', COALESCE(si.quantity, 1),
                'unit_price', COALESCE(si.unit_price, si.price, si.sale_price, 0),
                'total', COALESCE(si.subtotal, (COALESCE(si.quantity, 1) * COALESCE(si.unit_price, si.price, si.sale_price, 0)))
            ))
            FROM public.sale_items si
            LEFT JOIN public.products p ON p.id = si.product_id
            LEFT JOIN public.phones ph ON ph.id = si.phone_id
            WHERE si.sale_id = s.id
        ), '[]'::jsonb)
    ) INTO v_res
    FROM public.sales s
    LEFT JOIN public.customers c ON c.id = s.customer_id
    LEFT JOIN public.shops sh ON sh.id = s.shop_id
    WHERE upper(COALESCE(s.invoice_number, '')) = upper(p_reference)
       OR upper(COALESCE(s.invoice_number, '')) = ('INV-' || v_clean)
       OR upper(COALESCE(s.invoice_number, '')) = v_clean
       OR upper(COALESCE(s.invoice_token, '')) = v_clean
       OR (v_clean ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' AND s.idempotency_key = v_clean::UUID);

    IF v_res IS NOT NULL THEN
        RETURN v_res;
    END IF;

    RETURN NULL;
END;
$$;

-- Grant execution to public / unauthenticated users
GRANT EXECUTE ON FUNCTION public.get_public_invoice(TEXT) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
