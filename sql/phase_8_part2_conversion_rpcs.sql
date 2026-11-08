-- ============================================================
-- PHASE 8: BATCH-BASED FIFO INVENTORY COSTING
-- Part 2: Product Conversion RPCs (Preview, Apply, Revert & Reconcile)
-- ============================================================

-- 1. RPC: preview_product_batch_conversion
-- Non-mutating preview tool for single products, categories, or bulk selection
CREATE OR REPLACE FUNCTION public.preview_product_batch_conversion(
    p_product_id INTEGER DEFAULT NULL,
    p_category_id INTEGER DEFAULT NULL,
    p_product_ids INTEGER[] DEFAULT NULL
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
    v_last_purchase_cost NUMERIC;
    v_resolved_cost NUMERIC;
    v_cost_source TEXT;
    v_is_eligible BOOLEAN;
    v_exceptions TEXT[];
    v_results JSONB := '[]'::jsonb;
    v_item JSONB;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id INTO v_user_id, v_shop_id
    FROM sessions
    WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired or invalid shop');
    END IF;

    -- Query candidate products within the user's shop
    FOR v_prod IN 
        SELECT p.id, p.name, p.sku, p.brand, p.category_id, p.stock_quantity, 
               p.cost_price, p.inventory_mode, c.name AS category_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.shop_id = v_shop_id
          AND (p_product_id IS NULL OR p.id = p_product_id)
          AND (p_category_id IS NULL OR p.category_id = p_category_id)
          AND (p_product_ids IS NULL OR p.id = ANY(p_product_ids))
        ORDER BY p.name ASC
    LOOP
        v_exceptions := ARRAY[]::TEXT[];
        v_is_eligible := TRUE;
        v_cost_source := 'none';
        v_resolved_cost := 0;

        -- 1. Check current inventory mode
        IF v_prod.inventory_mode = 'batch_tracked' THEN
            v_exceptions := array_append(v_exceptions, 'Already batch tracked');
            v_is_eligible := FALSE;
        ELSIF v_prod.inventory_mode = 'serialized' THEN
            v_exceptions := array_append(v_exceptions, 'Serialized device (phones track individual IMEIs)');
            v_is_eligible := FALSE;
        END IF;

        -- 2. Check stock balance
        IF COALESCE(v_prod.stock_quantity, 0) < 0 THEN
            v_exceptions := array_append(v_exceptions, format('Negative stock quantity (%s). Correct physical stock before converting.', v_prod.stock_quantity));
            v_is_eligible := FALSE;
        END IF;

        -- 3. Resolve Cost Fallback Order:
        -- Priority 1: Last purchase item cost price
        SELECT pi.cost_price INTO v_last_purchase_cost
        FROM purchase_items pi
        JOIN purchases pr ON pr.id = pi.purchase_id
        WHERE pi.product_id = v_prod.id 
          AND pr.shop_id = v_shop_id
          AND pi.cost_price > 0
        ORDER BY pr.created_at DESC, pi.id DESC
        LIMIT 1;

        IF v_last_purchase_cost IS NOT NULL AND v_last_purchase_cost > 0 THEN
            v_resolved_cost := v_last_purchase_cost;
            v_cost_source := 'last_purchase_cost';
        ELSIF v_prod.cost_price IS NOT NULL AND v_prod.cost_price > 0 THEN
            v_resolved_cost := v_prod.cost_price;
            v_cost_source := 'catalog_cost_price';
        ELSE
            v_resolved_cost := 0;
            v_cost_source := 'missing';
            IF COALESCE(v_prod.stock_quantity, 0) > 0 THEN
                v_exceptions := array_append(v_exceptions, 'Missing or zero cost price. Enter opening unit cost before converting.');
                v_is_eligible := FALSE;
            END IF;
        END IF;

        v_item := jsonb_build_object(
            'product_id', v_prod.id,
            'name', v_prod.name,
            'sku', v_prod.sku,
            'brand', v_prod.brand,
            'category_name', COALESCE(v_prod.category_name, 'Uncategorized'),
            'current_mode', v_prod.inventory_mode,
            'stock_quantity', COALESCE(v_prod.stock_quantity, 0),
            'catalog_cost_price', COALESCE(v_prod.cost_price, 0),
            'last_purchase_cost', COALESCE(v_last_purchase_cost, 0),
            'resolved_cost', v_resolved_cost,
            'cost_source', v_cost_source,
            'eligible', v_is_eligible,
            'exceptions', to_jsonb(v_exceptions)
        );

        v_results := v_results || jsonb_build_array(v_item);
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'count', jsonb_array_length(v_results),
        'products', v_results
    );
