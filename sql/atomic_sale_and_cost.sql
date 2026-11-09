-- ============================================================================
-- One-step POS sale + weighted-average cost on purchases
-- Run AFTER sql/atomic_stock_and_balances.sql (uses edgex_claim_op and
-- edgex_adjust_party_balance). Safe to re-run.
--
-- process_pos_sale(p_sale, p_items, p_balance_delta, p_apply_stock)
--   Saves an accessory / mixed POS sale in ONE transaction: sale header, lines,
--   stock, phones and the customer's balance. If anything fails (phone already
--   sold, product from another shop, bad data) nothing is saved, so there is no
--   half-saved sale to undo. Columns are taken from the JSON that exist in the
--   live tables, so older/newer schemas both work. Replays of the same
--   idempotency_key return the sale that was already saved.
--
-- receive_purchase_stock(p_product_id, p_qty, p_unit_cost, p_op_id)
--   Adds purchased stock and blends the cost price instead of overwriting it:
--     new_cost = (stock * cost + qty * unit_cost) / (stock + qty)
--   (the purchase price when nothing was on hand). Same statement, own shop only,
--   idempotent with p_op_id.
-- ============================================================================

-- Internal: insert one JSON object into a table, using only keys that are real
-- columns (id is always left to the database). p_force overrides keys.
CREATE OR REPLACE FUNCTION public.edgex_insert_json(p_table TEXT, p_row JSONB, p_force JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row JSONB := (COALESCE(p_row, '{}'::jsonb) - 'id') || COALESCE(p_force, '{}'::jsonb);
    v_cols TEXT;
    v_out JSONB;
BEGIN
    IF p_table NOT IN ('sales', 'sale_items') THEN
        RAISE EXCEPTION 'Unsupported table %', p_table;
    END IF;
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = p_table
       AND c.column_name <> 'id' AND c.is_generated = 'NEVER'
       AND v_row ? c.column_name;
    IF v_cols IS NULL THEN
        RAISE EXCEPTION 'Nothing to insert into %', p_table;
    END IF;
    EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) RETURNING to_jsonb(%1$I.*)',
                   p_table, v_cols)
       INTO v_out USING v_row;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.edgex_insert_json(TEXT, JSONB, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.process_pos_sale(
    p_sale JSONB,
    p_items JSONB,
    p_balance_delta NUMERIC DEFAULT 0,
    p_apply_stock BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_sale JSONB := COALESCE(p_sale, '{}'::jsonb);
    v_key TEXT := NULLIF(p_sale->>'idempotency_key', '');
    v_existing JSONB;
    v_customer BIGINT;
    v_item JSONB;
    v_saved JSONB;
    v_lines JSONB := '[]'::jsonb;
    v_phone_id BIGINT;
    v_product_id BIGINT;
    v_qty NUMERIC;
    v_status TEXT;
    v_phone_sets TEXT := 'status = ''sold''';
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Cart is empty';
    END IF;

    -- Replay of a sale that was already saved (lost reply, double tap)
    IF v_key IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'idempotency_key') THEN
        EXECUTE 'SELECT to_jsonb(s.*) FROM public.sales s WHERE s.shop_id = $1 AND s.idempotency_key::text = $2 LIMIT 1'
           INTO v_existing USING v_shop, v_key;
        IF v_existing IS NOT NULL THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(si.*)), '[]'::jsonb) INTO v_lines
              FROM public.sale_items si WHERE si.sale_id = (v_existing->>'id')::BIGINT;
            RETURN jsonb_build_object('success', true, 'replay', true, 'sale', v_existing, 'items', v_lines);
        END IF;
    END IF;

    -- A customer from another shop (or deleted) is dropped, as the app did before
    -- (an offline customer's temporary id is not a number: also dropped)
    v_customer := CASE WHEN v_sale->>'customer_id' ~ '^[0-9]+$' THEN (v_sale->>'customer_id')::BIGINT END;
    IF v_customer IS NULL AND v_sale ? 'customer_id' THEN
        v_sale := jsonb_set(v_sale, '{customer_id}', 'null'::jsonb);
    END IF;
    IF v_customer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer AND shop_id = v_shop) THEN
        v_customer := NULL;
        v_sale := jsonb_set(v_sale, '{customer_id}', 'null'::jsonb);
    END IF;

    -- Lock and check every phone / product before writing anything
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_phone_id := NULLIF(v_item->>'phone_id', '')::BIGINT;
        v_product_id := NULLIF(v_item->>'product_id', '')::BIGINT;
        IF v_phone_id IS NOT NULL THEN
            SELECT status INTO v_status FROM public.phones WHERE id = v_phone_id AND shop_id = v_shop FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Phone % not found in this shop', v_phone_id USING ERRCODE = 'P0002';
            END IF;
            IF p_apply_stock AND v_status IS DISTINCT FROM 'in_stock' THEN
                RAISE EXCEPTION 'Phone % is not in stock (status: %) - already sold', v_phone_id, v_status USING ERRCODE = 'P0001';
            END IF;
        ELSIF v_product_id IS NOT NULL THEN
            PERFORM 1 FROM public.products WHERE id = v_product_id AND shop_id = v_shop FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Product % not found in this shop', v_product_id USING ERRCODE = 'P0002';
            END IF;
        END IF;
    END LOOP;

    v_saved := public.edgex_insert_json('sales', v_sale, jsonb_build_object('shop_id', v_shop));

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_lines := v_lines || public.edgex_insert_json('sale_items', v_item,
                       jsonb_build_object('sale_id', v_saved->'id'));
    END LOOP;

    IF p_apply_stock THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'sale_price') THEN
            v_phone_sets := v_phone_sets || ', sale_price = $2';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'sold_at') THEN
            v_phone_sets := v_phone_sets || ', sold_at = now()';
        END IF;
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_phone_id := NULLIF(v_item->>'phone_id', '')::BIGINT;
            v_product_id := NULLIF(v_item->>'product_id', '')::BIGINT;
            v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::NUMERIC, 1);
            IF v_phone_id IS NOT NULL THEN
                EXECUTE format('UPDATE public.phones SET %s WHERE id = $1 AND shop_id = $3', v_phone_sets)
                  USING v_phone_id, COALESCE(NULLIF(v_item->>'unit_price', '')::NUMERIC, NULLIF(v_item->>'price', '')::NUMERIC), v_shop;
            ELSIF v_product_id IS NOT NULL THEN
                UPDATE public.products SET stock_quantity = COALESCE(stock_quantity, 0) - v_qty
                 WHERE id = v_product_id AND shop_id = v_shop;
            END IF;
        END LOOP;
    END IF;

    IF v_customer IS NOT NULL AND COALESCE(p_balance_delta, 0) <> 0 THEN
        PERFORM public.edgex_adjust_party_balance('customers', v_customer, p_balance_delta, NULL, 'process_pos_sale');
    END IF;

    RETURN jsonb_build_object('success', true, 'sale', v_saved, 'items', v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_stock(p_product_id BIGINT, p_qty NUMERIC, p_unit_cost NUMERIC, p_op_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_stock NUMERIC;
    v_cost NUMERIC;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(p_qty, 0) = 0 THEN
        RETURN jsonb_build_object('success', true, 'unchanged', true);
    END IF;
    IF NOT public.edgex_claim_op(p_op_id, v_shop, 'receive_purchase_stock') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    UPDATE public.products p
       SET cost_price = CASE
             WHEN COALESCE(p.stock_quantity, 0) > 0 AND COALESCE(p.stock_quantity, 0) + p_qty > 0
               THEN ROUND((p.stock_quantity * COALESCE(p.cost_price, 0) + p_qty * COALESCE(p_unit_cost, 0))
                          / (p.stock_quantity + p_qty), 2)
             ELSE COALESCE(p_unit_cost, p.cost_price)
           END,
           stock_quantity = COALESCE(p.stock_quantity, 0) + p_qty
     WHERE p.id = p_product_id AND p.shop_id = v_shop
    RETURNING p.stock_quantity, p.cost_price INTO v_stock, v_cost;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in this shop', p_product_id USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('success', true, 'stock_quantity', v_stock, 'cost_price', v_cost);
END;
$$;

-- Internal helpers must not be callable from the browser. Supabase grants new
-- functions to anon/authenticated by default, so revoke those grants explicitly.
DO $$ BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.edgex_insert_json(TEXT, JSONB, JSONB) FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.process_pos_sale(JSONB, JSONB, NUMERIC, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_stock(BIGINT, NUMERIC, NUMERIC, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
