-- ============================================================================
-- get_public_invoice: the customer's online bill (the only public lookup).
-- THE single definition of this function. Run it LAST, after:
--   public_invoice_rpc.sql, production_security_hardening.sql,
--   phase1_warranty_settings.sql, phase0_invoice_link_and_outbox_fix.sql,
--   phase0b_legacy_invoice_tokens.sql, phase1b_bill_customer_backfill.sql
-- Safe to re-run.
--
-- Why this exists: the earlier versions read sale_items.imei_snapshot->>'imei_1',
-- assuming a JSONB column. In databases where imei_snapshot is TEXT that raises
-- "42883 operator does not exist: text ->> unknown" for EVERY sale, so customers saw
-- "Invoice Not Found" for all bills. This version:
--   * reads optional/variable columns through to_jsonb(row), so a TEXT or JSONB
--     column, or a column that does not exist, never breaks the lookup;
--   * parses imei_snapshot / inspection_details whether they hold JSON, a JSON string
--     or a plain IMEI;
--   * resolves only unguessable references: invoice_token, sales.invoice_number
--     (older bills, e.g. INV-JNXKG8DN) and legacy_invoice_tokens. Sequential numbers
--     (INV-156, EXC-00012) never resolve.
-- ============================================================================

-- Columns the lookup relies on (all added by earlier files; repeated so this file
-- also works on its own).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_token TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS legacy_invoice_tokens TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS invoice_token TEXT;
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS legacy_invoice_tokens TEXT[] NOT NULL DEFAULT '{}';