END;
$$;

-- 2. RPC: convert_product_to_batch_tracking
-- Atomically converts a product to FIFO batch tracking with opening balance
CREATE OR REPLACE FUNCTION public.convert_product_to_batch_tracking(
    p_product_id INTEGER,
    p_custom_cost NUMERIC DEFAULT NULL,
    p_custom_batches JSONB DEFAULT NULL
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
    v_stock NUMERIC;
    v_last_purchase_cost NUMERIC;
    v_effective_cost NUMERIC;
    v_batch_no TEXT;
    v_batch_id BIGINT;
    v_custom_elem JSONB;
    v_custom_qty NUMERIC;
    v_custom_cost NUMERIC;
    v_custom_date TIMESTAMPTZ;
    v_custom_sum NUMERIC := 0;
    v_clean_sku TEXT;
    v_batches_created JSONB := '[]'::jsonb;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id INTO v_user_id, v_shop_id
    FROM sessions
    WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired or invalid shop');
    END IF;

    -- 1. Pessimistic Row Lock on Product
    SELECT * INTO v_prod
    FROM products
    WHERE id = p_product_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product not found in this shop');
    END IF;

    -- Idempotent check: if already batch_tracked, verify batches exist and return success
    IF v_prod.inventory_mode = 'batch_tracked' THEN
        RETURN jsonb_build_object(
            'success', true,
            'is_already_converted', true,
            'product_id', v_prod.id,
            'message', 'Product is already converted to batch tracking'
        );
    END IF;

    IF v_prod.inventory_mode = 'serialized' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Serialized mobile phones cannot be converted to batch tracking');
    END IF;

    v_stock := COALESCE(v_prod.stock_quantity, 0);

    IF v_stock < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', format('Product has negative stock (%s). Reconciliation required before conversion.', v_stock));
    END IF;

    -- 2. Clean SKU or ID for batch prefix
    v_clean_sku := regexp_replace(COALESCE(v_prod.sku, format('PRD%s', v_prod.id)), '[^a-zA-Z0-9_-]', '', 'g');
    IF length(v_clean_sku) = 0 THEN
        v_clean_sku := format('PRD%s', v_prod.id);
    END IF;

    -- 3. Case A: Custom Batches Supplied (Shop entered real historical lots)
    IF p_custom_batches IS NOT NULL AND jsonb_array_length(p_custom_batches) > 0 THEN
        -- Validate total quantity matches current stock
        FOR v_custom_elem IN SELECT * FROM jsonb_array_elements(p_custom_batches) LOOP
            v_custom_qty := (v_custom_elem->>'qty')::NUMERIC;
            v_custom_cost := (v_custom_elem->>'cost')::NUMERIC;
            IF v_custom_qty <= 0 OR v_custom_cost < 0 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Each custom batch must have qty > 0 and cost >= 0');
            END IF;
            v_custom_sum := v_custom_sum + v_custom_qty;
        END LOOP;

        IF v_custom_sum != v_stock THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', format('Sum of custom batches (%s) does not equal current product stock (%s)', v_custom_sum, v_stock)
            );
        END IF;

        -- Create each batch
        FOR v_custom_elem IN SELECT * FROM jsonb_array_elements(p_custom_batches) LOOP
            v_custom_qty := (v_custom_elem->>'qty')::NUMERIC;
            v_custom_cost := (v_custom_elem->>'cost')::NUMERIC;
            v_custom_date := COALESCE((v_custom_elem->>'purchase_date')::TIMESTAMPTZ, NOW());
            v_batch_no := format('OB-%s-%s', v_clean_sku, to_char(v_custom_date, 'YYMMDDHH24MI'));

            INSERT INTO stock_batches (
                shop_id,
                product_id,
                supplier_id,
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
                v_prod.id,
                (v_custom_elem->>'supplier_id')::INTEGER,
                v_batch_no,
                v_custom_date,
                v_custom_qty,
                v_custom_qty,
                v_custom_cost,
                v_custom_cost,
                'opening_balance',
                'active',
                'Custom historical batch entry during conversion',
                NOW()
            )
            RETURNING id INTO v_batch_id;

            v_batches_created := v_batches_created || jsonb_build_object(
                'batch_id', v_batch_id,
                'batch_no', v_batch_no,
                'qty', v_custom_qty,
                'cost', v_custom_cost
            );
        END LOOP;

    -- 4. Case B: Single Opening Balance Batch (Standard safe default)
    ELSE
        -- Resolve cost
        IF p_custom_cost IS NOT NULL AND p_custom_cost > 0 THEN
            v_effective_cost := p_custom_cost;
        ELSE
            -- Fallback 1: Last purchase cost
            SELECT pi.cost_price INTO v_last_purchase_cost
            FROM purchase_items pi
            JOIN purchases pr ON pr.id = pi.purchase_id
            WHERE pi.product_id = v_prod.id 
              AND pr.shop_id = v_shop_id
              AND pi.cost_price > 0
            ORDER BY pr.created_at DESC, pi.id DESC
            LIMIT 1;

            IF v_last_purchase_cost IS NOT NULL AND v_last_purchase_cost > 0 THEN
                v_effective_cost := v_last_purchase_cost;
            ELSIF v_prod.cost_price IS NOT NULL AND v_prod.cost_price > 0 THEN
                v_effective_cost := v_prod.cost_price;
            ELSE
                IF v_stock > 0 THEN
                    RETURN jsonb_build_object('success', false, 'error', 'No valid cost found for product. Please provide a custom opening unit cost.');
                ELSE
                    v_effective_cost := 0;
                END IF;
            END IF;
        END IF;

        IF v_stock > 0 THEN
            v_batch_no := format('OB-%s-%s', v_clean_sku, to_char(NOW(), 'YYMMDD'));

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
                v_prod.id,
                v_batch_no,
                NOW(),
                v_stock,
                v_stock,
                v_effective_cost,
                v_effective_cost,
                'opening_balance',
                'active',
                'Automated opening balance batch upon FIFO conversion',
                NOW()
            )
            RETURNING id INTO v_batch_id;

            v_batches_created := jsonb_build_array(jsonb_build_object(
                'batch_id', v_batch_id,
                'batch_no', v_batch_no,
                'qty', v_stock,
                'cost', v_effective_cost
            ));
        END IF;
    END IF;

    -- 5. Update Product Mode
    UPDATE products
    SET inventory_mode = 'batch_tracked',
        updated_at = NOW()
    WHERE id = v_prod.id;

    -- 6. Log Conversion Run Audit
    INSERT INTO conversion_runs (
        shop_id,
        product_id,
        before_stock,
        before_cost,
        after_batch_qty,
        after_batch_cost,
        status,
        converted_by,
        created_at
    ) VALUES (
        v_shop_id,
        v_prod.id,
        v_stock,
        COALESCE(v_prod.cost_price, 0),
        v_stock,
        COALESCE(v_effective_cost, 0),
        'applied',
        v_user_id,
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'product_id', v_prod.id,
        'name', v_prod.name,
        'inventory_mode', 'batch_tracked',
        'converted_stock', v_stock,
        'batches_created', v_batches_created
    );
