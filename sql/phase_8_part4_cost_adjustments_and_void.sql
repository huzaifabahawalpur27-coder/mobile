-- ============================================================
-- PHASE 8: BATCH-BASED FIFO INVENTORY COSTING
-- Part 4: Batch Cost Adjustments, Safe Voiding & Valuation Reports
-- ============================================================

-- 1. RPC: adjust_batch_cost
-- Adjusts the current unit cost of a batch.
-- RULE: NEVER rewrites historical sales. Original cost is preserved.
-- Impact on already-sold units is calculated and logged to batch_cost_adjustments.
CREATE OR REPLACE FUNCTION public.adjust_batch_cost(
    p_batch_id BIGINT,
    p_new_cost NUMERIC,
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
    v_user_role TEXT;
    v_batch RECORD;
    v_old_cost NUMERIC;
    v_qty_sold NUMERIC;
    v_qty_remaining NUMERIC;
    v_cogs_impact NUMERIC;
    v_adj_id BIGINT;
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

    -- Role check: Admin or Manager only
    SELECT role INTO v_user_role FROM users WHERE id = v_user_id;
    IF v_user_role NOT IN ('admin', 'manager') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only Admin or Manager can adjust batch costs');
    END IF;

    IF p_new_cost IS NULL OR p_new_cost < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'New unit cost must be greater than or equal to zero');
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A specific adjustment reason is mandatory (minimum 3 characters)');
    END IF;

    -- Fetch and lock batch
    SELECT * INTO v_batch
    FROM stock_batches
    WHERE id = p_batch_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock batch not found in this shop');
    END IF;

    v_old_cost := v_batch.current_unit_cost;

    IF v_old_cost = p_new_cost THEN
        RETURN jsonb_build_object('success', false, 'error', 'New cost is identical to current cost. No change made.');
    END IF;

    v_qty_remaining := v_batch.qty_remaining;
    v_qty_sold := GREATEST(0, v_batch.qty_received - v_qty_remaining);
    v_cogs_impact := ROUND((p_new_cost - v_old_cost) * v_qty_sold, 2);

    -- 1. Update batch: change current_unit_cost (preserve original_unit_cost)
    UPDATE stock_batches
    SET current_unit_cost = p_new_cost,
        updated_at = NOW()
    WHERE id = v_batch.id;

    -- 2. Insert audit row into batch_cost_adjustments
    INSERT INTO batch_cost_adjustments (
        shop_id,
        batch_id,
        product_id,
        old_cost,
        new_cost,
        qty_sold_at_adjustment,
        qty_remaining_at_adjustment,
        cogs_impact,
        reason,
        adjusted_by,
        adjusted_at
    ) VALUES (
        v_shop_id,
        v_batch.id,
        v_batch.product_id,
        v_old_cost,
        p_new_cost,
        v_qty_sold,
        v_qty_remaining,
        v_cogs_impact,
        trim(p_reason),
        v_user_id,
        NOW()
    )
    RETURNING id INTO v_adj_id;

    RETURN jsonb_build_object(
        'success', true,
        'adjustment_id', v_adj_id,
        'batch_id', v_batch.id,
        'batch_no', v_batch.batch_no,
        'old_unit_cost', v_old_cost,
        'new_unit_cost', p_new_cost,
        'qty_remaining', v_qty_remaining,
        'qty_sold', v_qty_sold,
        'cogs_impact', v_cogs_impact,
        'reason', trim(p_reason),
        'adjusted_at', NOW()
    );
END;
$$;

