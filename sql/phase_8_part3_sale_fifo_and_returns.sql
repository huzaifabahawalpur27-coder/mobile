-- ============================================================
-- PHASE 8: BATCH-BASED FIFO INVENTORY COSTING
-- Part 3: Sale FIFO Allocation, Return Reversals & Stock Adjustments
-- ============================================================

-- 1. RPC: allocate_sale_line_fifo
-- Atomically allocates stock from oldest active batches using SELECT ... FOR UPDATE
CREATE OR REPLACE FUNCTION public.allocate_sale_line_fifo(
    p_sale_item_id BIGINT,
    p_product_id BIGINT,
    p_quantity NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_prod RECORD;
    v_batch RECORD;
    v_needed NUMERIC := p_quantity;
    v_take NUMERIC;
    v_total_cost NUMERIC := 0;
    v_weighted_cost NUMERIC := 0;
    v_allocations JSONB := '[]'::jsonb;
    v_avail_batch_sum NUMERIC := 0;
BEGIN
    v_token := current_session_token();
    IF v_token IS NOT NULL THEN
        SELECT user_id, shop_id INTO v_user_id, v_shop_id
        FROM sessions
        WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());
    END IF;

    IF v_shop_id IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT id, shop_id INTO v_user_id, v_shop_id
        FROM users
        WHERE id = auth.uid();
    END IF;

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    IF p_quantity <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Allocation quantity must be greater than zero');
    END IF;

    -- Verify product
    SELECT * INTO v_prod
    FROM products
    WHERE id = p_product_id AND shop_id = v_shop_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product not found in this shop');
    END IF;

    -- Check total available stock across active batches first
    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_avail_batch_sum
    FROM stock_batches
    WHERE shop_id = v_shop_id 
      AND product_id = p_product_id 
      AND status = 'active' 
      AND qty_remaining > 0;

    IF v_avail_batch_sum < p_quantity THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Insufficient batch stock for "%s". Required: %s units, Available in active lots: %s units.', v_prod.name, p_quantity, v_avail_batch_sum)
        );
    END IF;

    -- Iterate batches in strict FIFO order (Oldest purchase_date first, then id) with pessimistic row locks
    FOR v_batch IN 
        SELECT id, batch_no, qty_remaining, current_unit_cost, status
        FROM stock_batches
        WHERE shop_id = v_shop_id 
          AND product_id = p_product_id 
          AND status = 'active' 
          AND qty_remaining > 0
        ORDER BY purchase_date ASC, id ASC
        FOR UPDATE
    LOOP
        EXIT WHEN v_needed <= 0;

        v_take := LEAST(v_batch.qty_remaining, v_needed);

        -- Decrement batch quantity
        UPDATE stock_batches
        SET qty_remaining = qty_remaining - v_take,
            status = CASE WHEN (qty_remaining - v_take) = 0 THEN 'depleted' ELSE 'active' END,
            updated_at = NOW()
        WHERE id = v_batch.id;

        -- Record sale item batch consumption with cost snapshot
        INSERT INTO sale_item_batches (
            shop_id,
            sale_item_id,
            batch_id,
            qty,
            unit_cost_at_sale,
            reversed_qty,
            created_at
        ) VALUES (
            v_shop_id,
            p_sale_item_id,
            v_batch.id,
            v_take,
            v_batch.current_unit_cost,
            0,
            NOW()
        );

        v_total_cost := v_total_cost + (v_take * v_batch.current_unit_cost);
        v_needed := v_needed - v_take;

        v_allocations := v_allocations || jsonb_build_object(
            'batch_id', v_batch.id,
            'batch_no', v_batch.batch_no,
            'qty_allocated', v_take,
            'unit_cost', v_batch.current_unit_cost
        );
    END LOOP;

    -- Safety sanity check
    IF v_needed > 0 THEN
        RAISE EXCEPTION 'FIFO Allocation concurrency violation: Could not fulfill requested quantity (%s remaining)', v_needed;
    END IF;

    -- Calculate weighted average unit cost for the line item
    v_weighted_cost := ROUND(v_total_cost / p_quantity, 2);

    -- Snapshot weighted cost price into sale_items line
    UPDATE sale_items
    SET cost_price = v_weighted_cost
    WHERE id = p_sale_item_id;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', p_product_id,
        'sale_item_id', p_sale_item_id,
        'quantity', p_quantity,
        'total_cogs', v_total_cost,
        'weighted_unit_cost', v_weighted_cost,
        'allocations', v_allocations
    );