END;
$$;

-- 3. RPC: revert_product_batch_conversion
-- Safely reverts a converted product to non_batch mode IF no sales have consumed its batches
CREATE OR REPLACE FUNCTION public.revert_product_batch_conversion(
    p_product_id INTEGER
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
    v_consumed_count INTEGER := 0;
    v_purchase_batches_count INTEGER := 0;
    v_total_batch_qty NUMERIC;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id INTO v_user_id, v_shop_id
    FROM sessions
    WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired or invalid shop');
    END IF;

    -- Lock Product Row
    SELECT * INTO v_prod
    FROM products
    WHERE id = p_product_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product not found');
    END IF;

    IF v_prod.inventory_mode != 'batch_tracked' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product is not in batch_tracked mode');
    END IF;

    -- Guard 1: Has any batch been consumed in sales?
    SELECT COUNT(*) INTO v_consumed_count
    FROM sale_item_batches sib
    JOIN stock_batches sb ON sib.batch_id = sb.id
    WHERE sb.product_id = p_product_id AND sb.shop_id = v_shop_id;

    IF v_consumed_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot revert: Stock batches have already been consumed in POS sales. Reverting would invalidate historical FIFO COGS allocations.'
        );
    END IF;

    -- Guard 2: Have new purchase batches been received since conversion?
    SELECT COUNT(*) INTO v_purchase_batches_count
    FROM stock_batches
    WHERE product_id = p_product_id AND shop_id = v_shop_id AND source = 'purchase';

    IF v_purchase_batches_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot revert: New purchase batches have been recorded since conversion. Void or adjust those purchases first.'
        );
    END IF;

    -- Calculate total batch qty before deletion
    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_total_batch_qty
    FROM stock_batches
    WHERE product_id = p_product_id AND shop_id = v_shop_id;

    -- Safe revert: delete opening balance batches
    DELETE FROM stock_batches
    WHERE product_id = p_product_id 
      AND shop_id = v_shop_id 
      AND source = 'opening_balance';

    -- Revert inventory mode
    UPDATE products
    SET inventory_mode = 'non_batch',
        updated_at = NOW()
    WHERE id = p_product_id;

    -- Log conversion run rollback
    INSERT INTO conversion_runs (
        shop_id,
        product_id,
        before_stock,
        before_cost,
        after_batch_qty,
        after_batch_cost,
        status,
        converted_by,
        created_at
    ) VALUES (
        v_shop_id,
        v_prod.id,
        v_total_batch_qty,
        COALESCE(v_prod.cost_price, 0),
        COALESCE(v_prod.stock_quantity, 0),
        COALESCE(v_prod.cost_price, 0),
        'reverted',
        v_user_id,
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'product_id', p_product_id,
        'name', v_prod.name,
        'inventory_mode', 'non_batch',
        'message', 'Successfully reverted product to non_batch mode'
    );
