-- ============================================================================
-- Phase 0b: keep links already shared with customers working
-- Run AFTER sql/phase0_invoice_link_and_outbox_fix.sql. Safe to re-run.
--
-- Before Phase 0, phone-sale and exchange WhatsApp links carried a token generated
-- in the browser that the server never stored, so every such link showed
-- "Invoice not found". Those tokens survive in sent outbox messages. This file:
--   1. adds legacy_invoice_tokens TEXT[] to sales and exchanges,
--   2. backfills it from whatsapp_queue rows on the server, and
--   3. lets get_public_invoice resolve a legacy token (still token-only; the
--      8+ character unguessable-reference guard is unchanged).
-- The app also uploads legacy tokens that exist only on shop devices
-- (registerLegacyInvoiceTokens in src/services/whatsappQueueService.js) when the
-- WhatsApp outbox is opened.
-- ============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS legacy_invoice_tokens TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS legacy_invoice_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sales_legacy_invoice_tokens ON public.sales USING GIN (legacy_invoice_tokens);
CREATE INDEX IF NOT EXISTS idx_exchanges_legacy_invoice_tokens ON public.exchanges USING GIN (legacy_invoice_tokens);

-- Backfill from server-side outbox rows (only well-formed, non-numeric 8+ char tokens).
DO $$
BEGIN
    IF to_regclass('public.whatsapp_queue') IS NULL THEN
        RAISE NOTICE 'whatsapp_queue missing; skipping backfill';
        RETURN;
    END IF;

    WITH q AS (
        SELECT (w.reference_data->>'sale_id')::BIGINT AS row_id,
               array_agg(DISTINCT upper(regexp_replace(t.tok, '^(INV-|EXC-)', '', 'i'))) AS toks
        FROM public.whatsapp_queue w
        CROSS JOIN LATERAL (
            SELECT w.reference_data->>'invoice_token' AS tok
            UNION ALL
            SELECT jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(w.reference_data->'legacy_invoice_tokens') = 'array'
                     THEN w.reference_data->'legacy_invoice_tokens' ELSE '[]'::jsonb END)
        ) t
        WHERE (w.reference_data->>'sale_id') ~ '^[0-9]+$'
          AND t.tok IS NOT NULL
          AND NOT COALESCE((w.reference_data->>'is_exchange')::BOOLEAN, FALSE)
        GROUP BY 1
    )
    UPDATE public.sales t
    SET legacy_invoice_tokens = ARRAY(
        SELECT DISTINCT x FROM unnest(t.legacy_invoice_tokens || q.toks) AS x
        WHERE x ~ '^[A-Z0-9]{8,64}$' AND x !~ '^[0-9]+$'
          AND x <> upper(COALESCE(t.invoice_token, ''))
        ORDER BY x
    )
    FROM q
    WHERE t.id = q.row_id;

    WITH q AS (
        SELECT (w.reference_data->>'exchange_id')::BIGINT AS row_id,
               array_agg(DISTINCT upper(regexp_replace(t.tok, '^(INV-|EXC-)', '', 'i'))) AS toks
        FROM public.whatsapp_queue w
        CROSS JOIN LATERAL (
            SELECT w.reference_data->>'invoice_token' AS tok
            UNION ALL
            SELECT jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(w.reference_data->'legacy_invoice_tokens') = 'array'
                     THEN w.reference_data->'legacy_invoice_tokens' ELSE '[]'::jsonb END)
        ) t
        WHERE (w.reference_data->>'exchange_id') ~ '^[0-9]+$'
          AND t.tok IS NOT NULL
        GROUP BY 1
    )
    UPDATE public.exchanges t
    SET legacy_invoice_tokens = ARRAY(
        SELECT DISTINCT x FROM unnest(t.legacy_invoice_tokens || q.toks) AS x
        WHERE x ~ '^[A-Z0-9]{8,64}$' AND x !~ '^[0-9]+$'
          AND x <> upper(COALESCE(t.invoice_token, ''))
        ORDER BY x
    )
    FROM q
    WHERE t.id = q.row_id;
END;
$$;

-- Recreate get_public_invoice (from phase0) with legacy-token matching.
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
    WHERE upper(e.invoice_token) = v_clean
       OR v_clean = ANY (e.legacy_invoice_tokens);

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
       OR v_clean = ANY (s.legacy_invoice_tokens)
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