END;
$$;

-- 2. RPC: return_sale_item_batches
-- Atomically reverses batch allocations when customer returns items
CREATE OR REPLACE FUNCTION public.return_sale_item_batches(
    p_sale_item_id BIGINT,
    p_return_qty NUMERIC,
    p_fallback_cost NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_item RECORD;
    v_alloc RECORD;
    v_needed NUMERIC := p_return_qty;
    v_unreversed NUMERIC;
    v_restore NUMERIC;
    v_batches_restored JSONB := '[]'::jsonb;
    v_opening_batch_id BIGINT;
    v_clean_sku TEXT;
    v_new_batch_no TEXT;
    v_cost_to_use NUMERIC;
BEGIN
    v_token := current_session_token();
    IF v_token IS NOT NULL THEN
        SELECT user_id, shop_id INTO v_user_id, v_shop_id
        FROM sessions
        WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());
    END IF;

    IF v_shop_id IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT id, shop_id INTO v_user_id, v_shop_id
        FROM users
        WHERE id = auth.uid();
    END IF;

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    IF p_return_qty <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Return quantity must be greater than zero');
    END IF;

    -- Fetch sale item
    SELECT si.*, s.shop_id, p.inventory_mode, p.name AS product_name, p.sku AS product_sku
    INTO v_item
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.id = p_sale_item_id;

    IF NOT FOUND OR v_item.shop_id != v_shop_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sale item not found in this shop');
    END IF;

    -- Case 1: Sale was made WITH batch allocations (sale_item_batches rows exist)
    IF EXISTS (SELECT 1 FROM sale_item_batches WHERE sale_item_id = p_sale_item_id) THEN
        -- Reverse in reverse allocation order (LIFO reversal)
        FOR v_alloc IN 
            SELECT sib.*, sb.batch_no, sb.current_unit_cost
            FROM sale_item_batches sib
            JOIN stock_batches sb ON sb.id = sib.batch_id
            WHERE sib.sale_item_id = p_sale_item_id
              AND (sib.qty - sib.reversed_qty) > 0
            ORDER BY sib.id DESC
            FOR UPDATE OF sib
        LOOP
            EXIT WHEN v_needed <= 0;

            v_unreversed := v_alloc.qty - v_alloc.reversed_qty;
            v_restore := LEAST(v_unreversed, v_needed);

            -- Update allocation record
            UPDATE sale_item_batches
            SET reversed_qty = reversed_qty + v_restore
            WHERE id = v_alloc.id;

            -- Restore batch stock
            UPDATE stock_batches
            SET qty_remaining = qty_remaining + v_restore,
                status = 'active',
                updated_at = NOW()
            WHERE id = v_alloc.batch_id;

            v_needed := v_needed - v_restore;

            v_batches_restored := v_batches_restored || jsonb_build_object(
                'batch_id', v_alloc.batch_id,
                'batch_no', v_alloc.batch_no,
                'qty_restored', v_restore,
                'unit_cost', v_alloc.unit_cost_at_sale
            );
        END LOOP;

    -- Case 2: Pre-conversion sale of a product that is now batch_tracked (or no allocations exist)
    ELSIF v_item.product_id IS NOT NULL AND v_item.inventory_mode = 'batch_tracked' THEN
        v_cost_to_use := COALESCE(p_fallback_cost, v_item.cost_price, 0);

        -- Check if an active opening_balance batch exists for this product
        SELECT id INTO v_opening_batch_id
        FROM stock_batches
        WHERE product_id = v_item.product_id 
          AND shop_id = v_shop_id 
          AND source = 'opening_balance'
          AND current_unit_cost = v_cost_to_use
        ORDER BY id ASC
        LIMIT 1;

        IF v_opening_batch_id IS NOT NULL THEN
            UPDATE stock_batches
            SET qty_remaining = qty_remaining + p_return_qty,
                status = 'active',
                updated_at = NOW()
            WHERE id = v_opening_batch_id;

            v_batches_restored := jsonb_build_array(jsonb_build_object(
                'batch_id', v_opening_batch_id,
                'action', 'restored_to_opening_balance',
                'qty_restored', p_return_qty,
                'unit_cost', v_cost_to_use
            ));
        ELSE
            -- Create dedicated return_restock lot batch
            v_clean_sku := regexp_replace(COALESCE(v_item.product_sku, format('PRD%s', v_item.product_id)), '[^a-zA-Z0-9_-]', '', 'g');
            v_new_batch_no := format('RET-%s-%s', v_clean_sku, to_char(NOW(), 'YYMMDDHH24MI'));

            INSERT INTO stock_batches (
                shop_id,
                product_id,
                batch_no,
                purchase_date,
                qty_received,
                qty_remaining,
                original_unit_cost,
                current_unit_cost,
                source,
                status,
                notes,
                created_at
            ) VALUES (
                v_shop_id,
                v_item.product_id,
                v_new_batch_no,
                NOW(),
                p_return_qty,
                p_return_qty,
                v_cost_to_use,
                v_cost_to_use,
                'return_restock',
                'active',
                format('Restocked from sale return #%s', v_item.sale_id),
                NOW()
            )
            RETURNING id INTO v_opening_batch_id;

            v_batches_restored := jsonb_build_array(jsonb_build_object(
                'batch_id', v_opening_batch_id,
                'batch_no', v_new_batch_no,
                'action', 'created_return_restock_batch',
                'qty_restored', p_return_qty,
                'unit_cost', v_cost_to_use
            ));
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'sale_item_id', p_sale_item_id,
        'return_qty', p_return_qty,
        'batches_restored', v_batches_restored
    );