-- 2. RPC: check_purchase_batches_before_void
-- Verifies whether a purchase can be safely voided/deleted.
-- Rule: Allowed ONLY if NONE of its batches has been sold.
CREATE OR REPLACE FUNCTION public.check_purchase_batches_before_void(
    p_purchase_id BIGINT
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
    v_sold_count INTEGER := 0;
    v_sold_details JSONB := '[]'::jsonb;
    v_total_batches INTEGER := 0;
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

    FOR v_batch IN 
        SELECT sb.*, p.name AS product_name
        FROM stock_batches sb
        JOIN products p ON p.id = sb.product_id
        WHERE sb.purchase_id = p_purchase_id AND sb.shop_id = v_shop_id
    LOOP
        v_total_batches := v_total_batches + 1;
        IF v_batch.qty_remaining < v_batch.qty_received THEN
            v_sold_count := v_sold_count + 1;
            v_sold_details := v_sold_details || jsonb_build_object(
                'batch_id', v_batch.id,
                'batch_no', v_batch.batch_no,
                'product_name', v_batch.product_name,
                'qty_received', v_batch.qty_received,
                'qty_remaining', v_batch.qty_remaining,
                'qty_sold', (v_batch.qty_received - v_batch.qty_remaining)
            );
        END IF;
    END LOOP;

    IF v_sold_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'can_void', false,
            'total_batches', v_total_batches,
            'sold_batches_count', v_sold_count,
            'sold_details', v_sold_details,
            'error', format('Cannot void purchase: %s batch(es) have already been partially or fully sold via FIFO allocation.', v_sold_count)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'can_void', true,
        'total_batches', v_total_batches
    );
END;
$$;

-- 3. RPC: void_purchase_batches
-- Cleans up unconsumed batches when a purchase is deleted
CREATE OR REPLACE FUNCTION public.void_purchase_batches(
    p_purchase_id BIGINT
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
    v_check JSONB;
    v_deleted_count INTEGER := 0;
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

    -- Safety check first
    v_check := check_purchase_batches_before_void(p_purchase_id);
    IF (v_check->>'can_void')::boolean IS NOT TRUE THEN
        RETURN v_check;
    END IF;

    DELETE FROM stock_batches
    WHERE purchase_id = p_purchase_id AND shop_id = v_shop_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', p_purchase_id,
        'deleted_batches', v_deleted_count
    );
END;
$$;

-- 4. RPC: get_fifo_inventory_valuation
-- Returns accurate batch-based valuation grouped by source
CREATE OR REPLACE FUNCTION public.get_fifo_inventory_valuation()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_total_units NUMERIC := 0;
    v_total_valuation NUMERIC := 0;
    v_purchase_valuation NUMERIC := 0;
    v_opening_valuation NUMERIC := 0;
    v_return_valuation NUMERIC := 0;
    v_active_batches INTEGER := 0;
    v_total_products INTEGER := 0;
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

    SELECT 
        COALESCE(SUM(qty_remaining), 0),
        COALESCE(SUM(qty_remaining * current_unit_cost), 0),
        COALESCE(SUM(CASE WHEN source = 'purchase' THEN qty_remaining * current_unit_cost ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN source = 'opening_balance' THEN qty_remaining * current_unit_cost ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN source = 'return_restock' THEN qty_remaining * current_unit_cost ELSE 0 END), 0),
        COUNT(id),
        COUNT(DISTINCT product_id)
    INTO 
        v_total_units,
        v_total_valuation,
        v_purchase_valuation,
        v_opening_valuation,
        v_return_valuation,
        v_active_batches,
        v_total_products
    FROM stock_batches
    WHERE shop_id = v_shop_id AND status = 'active' AND qty_remaining > 0;

    RETURN jsonb_build_object(
        'success', true,
        'total_units', v_total_units,
        'total_valuation', ROUND(v_total_valuation, 2),
        'purchase_valuation', ROUND(v_purchase_valuation, 2),
        'opening_balance_valuation', ROUND(v_opening_valuation, 2),
        'return_restock_valuation', ROUND(v_return_valuation, 2),
        'active_batches_count', v_active_batches,
        'batch_tracked_products_count', v_total_products
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_batch_cost(BIGINT, NUMERIC, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.check_purchase_batches_before_void(BIGINT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.void_purchase_batches(BIGINT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_fifo_inventory_valuation() TO anon, authenticated, public;