-- JSON text -> jsonb; anything else (a plain IMEI, junk) -> a JSON string. Never raises.
CREATE OR REPLACE FUNCTION public.edgex_try_jsonb(p TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
    IF p IS NULL OR btrim(p) = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        RETURN p::jsonb;
    EXCEPTION WHEN others THEN
        RETURN to_jsonb(p);
    END;
END;
$$;

-- Text -> numeric; NULL when empty or not a number. Never raises.
CREATE OR REPLACE FUNCTION public.edgex_num(p TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
    IF p IS NULL OR btrim(p) = '' THEN
        RETURN NULL;
    END IF;
    BEGIN
        RETURN p::numeric;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
END;
$$;

DROP FUNCTION IF EXISTS public.get_public_invoice(TEXT);

CREATE FUNCTION public.get_public_invoice(p_reference TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_clean TEXT;
    v_res JSONB;
BEGIN
    IF p_reference IS NULL OR btrim(p_reference) = '' THEN
        RETURN NULL;
    END IF;

    -- Strip leading #, INV-, EXC-
    v_clean := upper(btrim(regexp_replace(btrim(p_reference), '^#|^(INV-|EXC-)', '', 'i')));

    -- Only unguessable references resolve: reject sequential/short/odd input
    IF length(v_clean) < 8 OR length(v_clean) > 64 OR v_clean ~ '^[0-9]+$' OR v_clean !~ '^[A-Z0-9]+$' THEN
        RETURN NULL;
    END IF;

    -- 1. Phone exchange
    SELECT jsonb_build_object(
        'type', 'exchange',
        'id', e.id,
        'invoice_no', 'EXC-' || e.invoice_token,
        'invoice_token', e.invoice_token,
        'reference_id', 'EXC-' || e.invoice_token,
        'created_at', ej->'created_at',
        'sale_amount', COALESCE(public.edgex_num(ej->>'sale_amount'), 0),
        'trade_in_credit', COALESCE(public.edgex_num(ej->>'trade_in_credit'), 0),
        'settlement_amount', COALESCE(public.edgex_num(ej->>'settlement_amount'), 0),
        'settlement_direction', ej->>'settlement_direction',
        'settlement_payment_method', COALESCE(NULLIF(ej->>'settlement_payment_method', ''), 'Cash'),
        'settlement_paid_amount', public.edgex_num(ej->>'settlement_paid_amount'),
        'customer_name', COALESCE(NULLIF(ej->>'customer_name', ''), cj->>'name', 'Valued Customer'),
        'customer_phone', COALESCE(NULLIF(ej->>'customer_phone', ''), cj->>'phone', ''),
        'customer_balance', COALESCE(public.edgex_num(cj->>'outstanding_balance'), 0),
        'status', COALESCE(ej->>'status', 'completed'),
        'shop', jsonb_build_object(
            'id', shj->'id',
            'name', COALESCE(NULLIF(shj->>'name', ''), 'EdgeX Mobile Store'),
            'phone', COALESCE(shj->>'phone', ''),
            'address', COALESCE(shj->>'address', ''),
            'logo_url', COALESCE(shj->>'logo_url', ''),
            'warranty_terms', COALESCE(shj->>'warranty_terms', '')
        ),
        'incoming_items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', it.j->'id',
                'product_name', COALESCE(it.j->>'product_name', ''),
                'brand', COALESCE(it.j->>'brand', ''),
                'model', COALESCE(it.j->>'model', ''),
                'storage', COALESCE(it.j->>'storage', ''),
                'color', COALESCE(it.j->>'color', ''),
                'condition', COALESCE(it.j->>'condition', ''),
                'pta_status', COALESCE(it.j->>'pta_status', ''),
                'imei_1', COALESCE(it.j->>'imei_1', ''),
                'imei_2', COALESCE(it.j->>'imei_2', ''),
                'assessed_value', COALESCE(public.edgex_num(it.j->>'assessed_value'), 0),
                'quantity', COALESCE(public.edgex_num(it.j->>'quantity'), 1),
                'subtotal', public.edgex_num(it.j->>'subtotal'),
                'battery_health', CASE WHEN jsonb_typeof(it.insp) = 'object' THEN it.insp->>'battery_health' END
            ) ORDER BY ei.id)
            FROM public.exchange_items ei
            CROSS JOIN LATERAL (SELECT to_jsonb(ei) AS j) x
            CROSS JOIN LATERAL (SELECT x.j AS j, public.edgex_try_jsonb(x.j->>'inspection_details') AS insp) it
            WHERE ei.exchange_id = e.id AND it.j->>'item_direction' = 'incoming_trade_in'
        ), '[]'::jsonb),
        'outgoing_items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', x.j->'id',
                'product_name', COALESCE(x.j->>'product_name', ''),
                'brand', COALESCE(x.j->>'brand', ''),
                'model', COALESCE(x.j->>'model', ''),
                'storage', COALESCE(x.j->>'storage', ''),
                'color', COALESCE(x.j->>'color', ''),
                'condition', COALESCE(x.j->>'condition', ''),
                'pta_status', COALESCE(x.j->>'pta_status', ''),
                'imei_1', COALESCE(x.j->>'imei_1', ''),
                'imei_2', COALESCE(x.j->>'imei_2', ''),
                'price', COALESCE(public.edgex_num(x.j->>'price'), public.edgex_num(x.j->>'assessed_value'), 0),
                'quantity', COALESCE(public.edgex_num(x.j->>'quantity'), 1),
                'subtotal', public.edgex_num(x.j->>'subtotal')
            ) ORDER BY ei.id)
            FROM public.exchange_items ei
            CROSS JOIN LATERAL (SELECT to_jsonb(ei) AS j) x
            WHERE ei.exchange_id = e.id AND x.j->>'item_direction' = 'outgoing_sale'
        ), '[]'::jsonb)
    ) INTO v_res
    FROM public.exchanges e
    CROSS JOIN LATERAL (SELECT to_jsonb(e) AS ej) ex
    LEFT JOIN public.customers c ON c.id::text = ex.ej->>'customer_id'
    LEFT JOIN public.shops sh ON sh.id::text = ex.ej->>'shop_id'
    CROSS JOIN LATERAL (SELECT to_jsonb(c) AS cj, to_jsonb(sh) AS shj) r
    WHERE upper(COALESCE(e.invoice_token, '')) = v_clean
       OR v_clean = ANY (e.legacy_invoice_tokens)
    ORDER BY e.id DESC
    LIMIT 1;

    IF v_res IS NOT NULL THEN
        RETURN v_res;
    END IF;

    -- 2. Sale
    SELECT jsonb_build_object(
        'type', 'sale',
        'id', s.id,
        'invoice_no', 'INV-' || COALESCE(s.invoice_token, v_clean),
        -- The token a link/QR can use. Older sales may only have their code in
        -- invoice_number; never fall back to the sequential id.
        'invoice_token', COALESCE(NULLIF(s.invoice_token, ''), NULLIF(regexp_replace(COALESCE(s.invoice_number, ''), '^INV-', '', 'i'), ''), v_clean),
        'reference_id', 'INV-' || v_clean,
        'created_at', sj->'created_at',
        'subtotal', COALESCE(public.edgex_num(sj->>'total_amount'), public.edgex_num(sj->>'net_amount'), 0),
        'discount', COALESCE(public.edgex_num(sj->>'discount'), 0),
        'total', COALESCE(public.edgex_num(sj->>'net_amount'), public.edgex_num(sj->>'total_amount'), 0),
        'net_amount', COALESCE(public.edgex_num(sj->>'net_amount'), public.edgex_num(sj->>'total_amount'), 0),
        'total_amount', COALESCE(public.edgex_num(sj->>'total_amount'), public.edgex_num(sj->>'net_amount'), 0),
        'paid_amount', COALESCE(public.edgex_num(sj->>'paid_amount'), public.edgex_num(sj->>'amount_paid'), public.edgex_num(sj->>'net_amount'), public.edgex_num(sj->>'total_amount'), 0),
        'payment_type', COALESCE(NULLIF(sj->>'payment_type', ''), NULLIF(sj->>'payment_method', ''), 'cash'),
        'customer_name', COALESCE(NULLIF(sj->>'customer_name', ''), cj->>'name', 'Valued Customer'),
        'customer_phone', COALESCE(NULLIF(sj->>'customer_phone', ''), cj->>'phone', ''),
        'customer_balance', COALESCE(public.edgex_num(cj->>'outstanding_balance'), 0),
        'status', COALESCE(sj->>'status', 'completed'),
        'shop', jsonb_build_object(
            'id', shj->'id',
            'name', COALESCE(NULLIF(shj->>'name', ''), 'EdgeX Mobile Store'),
            'phone', COALESCE(shj->>'phone', ''),
            'address', COALESCE(shj->>'address', ''),
            'logo_url', COALESCE(shj->>'logo_url', ''),
            'warranty_terms', COALESCE(shj->>'warranty_terms', '')
        ),
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', it.j->'id',
                'name', COALESCE(NULLIF(it.j->>'product_name', ''), pj->>'name', phj->>'model', 'Phone / Accessory'),
                'brand', COALESCE(phj->>'brand', it.snap_obj->>'brand', ''),
                'model', COALESCE(phj->>'model', it.snap_obj->>'model', ''),
                'storage', COALESCE(phj->>'storage', it.snap_obj->>'storage', ''),
                'color', COALESCE(phj->>'color', it.snap_obj->>'color', ''),
                'condition', COALESCE(phj->>'condition', it.snap_obj->>'condition', ''),
                'pta_status', COALESCE(phj->>'pta_status', it.snap_obj->>'pta_status', ''),
                'imei_1', COALESCE(
                    NULLIF(it.j->>'imei_1', ''),
                    it.snap_obj->>'imei_1',
                    -- A bare snapshot is an IMEI only if it is digits (14-17)
                    CASE WHEN jsonb_typeof(it.snap) IN ('string', 'number') AND btrim(it.snap #>> '{}') ~ '^[0-9]{8,17}$'
                         THEN btrim(it.snap #>> '{}') END,
                    phj->>'imei_1',
                    ''
                ),
                'imei_2', COALESCE(NULLIF(it.j->>'imei_2', ''), it.snap_obj->>'imei_2', phj->>'imei_2', ''),
                'quantity', COALESCE(public.edgex_num(it.j->>'quantity'), 1),
                'unit_price', COALESCE(public.edgex_num(it.j->>'unit_price'), public.edgex_num(it.j->>'price'), public.edgex_num(it.j->>'sale_price'), 0),
                'total', COALESCE(
                    public.edgex_num(it.j->>'subtotal'),
                    public.edgex_num(it.j->>'line_total'),
                    public.edgex_num(it.j->>'total_price'),
                    COALESCE(public.edgex_num(it.j->>'quantity'), 1) * COALESCE(public.edgex_num(it.j->>'unit_price'), public.edgex_num(it.j->>'price'), public.edgex_num(it.j->>'sale_price'), 0)
                )
            ) ORDER BY si.id)
            FROM public.sale_items si
            CROSS JOIN LATERAL (SELECT to_jsonb(si) AS j) x
            CROSS JOIN LATERAL (
                SELECT x.j AS j,
                       sn.snap,
                       CASE WHEN jsonb_typeof(sn.snap) = 'object' THEN sn.snap END AS snap_obj
                FROM (SELECT public.edgex_try_jsonb(x.j->>'imei_snapshot') AS snap) sn
            ) it
            LEFT JOIN public.phones ph ON ph.id::text = it.j->>'phone_id'
            LEFT JOIN public.products p ON p.id::text = it.j->>'product_id'
            CROSS JOIN LATERAL (SELECT to_jsonb(ph) AS phj, to_jsonb(p) AS pj) jj
            WHERE si.sale_id = s.id
        ), '[]'::jsonb)
    ) INTO v_res
    FROM public.sales s
    CROSS JOIN LATERAL (SELECT to_jsonb(s) AS sj) sx
    LEFT JOIN public.customers c ON c.id::text = sx.sj->>'customer_id'
    LEFT JOIN public.shops sh ON sh.id::text = sx.sj->>'shop_id'
    CROSS JOIN LATERAL (SELECT to_jsonb(c) AS cj, to_jsonb(sh) AS shj) r
    WHERE upper(COALESCE(s.invoice_token, '')) = v_clean
       OR upper(COALESCE(s.invoice_number, '')) IN (v_clean, 'INV-' || v_clean)
       OR v_clean = ANY (s.legacy_invoice_tokens)
    ORDER BY s.id DESC
    LIMIT 1;

    RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_invoice(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_invoice(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edgex_try_jsonb(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edgex_num(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
