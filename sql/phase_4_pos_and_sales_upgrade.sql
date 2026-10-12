-- ============================================================
-- PHASE 4 MIGRATION: ATOMIC SALES RPC & IMEI-AWARE POS
-- ============================================================

-- 1. Extend sales and sale_items tables for IMEI snapshot and idempotency
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_whatsapp TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_type TEXT;

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS imei_snapshot JSONB;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price NUMERIC(15,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(15,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_name TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_idempotency ON sales(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_sale_items_phone_id ON sale_items(phone_id);

-- 2. ATOMIC SALE RPC: process_phone_sale
-- Row-level locking (FOR UPDATE) prevents race conditions and double-sales.
-- Atomically creates: sale master, sale lines with cost snapshot, updates inventory,
-- updates customer credit balance, records phone history, and writes audit logs.
CREATE OR REPLACE FUNCTION process_phone_sale(
    p_customer_id INTEGER,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_customer_whatsapp TEXT,
    p_branch_id INTEGER,
    p_items JSONB,
    p_total_amount NUMERIC,
    p_discount NUMERIC,
    p_net_amount NUMERIC,
    p_paid_amount NUMERIC,
    p_payment_method TEXT,
    p_payment_details JSONB,
    p_idempotency_key UUID DEFAULT NULL
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
    v_branch_id INTEGER;
    v_sale_id INTEGER;
    v_existing_sale RECORD;
    v_item JSONB;
    v_phone RECORD;
    v_product RECORD;
    v_item_cost NUMERIC;
    v_line_total NUMERIC;
    v_phone_id INTEGER;
    v_product_id INTEGER;
    v_qty INTEGER;
    v_unit_price NUMERIC;
    v_balance_increase NUMERIC;
    v_imei_snap JSONB;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id, branch_id
    INTO v_user_id, v_shop_id, v_branch_id
    FROM sessions
    WHERE token = v_token AND expires_at > NOW();

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired');
    END IF;

    -- Resolve branch
    IF p_branch_id IS NOT NULL THEN
        v_branch_id := p_branch_id;
    END IF;
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id FROM branches WHERE shop_id = v_shop_id AND is_main = true LIMIT 1;
    END IF;

    -- 1. Idempotency Check: Prevent duplicate charge/record replay
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, total_amount, net_amount, amount_paid INTO v_existing_sale
        FROM sales
        WHERE shop_id = v_shop_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'sale_id', v_existing_sale.id,
                'is_idempotent_replay', true,
                'message', 'Sale already processed previously'
            );
        END IF;
    END IF;

    -- Validate items list
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
    END IF;

    -- 2. Validate Customer if ID provided
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND shop_id = v_shop_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Selected customer not found');
        END IF;
    END IF;

    -- 3. Lock & Validate each phone item (CONCURRENCY LOCKING)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_phone_id := (v_item->>'phone_id')::INTEGER;
        v_product_id := (v_item->>'product_id')::INTEGER;

        IF v_phone_id IS NOT NULL THEN
            -- Lock the physical phone row with FOR UPDATE
            SELECT * INTO v_phone
            FROM phones
            WHERE id = v_phone_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', format('Phone ID #%s not found in inventory', v_phone_id));
            END IF;

            IF v_phone.status != 'in_stock' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', format('Phone %s %s (IMEI: %s) is unavailable! Status: %s', v_phone.brand, v_phone.model, v_phone.imei_1, v_phone.status)
                );
            END IF;
        ELSIF v_product_id IS NOT NULL THEN
            -- Lock general accessory/product row
            v_qty := COALESCE((v_item->>'quantity')::INTEGER, 1);
            SELECT * INTO v_product
            FROM products
            WHERE id = v_product_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', format('Product ID #%s not found in catalog', v_product_id));
            END IF;

            IF v_product.stock_quantity < v_qty THEN
                RETURN jsonb_build_object('success', false, 'error', format('Insufficient stock for %s. Available: %s, Requested: %s', v_product.name, v_product.stock_quantity, v_qty));
            END IF;
        END IF;
    END LOOP;

    -- 4. Create Sale Master Record
    INSERT INTO sales (
        shop_id,
        branch_id,
        user_id,
        customer_id,
        customer_name,
        total_amount,
        discount,
        net_amount,
        amount_paid,
        paid_amount,
        payment_method,
        payment_type,
        payment_details,
        idempotency_key,
        customer_phone,
        customer_whatsapp,
        status,
        created_at
    ) VALUES (
        v_shop_id,
        v_branch_id,
        v_user_id,
        p_customer_id,
        p_customer_name,
        p_total_amount,
        COALESCE(p_discount, 0),
        p_net_amount,
        p_paid_amount,
        p_paid_amount,
        p_payment_method,
        p_payment_method,
        p_payment_details,
        p_idempotency_key,
        p_customer_phone,
        p_customer_whatsapp,
        'completed',
        NOW()
    )
    RETURNING id INTO v_sale_id;

    -- 5. Create Sale Lines and Update Inventory
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_phone_id := (v_item->>'phone_id')::INTEGER;
        v_product_id := (v_item->>'product_id')::INTEGER;
        v_unit_price := (v_item->>'price')::NUMERIC;
        v_qty := COALESCE((v_item->>'quantity')::INTEGER, 1);
        v_line_total := v_unit_price * v_qty;

        IF v_phone_id IS NOT NULL THEN
            -- Fetch locked phone again
            SELECT * INTO v_phone FROM phones WHERE id = v_phone_id;
            v_item_cost := v_phone.cost_price + v_phone.additional_costs;

            v_imei_snap := jsonb_build_object(
                'imei_1', v_phone.imei_1,
                'imei_2', v_phone.imei_2,
                'brand', v_phone.brand,
                'model', v_phone.model,
                'storage', v_phone.storage,
                'color', v_phone.color,
                'condition', v_phone.condition,
                'pta_status', v_phone.pta_status
            );

            -- Create line item with historic IMEI and cost snapshot
            INSERT INTO sale_items (
                sale_id,
                phone_id,
                product_id,
                product_name,
                quantity,
                unit_price,
                price,
                line_total,
                subtotal,
                cost_price,
                imei_snapshot,
                created_at
            ) VALUES (
                v_sale_id,
                v_phone_id,
                v_phone.product_id,
                format('%s %s (%s %s)', v_phone.brand, v_phone.model, COALESCE(v_phone.storage, ''), COALESCE(v_phone.color, '')),
                1,
                v_unit_price,
                v_unit_price,
                v_line_total,
                v_line_total,
                v_item_cost,
                v_imei_snap,
                NOW()
            );

            -- Transition phone status to 'sold'
            UPDATE phones
            SET status = 'sold',
                updated_at = NOW()
            WHERE id = v_phone_id;

            -- Record Phone History
            INSERT INTO phone_history (
                phone_id,
                shop_id,
                action,
                from_status,
                to_status,
                reference_id,
                performed_by,
                details
            ) VALUES (
                v_phone_id,
                v_shop_id,
                'sold',
                'in_stock',
                'sold',
                v_sale_id::TEXT,
                v_user_id,
                jsonb_build_object(
                    'sale_id', v_sale_id,
                    'customer_id', p_customer_id,
                    'customer_name', p_customer_name,
                    'sale_price', v_unit_price,
                    'cost_price', v_item_cost
                )
            );

        ELSIF v_product_id IS NOT NULL THEN
            SELECT * INTO v_product FROM products WHERE id = v_product_id;
            v_item_cost := COALESCE(v_product.cost_price, 0);

            INSERT INTO sale_items (
                sale_id,
                product_id,
                product_name,
                quantity,
                unit_price,
                price,
                line_total,
                subtotal,
                cost_price,
                created_at
            ) VALUES (
                v_sale_id,
                v_product_id,
                COALESCE(v_product.name, 'Product Item'),
                v_qty,
                v_unit_price,
                v_unit_price,
                v_line_total,
                v_line_total,
                v_item_cost,
                NOW()
            );

            -- Deduct stock
            UPDATE products
            SET stock_quantity = stock_quantity - v_qty
            WHERE id = v_product_id;
        END IF;
    END LOOP;

    -- 6. Update Customer Ledger if partial payment / credit sale
    v_balance_increase := p_net_amount - p_paid_amount;
    IF p_customer_id IS NOT NULL AND v_balance_increase > 0 THEN
        UPDATE customers
        SET outstanding_balance = COALESCE(outstanding_balance, 0) + v_balance_increase,
            balance = COALESCE(balance, 0) + v_balance_increase
        WHERE id = p_customer_id;
    END IF;

    -- 7. Record payment movement if customer made cash/bank payment
    IF p_customer_id IS NOT NULL AND p_paid_amount > 0 THEN
        INSERT INTO customer_payments (
            shop_id,
            customer_id,
            user_id,
            amount,
            description,
            created_at
        ) VALUES (
            v_shop_id,
            p_customer_id,
            v_user_id,
            p_paid_amount,
            format('Payment for Invoice #INV-%s (%s)', v_sale_id, p_payment_method),
            NOW()
        );
    END IF;

    -- 8. Audit Log
    INSERT INTO audit_logs (
        action,
        entity,
        entity_id,
        user_id,
        shop_id,
        details
    ) VALUES (
        'SALE_COMPLETED',
        'sales',
        v_sale_id::TEXT,
        v_user_id,
        v_shop_id,
        jsonb_build_object(
            'net_amount', p_net_amount,
            'paid_amount', p_paid_amount,
            'payment_method', p_payment_method,
            'customer_id', p_customer_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'total_amount', p_total_amount,
        'net_amount', p_net_amount,
        'paid_amount', p_paid_amount,
        'balance', v_balance_increase
    );
END;
$$;

GRANT EXECUTE ON FUNCTION process_phone_sale(INTEGER, TEXT, TEXT, TEXT, INTEGER, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID) TO anon, authenticated, public;
