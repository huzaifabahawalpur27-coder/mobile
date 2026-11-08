-- ============================================================
-- RPC: get_public_invoice (Public Secure Digital Receipt Viewer)
-- Protects against Insecure Direct Object Reference (IDOR) by
-- requiring unguessable random tokens (e.g. INV-8K3P9X2M) instead
-- of sequential incremental integer IDs.
-- ============================================================

-- 1. Ensure invoice_token columns exist on sales and exchanges
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_token TEXT;
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS invoice_token TEXT;

-- 2. Backfill existing records with unique random tokens
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

-- 5. RPC Function: get_public_invoice
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
       OR upper(e.exchange_number) = upper(p_reference)
       OR upper(e.exchange_number) = ('EXC-' || v_clean);

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
        'customer_name', COALESCE(c.name, s.customer_name, 'Valued Customer'),
        'customer_phone', COALESCE(c.phone, s.customer_phone, ''),
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
                'name', COALESCE(si.product_name, p.name, ph.model, 'Phone / Accessory'),
                'brand', COALESCE(ph.brand, ''),
                'model', COALESCE(ph.model, ''),
                'storage', COALESCE(ph.storage, ''),
                'color', COALESCE(ph.color, ''),
                'condition', COALESCE(ph.condition, ''),
                'pta_status', COALESCE(ph.pta_status, ''),
                'imei_1', COALESCE(si.imei_1, ph.imei_1, ''),
                'imei_2', COALESCE(si.imei_2, ph.imei_2, ''),
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
    WHERE upper(s.invoice_token) = v_clean
       OR (v_clean ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' AND s.idempotency_key = v_clean::UUID);

    IF v_res IS NOT NULL THEN
        RETURN v_res;
    END IF;

    RETURN NULL;
END;
$$;

-- Grant execution to public / unauthenticated users
GRANT EXECUTE ON FUNCTION public.get_public_invoice(TEXT) TO anon, authenticated, service_role;