END;
$$;

-- 3. RPC: adjust_batch_stock
-- Adjusts batch quantity directly (damage, loss, physical count correction)
CREATE OR REPLACE FUNCTION public.adjust_batch_stock(
    p_batch_id BIGINT,
    p_qty_change NUMERIC,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_batch RECORD;
    v_new_qty NUMERIC;
    v_prod_new_stock NUMERIC;
BEGIN
    v_token := current_session_token();
    IF v_token IS NOT NULL THEN
        SELECT user_id, shop_id INTO v_user_id, v_shop_id
        FROM sessions
        WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());
    END IF;

    IF v_shop_id IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT id, shop_id INTO v_user_id, v_shop_id
        FROM users
        WHERE id = auth.uid();
    END IF;

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Adjustment reason is required');
    END IF;

    IF p_qty_change = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Quantity change cannot be zero');
    END IF;

    -- Lock batch row
    SELECT * INTO v_batch
    FROM stock_batches
    WHERE id = p_batch_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock batch not found in this shop');
    END IF;

    v_new_qty := v_batch.qty_remaining + p_qty_change;

    IF v_new_qty < 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cannot adjust below zero. Current batch balance is %s, requested change is %s.', v_batch.qty_remaining, p_qty_change)
        );
    END IF;

    -- Update batch
    UPDATE stock_batches
    SET qty_remaining = v_new_qty,
        status = CASE WHEN v_new_qty = 0 THEN 'depleted' ELSE 'active' END,
        updated_at = NOW()
    WHERE id = v_batch.id;

    -- Update product stock quantity to maintain invariant
    UPDATE products
    SET stock_quantity = stock_quantity + p_qty_change,
        updated_at = NOW()
    WHERE id = v_batch.product_id
    RETURNING stock_quantity INTO v_prod_new_stock;

    -- Audit log in stock_adjustments
    INSERT INTO stock_adjustments (
        shop_id,
        batch_id,
        product_id,
        qty_change,
        reason,
        created_by,
        created_at
    ) VALUES (
        v_shop_id,
        v_batch.id,
        v_batch.product_id,
        p_qty_change,
        trim(p_reason),
        v_user_id,
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'batch_id', v_batch.id,
        'batch_no', v_batch.batch_no,
        'old_qty_remaining', v_batch.qty_remaining,
        'new_qty_remaining', v_new_qty,
        'product_stock_quantity', v_prod_new_stock,
        'reason', trim(p_reason)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_sale_line_fifo(BIGINT, BIGINT, NUMERIC) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.return_sale_item_batches(BIGINT, NUMERIC, NUMERIC) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.adjust_batch_stock(BIGINT, NUMERIC, TEXT) TO anon, authenticated, public;