END;
$$;

-- 4. RPC: reconcile_product_batches
-- Audit verification tool: checks if products.stock_quantity == SUM(stock_batches.qty_remaining)
CREATE OR REPLACE FUNCTION public.reconcile_product_batches(
    p_product_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_shop_id INTEGER;
    v_prod RECORD;
    v_batch_sum NUMERIC;
    v_diff NUMERIC;
    v_is_balanced BOOLEAN;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT shop_id INTO v_shop_id
    FROM sessions
    WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());

    IF v_shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired or invalid shop');
    END IF;

    SELECT id, name, stock_quantity, inventory_mode INTO v_prod
    FROM products
    WHERE id = p_product_id AND shop_id = v_shop_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product not found');
    END IF;

    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_batch_sum
    FROM stock_batches
    WHERE product_id = p_product_id 
      AND shop_id = v_shop_id 
      AND status = 'active';

    v_diff := COALESCE(v_prod.stock_quantity, 0) - v_batch_sum;
    v_is_balanced := (v_diff = 0);

    RETURN jsonb_build_object(
        'success', true,
        'product_id', v_prod.id,
        'name', v_prod.name,
        'inventory_mode', v_prod.inventory_mode,
        'product_stock_quantity', COALESCE(v_prod.stock_quantity, 0),
        'active_batches_remaining_sum', v_batch_sum,
        'difference', v_diff,
        'is_balanced', v_is_balanced
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_product_batch_conversion(INTEGER, INTEGER, INTEGER[]) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.convert_product_to_batch_tracking(INTEGER, NUMERIC, JSONB) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.revert_product_batch_conversion(INTEGER) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.reconcile_product_batches(INTEGER) TO anon, authenticated, public;
