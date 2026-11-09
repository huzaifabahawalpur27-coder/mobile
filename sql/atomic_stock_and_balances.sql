-- ============================================================================
-- Atomic stock / balance changes and a safe "mark phone sold"
-- Run after production_security_hardening.sql (needs current_user_shop_id()).
-- Safe to re-run.
--
-- Why: POS, Sales, Purchases and returns used to compute new stock and balances in
-- the browser ("what this screen loaded, minus/plus this sale") and write the result
-- as an absolute number. Two devices, or a screen left open, overwrote each other;
-- offline syncs could roll values back; a phone could be marked sold twice.
--
-- These functions apply a DELTA inside the database, for the caller's own shop only:
--   adjust_product_stock(p_product_id, p_delta, p_op_id)
--   adjust_customer_balance(p_customer_id, p_delta, p_op_id)
--   adjust_supplier_balance(p_supplier_id, p_delta, p_op_id)
--   mark_phone_sold(p_phone_id, p_sale_price, p_op_id)   -- only if still in stock
-- p_op_id (uuid, optional) makes a call idempotent: a replay of the same operation
-- (e.g. an offline queue retry after a lost reply) is recognised and not applied twice.
-- Errors (no session, not found, already sold) RAISE, so nothing is half-applied.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.atomic_op_log (
    op_id      UUID PRIMARY KEY,
    shop_id    INTEGER,
    fn         TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.atomic_op_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atomic_op_log FROM PUBLIC;
DO $$ BEGIN
    EXECUTE 'REVOKE ALL ON public.atomic_op_log FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Internal: record an operation id; FALSE if it was already applied
CREATE OR REPLACE FUNCTION public.edgex_claim_op(p_op_id UUID, p_shop_id INTEGER, p_fn TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_op_id IS NULL THEN
        RETURN TRUE;
    END IF;
    INSERT INTO public.atomic_op_log (op_id, shop_id, fn) VALUES (p_op_id, p_shop_id, p_fn)
    ON CONFLICT (op_id) DO NOTHING;
    RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.edgex_claim_op(UUID, INTEGER, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.adjust_product_stock(p_product_id BIGINT, p_delta NUMERIC, p_op_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_new NUMERIC;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 THEN
        RETURN jsonb_build_object('success', true, 'unchanged', true);
    END IF;
    IF NOT public.edgex_claim_op(p_op_id, v_shop, 'adjust_product_stock') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    UPDATE public.products
    SET stock_quantity = COALESCE(stock_quantity, 0) + p_delta
    WHERE id = p_product_id AND shop_id = v_shop
    RETURNING stock_quantity INTO v_new;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in this shop', p_product_id USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('success', true, 'stock_quantity', v_new);
END;
$$;

-- Shared balance logic for customers / suppliers (keeps outstanding_balance and the
-- legacy balance column equal, whichever of the two exist)
CREATE OR REPLACE FUNCTION public.edgex_adjust_party_balance(p_table TEXT, p_id BIGINT, p_delta NUMERIC, p_op_id UUID, p_fn TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_has_outstanding BOOLEAN;
    v_has_balance BOOLEAN;
    v_base TEXT;
    v_sets TEXT;
    v_new NUMERIC;
BEGIN
    IF p_table NOT IN ('customers', 'suppliers') THEN
        RAISE EXCEPTION 'Unsupported table %', p_table;
    END IF;
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 THEN
        RETURN jsonb_build_object('success', true, 'unchanged', true);
    END IF;
    IF NOT public.edgex_claim_op(p_op_id, v_shop, p_fn) THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'outstanding_balance'),
           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'balance')
      INTO v_has_outstanding, v_has_balance;
    IF NOT v_has_outstanding AND NOT v_has_balance THEN
        RAISE EXCEPTION '% has no balance column', p_table;
    END IF;

    v_base := CASE
        WHEN v_has_outstanding AND v_has_balance THEN 'COALESCE(outstanding_balance, balance, 0)'
        WHEN v_has_outstanding THEN 'COALESCE(outstanding_balance, 0)'
        ELSE 'COALESCE(balance, 0)'
    END;
    v_sets := concat_ws(', ',
        CASE WHEN v_has_outstanding THEN format('outstanding_balance = %s + $3', v_base) END,
        CASE WHEN v_has_balance THEN format('balance = %s + $3', v_base) END);

    EXECUTE format('UPDATE public.%I SET %s WHERE id = $1 AND shop_id = $2 RETURNING %s + 0',
                   p_table, v_sets, CASE WHEN v_has_outstanding THEN 'outstanding_balance' ELSE 'balance' END)
       INTO v_new USING p_id, v_shop, p_delta;

    IF v_new IS NULL THEN
        RAISE EXCEPTION '% % not found in this shop', p_table, p_id USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('success', true, 'balance', v_new);
END;
$$;
REVOKE ALL ON FUNCTION public.edgex_adjust_party_balance(TEXT, BIGINT, NUMERIC, UUID, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.adjust_customer_balance(p_customer_id BIGINT, p_delta NUMERIC, p_op_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    -- session check happens inside (current_user_shop_id)
    SELECT public.edgex_adjust_party_balance('customers', p_customer_id, p_delta, p_op_id, 'adjust_customer_balance')
$$;

CREATE OR REPLACE FUNCTION public.adjust_supplier_balance(p_supplier_id BIGINT, p_delta NUMERIC, p_op_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    -- session check happens inside (current_user_shop_id)
    SELECT public.edgex_adjust_party_balance('suppliers', p_supplier_id, p_delta, p_op_id, 'adjust_supplier_balance')
$$;

-- Marks a phone sold only if it is still in stock in the caller's shop
CREATE OR REPLACE FUNCTION public.mark_phone_sold(p_phone_id BIGINT, p_sale_price NUMERIC DEFAULT NULL, p_op_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_sets TEXT := 'status = ''sold''';
    v_id BIGINT;
    v_status TEXT;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF NOT public.edgex_claim_op(p_op_id, v_shop, 'mark_phone_sold') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'sale_price') THEN
        v_sets := v_sets || ', sale_price = COALESCE($3, sale_price)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'sold_at') THEN
        v_sets := v_sets || ', sold_at = now()';
    END IF;

    EXECUTE format('UPDATE public.phones SET %s WHERE id = $1 AND shop_id = $2 AND status = ''in_stock'' RETURNING id', v_sets)
       INTO v_id USING p_phone_id, v_shop, p_sale_price;

    IF v_id IS NULL THEN
        SELECT status INTO v_status FROM public.phones WHERE id = p_phone_id AND shop_id = v_shop;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Phone % not found in this shop', p_phone_id USING ERRCODE = 'P0002';
        END IF;
        RAISE EXCEPTION 'Phone % is not in stock (status: %) - already sold', p_phone_id, v_status USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('success', true, 'phone_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(BIGINT, NUMERIC, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_customer_balance(BIGINT, NUMERIC, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_supplier_balance(BIGINT, NUMERIC, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_phone_sold(BIGINT, NUMERIC, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
