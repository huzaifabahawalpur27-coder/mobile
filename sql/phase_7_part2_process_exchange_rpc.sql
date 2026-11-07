-- Ensure phones table accepts flexible conditions and PTA statuses
ALTER TABLE public.phones DROP CONSTRAINT IF EXISTS phones_condition_check;
ALTER TABLE public.phones DROP CONSTRAINT IF EXISTS phones_pta_status_check;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS purchase_date DATE DEFAULT CURRENT_DATE;

-- Ensure optional columns exist on phones table
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS purchase_date DATE DEFAULT CURRENT_DATE;

CREATE OR REPLACE FUNCTION process_phone_exchange(
    p_customer_id INTEGER,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_branch_id INTEGER,
    p_incoming_phones JSONB,
    p_outgoing_items JSONB,
    p_sale_amount NUMERIC,
    p_trade_in_credit NUMERIC,
    p_settlement_amount NUMERIC,
    p_settlement_direction TEXT,
    p_payment_method TEXT,
    p_payment_details JSONB,
    p_account_id BIGINT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_branch_id INTEGER;
    v_exchange_id INTEGER;
    v_exchange_no TEXT;
    v_purchase_id INTEGER;
    v_sale_id INTEGER;
    v_existing_exchange RECORD;
    v_item JSONB;
    v_phone RECORD;
    v_product RECORD;
    v_phone_id INTEGER;
    v_product_id INTEGER;
    v_qty INTEGER;
    v_unit_price NUMERIC;
    v_line_total NUMERIC;
    v_item_cost NUMERIC;
    v_imei_snap JSONB;
    v_clean_imei1 TEXT;
    v_clean_imei2 TEXT;
    v_clean_condition TEXT;
    v_clean_pta TEXT;
    v_existing_id INTEGER;
    v_existing_status TEXT;
    v_calc_diff NUMERIC;
    v_expected_dir TEXT;
    v_abs_settlement NUMERIC;
    v_acc_bal_before NUMERIC;
    v_acc_bal_after NUMERIC;
    v_split_item JSONB;
    v_split_acc_id BIGINT;
    v_split_amt NUMERIC;
    v_split_method TEXT;
    v_seq_id INTEGER;
    v_incoming_phone_ids INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
    -- Authenticate caller via session
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id, branch_id
    INTO v_user_id, v_shop_id, v_branch_id
    FROM sessions
    WHERE token = v_token AND (expires_at IS NULL OR expires_at > NOW());

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired');
    END IF;

    -- Resolve branch
    IF p_branch_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM branches WHERE id = p_branch_id AND shop_id = v_shop_id) THEN
            v_branch_id := p_branch_id;
        END IF;
    END IF;
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id FROM branches WHERE shop_id = v_shop_id AND is_main = true LIMIT 1;
    END IF;

    -- 1. Idempotency Check: prevent duplicate submission
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, exchange_number, sale_id, purchase_id, settlement_amount, settlement_direction, status
        INTO v_existing_exchange
        FROM exchanges
        WHERE shop_id = v_shop_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'exchange_id', v_existing_exchange.id,
                'exchange_number', v_existing_exchange.exchange_number,
                'sale_id', v_existing_exchange.sale_id,
                'purchase_id', v_existing_exchange.purchase_id,
                'settlement_amount', v_existing_exchange.settlement_amount,
                'settlement_direction', v_existing_exchange.settlement_direction,
                'is_idempotent_replay', true,
                'message', 'Exchange already processed previously'
            );
        END IF;
    END IF;

    -- 2. Validate Cart and Items
    IF (p_incoming_phones IS NULL OR jsonb_array_length(p_incoming_phones) = 0) AND
       (p_outgoing_items IS NULL OR jsonb_array_length(p_outgoing_items) = 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Exchange must include trade-in device(s) or outgoing item(s)');
    END IF;

    -- Validate Customer if provided
    IF p_customer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND shop_id = v_shop_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Selected customer not found in shop');
        END IF;
    END IF;

    -- 3. Validate Settlement Math & Direction
    v_calc_diff := ROUND(COALESCE(p_sale_amount, 0) - COALESCE(p_trade_in_credit, 0), 2);
    IF v_calc_diff > 0 THEN
        v_expected_dir := 'customer_paid';
        v_abs_settlement := v_calc_diff;
    ELSIF v_calc_diff < 0 THEN
        v_expected_dir := 'shop_payout';
        v_abs_settlement := ABS(v_calc_diff);
    ELSE
        v_expected_dir := 'even';
        v_abs_settlement := 0;
    END IF;

    IF p_settlement_direction != v_expected_dir THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Settlement direction mismatch: calculated %s (diff: %s), received %s', v_expected_dir, v_calc_diff, p_settlement_direction)
        );
    END IF;

    -- 4. Concurrency Locking & Validation on Outgoing Items
    IF p_outgoing_items IS NOT NULL AND jsonb_array_length(p_outgoing_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_outgoing_items) LOOP
            v_phone_id := (v_item->>'phone_id')::INTEGER;
            v_product_id := (v_item->>'product_id')::INTEGER;

            IF v_phone_id IS NOT NULL THEN
                -- Lock outgoing phone row
                SELECT * INTO v_phone
                FROM phones
                WHERE id = v_phone_id AND shop_id = v_shop_id
                FOR UPDATE;

                IF NOT FOUND THEN
                    RETURN jsonb_build_object('success', false, 'error', format('Outgoing phone ID #%s not found in inventory', v_phone_id));
                END IF;

                IF v_phone.status != 'in_stock' THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', format('Outgoing phone %s %s (IMEI: %s) is not available! Current status: %s', v_phone.brand, v_phone.model, v_phone.imei_1, v_phone.status)
                    );
                END IF;
            ELSIF v_product_id IS NOT NULL THEN
                v_qty := COALESCE((v_item->>'quantity')::INTEGER, 1);
                SELECT * INTO v_product
                FROM products
                WHERE id = v_product_id AND shop_id = v_shop_id
                FOR UPDATE;

                IF NOT FOUND THEN
                    RETURN jsonb_build_object('success', false, 'error', format('Outgoing product ID #%s not found in catalog', v_product_id));
                END IF;

                IF v_product.stock_quantity < v_qty THEN
                    RETURN jsonb_build_object('success', false, 'error', format('Insufficient stock for %s. Available: %s, Requested: %s', v_product.name, v_product.stock_quantity, v_qty));
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 5. Validate Incoming Trade-In Phones (IMEI Normalization & Cross-uniqueness)
    IF p_incoming_phones IS NOT NULL AND jsonb_array_length(p_incoming_phones) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_incoming_phones) LOOP
            v_clean_imei1 := TRIM(COALESCE(v_item->>'imei_1', ''));
            v_clean_imei2 := NULLIF(TRIM(COALESCE(v_item->>'imei_2', '')), '');

            IF LENGTH(v_clean_imei1) < 4 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Invalid IMEI 1 provided for trade-in phone');
            END IF;

            -- Check if IMEI 1 already in stock in this shop
            SELECT id, status INTO v_existing_id, v_existing_status
            FROM phones
            WHERE shop_id = v_shop_id AND (imei_1 = v_clean_imei1 OR imei_2 = v_clean_imei1)
            LIMIT 1;

            IF v_existing_id IS NOT NULL AND v_existing_status = 'in_stock' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', format('Trade-in phone IMEI %s is already in stock in this shop (Phone ID #%s)', v_clean_imei1, v_existing_id)
                );
            END IF;

            -- Check IMEI 2 if provided
            IF v_clean_imei2 IS NOT NULL THEN
                SELECT id, status INTO v_existing_id, v_existing_status
                FROM phones
                WHERE shop_id = v_shop_id AND (imei_1 = v_clean_imei2 OR imei_2 = v_clean_imei2)
                LIMIT 1;

                IF v_existing_id IS NOT NULL AND v_existing_status = 'in_stock' THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'error', format('Trade-in phone secondary IMEI %s is already in stock in this shop', v_clean_imei2)
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 6. Generate Exchange Sequential Number
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_seq_id FROM exchanges;
    v_exchange_no := 'EXC-' || LPAD(v_seq_id::TEXT, 5, '0');

    -- 7. Create Purchase Master Record for Incoming Trade-In Devices
    IF p_incoming_phones IS NOT NULL AND jsonb_array_length(p_incoming_phones) > 0 THEN
        INSERT INTO purchases (
            shop_id,
            branch_id,
            user_id,
            supplier_id,
            customer_id,
            is_trade_in,
            total_amount,
            paid_amount,
            payment_method,
            remarks,
            created_at
        ) VALUES (
            v_shop_id,
            v_branch_id,
            v_user_id,
            NULL,
            p_customer_id,
            true,
            p_trade_in_credit,
            p_trade_in_credit,
            'trade_in',
            format('Customer Trade-in for Exchange %s', v_exchange_no),
            NOW()
        )
        RETURNING id INTO v_purchase_id;

        -- Ingest incoming phones into inventory
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_incoming_phones) LOOP
            v_clean_imei1 := TRIM(v_item->>'imei_1');
            v_clean_imei2 := NULLIF(TRIM(COALESCE(v_item->>'imei_2', '')), '');
            v_unit_price := COALESCE((v_item->>'assessed_value')::NUMERIC, 0);

            -- Normalize condition & PTA status to satisfy legacy check constraints
            v_clean_condition := CASE
                WHEN LOWER(COALESCE(v_item->>'condition', '')) LIKE '%new%' AND LOWER(COALESCE(v_item->>'condition', '')) NOT LIKE '%used%' THEN 'New'
                WHEN LOWER(COALESCE(v_item->>'condition', '')) LIKE '%refurb%' THEN 'Refurbished'
                ELSE 'Used'
            END;

            v_clean_pta := CASE
                WHEN LOWER(COALESCE(v_item->>'pta_status', '')) LIKE '%non%' THEN 'Non-PTA'
                WHEN LOWER(COALESCE(v_item->>'pta_status', '')) LIKE '%jv%' THEN 'JV'
                WHEN LOWER(COALESCE(v_item->>'pta_status', '')) LIKE '%patch%' OR LOWER(COALESCE(v_item->>'pta_status', '')) LIKE '%custom%' THEN 'Custom'
                ELSE 'PTA Approved'
            END;

            -- Check if buy-back of previously sold/returned phone
            v_existing_id := NULL;
            v_existing_status := NULL;
            SELECT id, status INTO v_existing_id, v_existing_status
            FROM phones
            WHERE shop_id = v_shop_id AND (imei_1 = v_clean_imei1 OR imei_2 = v_clean_imei1)
            LIMIT 1;

            IF v_existing_id IS NOT NULL THEN
                -- Re-activate existing record
                UPDATE phones SET
                    branch_id = v_branch_id,
                    brand = COALESCE(v_item->>'brand', brand),
                    model = COALESCE(v_item->>'model', model),
                    storage = COALESCE(v_item->>'storage', storage),
                    color = COALESCE(v_item->>'color', color),
                    condition = v_clean_condition,
                    pta_status = v_clean_pta,
                    cost_price = v_unit_price,
                    additional_costs = 0,
                    sale_price = v_unit_price,
                    purchase_id = v_purchase_id,
                    status = 'in_stock',
                    sold_at = NULL,
                    sale_id = NULL,
                    notes = v_item->>'notes',
                    updated_at = NOW()
                WHERE id = v_existing_id
                RETURNING id INTO v_phone_id;
            ELSE
                -- Insert fresh phone record
                INSERT INTO phones (
                    shop_id,
                    branch_id,
                    imei_1,
                    imei_2,
                    brand,
                    model,
                    storage,
                    color,
                    condition,
                    pta_status,
                    cost_price,
                    additional_costs,
                    sale_price,
                    purchase_id,
                    status,
                    notes,
                    created_at,
                    updated_at
                ) VALUES (
                    v_shop_id,
                    v_branch_id,
                    v_clean_imei1,
                    v_clean_imei2,
                    COALESCE(v_item->>'brand', 'Generic'),
                    COALESCE(v_item->>'model', 'Phone'),
                    v_item->>'storage',
                    v_item->>'color',
                    v_clean_condition,
                    v_clean_pta,
                    v_unit_price,
                    0,
                    v_unit_price,
                    v_purchase_id,
                    'in_stock',
                    v_item->>'notes',
                    NOW(),
                    NOW()
                )
                RETURNING id INTO v_phone_id;
            END IF;

            v_incoming_phone_ids := array_append(v_incoming_phone_ids, v_phone_id);

            -- Phone history
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
                'traded_in',
                COALESCE(v_existing_status, 'none'),
                'in_stock',
                v_purchase_id::TEXT,
                v_user_id,
                jsonb_build_object(
                    'exchange_number', v_exchange_no,
                    'customer_id', p_customer_id,
                    'customer_name', p_customer_name,
                    'assessed_value', v_unit_price,
                    'condition', v_item->>'condition'
                )
            );

            -- Purchase Line Item
            INSERT INTO purchase_items (
                purchase_id,
                phone_id,
                product_name,
                cost_price,
                unit_cost,
                unit_price,
                quantity,
                subtotal,
                line_total,
                total_price,
                total_cost
            ) VALUES (
                v_purchase_id,
                v_phone_id,
                format('%s %s', COALESCE(v_item->>'brand', ''), COALESCE(v_item->>'model', 'Phone')),
                v_unit_price,
                v_unit_price,
                v_unit_price,
                1,
                v_unit_price,
                v_unit_price,
                v_unit_price,
                v_unit_price
            );
        END LOOP;
    END IF;

    -- 8. Create Sales Master Record for Outgoing Items
    IF p_outgoing_items IS NOT NULL AND jsonb_array_length(p_outgoing_items) > 0 THEN
        INSERT INTO sales (
            shop_id,
            branch_id,
            user_id,
            customer_id,
            customer_name,
            customer_phone,
            total_amount,
            discount,
            net_amount,
            paid_amount,
            amount_paid,
            payment_method,
            payment_type,
            payment_details,
            trade_in_amount,
            status,
            idempotency_key,
            created_at
        ) VALUES (
            v_shop_id,
            v_branch_id,
            v_user_id,
            p_customer_id,
            p_customer_name,
            p_customer_phone,
            p_sale_amount,
            0,
            p_sale_amount,
            p_sale_amount,
            p_sale_amount,
            p_payment_method,
            p_payment_method,
            p_payment_details,
            p_trade_in_credit,
            'completed',
            p_idempotency_key,
            NOW()
        )
        RETURNING id INTO v_sale_id;

        -- Record Sale Items & mark outgoing items sold/deducted
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_outgoing_items) LOOP
            v_phone_id := (v_item->>'phone_id')::INTEGER;
            v_product_id := (v_item->>'product_id')::INTEGER;
            v_unit_price := (v_item->>'price')::NUMERIC;
            v_qty := COALESCE((v_item->>'quantity')::INTEGER, 1);
            v_line_total := v_unit_price * v_qty;

            IF v_phone_id IS NOT NULL THEN
                SELECT * INTO v_phone FROM phones WHERE id = v_phone_id;
                v_item_cost := COALESCE(v_phone.cost_price, 0) + COALESCE(v_phone.additional_costs, 0);

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
                    NULL,
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

                UPDATE phones
                SET status = 'sold',
                    sale_id = v_sale_id,
                    sold_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_phone_id;

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
                        'exchange_number', v_exchange_no,
                        'sale_id', v_sale_id,
                        'sale_price', v_unit_price,
                        'customer_id', p_customer_id,
                        'customer_name', p_customer_name
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
                    COALESCE(v_item->>'product_name', v_product.name),
                    v_qty,
                    v_unit_price,
                    v_unit_price,
                    v_line_total,
                    v_line_total,
                    v_item_cost,
                    NOW()
                );

                UPDATE products
                SET stock_quantity = stock_quantity - v_qty,
                    updated_at = NOW()
                WHERE id = v_product_id;
            END IF;
        END LOOP;
    END IF;

    -- 9. Insert Exchange Master Record
    INSERT INTO exchanges (
        exchange_number,
        shop_id,
        branch_id,
        customer_id,
        customer_name,
        customer_phone,
        user_id,
        sale_id,
        purchase_id,
        sale_amount,
        trade_in_credit,
        settlement_amount,
        settlement_direction,
        settlement_payment_method,
        settlement_payment_details,
        settlement_account_id,
        settlement_paid_amount,
        status,
        notes,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_exchange_no,
        v_shop_id,
        v_branch_id,
        p_customer_id,
        p_customer_name,
        p_customer_phone,
        v_user_id,
        v_sale_id,
        v_purchase_id,
        COALESCE(p_sale_amount, 0),
        COALESCE(p_trade_in_credit, 0),
        v_abs_settlement,
        v_expected_dir,
        p_payment_method,
        p_payment_details,
        p_account_id,
        v_abs_settlement,
        'completed',
        p_notes,
        p_idempotency_key,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_exchange_id;

    -- Link exchange ID back to sale, purchase, and incoming phones
    IF v_sale_id IS NOT NULL THEN
        UPDATE sales SET exchange_id = v_exchange_id WHERE id = v_sale_id;
    END IF;
    IF v_purchase_id IS NOT NULL THEN
        UPDATE purchases SET exchange_id = v_exchange_id WHERE id = v_purchase_id;
    END IF;
    IF array_length(v_incoming_phone_ids, 1) > 0 THEN
        UPDATE phones SET exchange_id = v_exchange_id WHERE id = ANY(v_incoming_phone_ids);
    END IF;

    -- 10. Record Exchange Line Snapshots (exchange_items)
    -- A. Incoming Trade-In Snapshots
    IF p_incoming_phones IS NOT NULL AND jsonb_array_length(p_incoming_phones) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_incoming_phones) LOOP
            v_clean_imei1 := TRIM(v_item->>'imei_1');
            v_unit_price := COALESCE((v_item->>'assessed_value')::NUMERIC, 0);

            -- find phone_id matching this IMEI
            SELECT id INTO v_phone_id FROM phones WHERE shop_id = v_shop_id AND imei_1 = v_clean_imei1 ORDER BY id DESC LIMIT 1;

            INSERT INTO exchange_items (
                exchange_id,
                shop_id,
                item_direction,
                phone_id,
                product_name,
                imei_1,
                imei_2,
                brand,
                model,
                storage,
                color,
                condition,
                pta_status,
                assessed_value,
                cost_price,
                quantity,
                subtotal,
                notes,
                inspection_details,
                created_at
            ) VALUES (
                v_exchange_id,
                v_shop_id,
                'incoming_trade_in',
                v_phone_id,
                format('%s %s', COALESCE(v_item->>'brand', ''), COALESCE(v_item->>'model', 'Trade-in Phone')),
                v_clean_imei1,
                v_item->>'imei_2',
                v_item->>'brand',
                v_item->>'model',
                v_item->>'storage',
                v_item->>'color',
                v_item->>'condition',
                v_item->>'pta_status',
                v_unit_price,
                v_unit_price,
                1,
                v_unit_price,
                v_item->>'notes',
                v_item->'inspection_details',
                NOW()
            );
        END LOOP;
    END IF;

    -- B. Outgoing Sale Snapshots
    IF p_outgoing_items IS NOT NULL AND jsonb_array_length(p_outgoing_items) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_outgoing_items) LOOP
            v_phone_id := (v_item->>'phone_id')::INTEGER;
            v_product_id := (v_item->>'product_id')::INTEGER;
            v_unit_price := (v_item->>'price')::NUMERIC;
            v_qty := COALESCE((v_item->>'quantity')::INTEGER, 1);
            v_line_total := v_unit_price * v_qty;

            IF v_phone_id IS NOT NULL THEN
                SELECT * INTO v_phone FROM phones WHERE id = v_phone_id;
                INSERT INTO exchange_items (
                    exchange_id,
                    shop_id,
                    item_direction,
                    phone_id,
                    product_name,
                    imei_1,
                    imei_2,
                    brand,
                    model,
                    storage,
                    color,
                    condition,
                    pta_status,
                    assessed_value,
                    cost_price,
                    quantity,
                    subtotal,
                    created_at
                ) VALUES (
                    v_exchange_id,
                    v_shop_id,
                    'outgoing_sale',
                    v_phone_id,
                    format('%s %s', v_phone.brand, v_phone.model),
                    v_phone.imei_1,
                    v_phone.imei_2,
                    v_phone.brand,
                    v_phone.model,
                    v_phone.storage,
                    v_phone.color,
                    v_phone.condition,
                    v_phone.pta_status,
                    v_unit_price,
                    v_phone.cost_price,
                    1,
                    v_line_total,
                    NOW()
                );
            ELSIF v_product_id IS NOT NULL THEN
                SELECT * INTO v_product FROM products WHERE id = v_product_id;
                INSERT INTO exchange_items (
                    exchange_id,
                    shop_id,
                    item_direction,
                    product_id,
                    product_name,
                    quantity,
                    assessed_value,
                    cost_price,
                    subtotal,
                    created_at
                ) VALUES (
                    v_exchange_id,
                    v_shop_id,
                    'outgoing_sale',
                    v_product_id,
                    COALESCE(v_item->>'product_name', v_product.name),
                    v_qty,
                    v_unit_price,
                    COALESCE(v_product.cost_price, 0),
                    v_line_total,
                    NOW()
                );
            END IF;
        END LOOP;
    END IF;

    -- 11. Net Financial Settlement Accounting (CRITICAL: NET ONLY)
    IF v_expected_dir = 'customer_paid' AND v_abs_settlement > 0 THEN
        -- Customer pays the store
        IF p_payment_method = 'split' AND p_payment_details IS NOT NULL AND jsonb_array_length(p_payment_details) > 0 THEN
            FOR v_split_item IN SELECT * FROM jsonb_array_elements(p_payment_details) LOOP
                v_split_amt := (v_split_item->>'amount')::NUMERIC;
                v_split_acc_id := (v_split_item->>'account_id')::BIGINT;
                v_split_method := v_split_item->>'method';

                IF v_split_amt > 0 AND v_split_acc_id IS NOT NULL THEN
                    SELECT current_balance INTO v_acc_bal_before
                    FROM bank_accounts
                    WHERE id = v_split_acc_id AND shop_id = v_shop_id
                    FOR UPDATE;

                    IF FOUND THEN
                        v_acc_bal_after := v_acc_bal_before + v_split_amt;
                        UPDATE bank_accounts
                        SET current_balance = v_acc_bal_after, updated_at = NOW()
                        WHERE id = v_split_acc_id;

                        INSERT INTO bank_account_transactions (
                            shop_id,
                            account_id,
                            transaction_type,
                            amount,
                            balance_before,
                            balance_after,
                            reference_type,
                            reference_id,
                            description,
                            created_at
                        ) VALUES (
                            v_shop_id,
                            v_split_acc_id,
                            'CREDIT',
                            v_split_amt,
                            v_acc_bal_before,
                            v_acc_bal_after,
                            'EXCHANGE_SETTLEMENT',
                            v_exchange_no,
                            format('Exchange %s settlement (%s)', v_exchange_no, v_split_method),
                            NOW()
                        );
                    END IF;
                END IF;
            END LOOP;
        ELSIF p_account_id IS NOT NULL THEN
            SELECT current_balance INTO v_acc_bal_before
            FROM bank_accounts
            WHERE id = p_account_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF FOUND THEN
                v_acc_bal_after := v_acc_bal_before + v_abs_settlement;
                UPDATE bank_accounts
                SET current_balance = v_acc_bal_after, updated_at = NOW()
                WHERE id = p_account_id;

                INSERT INTO bank_account_transactions (
                    shop_id,
                    account_id,
                    transaction_type,
                    amount,
                    balance_before,
                    balance_after,
                    reference_type,
                    reference_id,
                    description,
                    created_at
                ) VALUES (
                    v_shop_id,
                    p_account_id,
                    'CREDIT',
                    v_abs_settlement,
                    v_acc_bal_before,
                    v_acc_bal_after,
                    'EXCHANGE_SETTLEMENT',
                    v_exchange_no,
                    format('Exchange %s customer payment', v_exchange_no),
                    NOW()
                );
            END IF;
        END IF;

    ELSIF v_expected_dir = 'shop_payout' AND v_abs_settlement > 0 THEN
        -- Store pays customer cash/bank payout
        IF p_account_id IS NOT NULL THEN
            SELECT current_balance INTO v_acc_bal_before
            FROM bank_accounts
            WHERE id = p_account_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF FOUND THEN
                v_acc_bal_after := v_acc_bal_before - v_abs_settlement;
                UPDATE bank_accounts
                SET current_balance = v_acc_bal_after, updated_at = NOW()
                WHERE id = p_account_id;

                INSERT INTO bank_account_transactions (
                    shop_id,
                    account_id,
                    transaction_type,
                    amount,
                    balance_before,
                    balance_after,
                    reference_type,
                    reference_id,
                    description,
                    created_at
                ) VALUES (
                    v_shop_id,
                    p_account_id,
                    'DEBIT',
                    v_abs_settlement,
                    v_acc_bal_before,
                    v_acc_bal_after,
                    'EXCHANGE_PAYOUT',
                    v_exchange_no,
                    format('Exchange %s trade-in cash payout to customer', v_exchange_no),
                    NOW()
                );
            END IF;
        END IF;
    END IF;

    -- Return success payload
    RETURN jsonb_build_object(
        'success', true,
        'exchange_id', v_exchange_id,
        'exchange_number', v_exchange_no,
        'sale_id', v_sale_id,
        'purchase_id', v_purchase_id,
        'sale_amount', p_sale_amount,
        'trade_in_credit', p_trade_in_credit,
        'settlement_amount', v_abs_settlement,
        'settlement_direction', v_expected_dir,
        'message', 'Phone exchange processed successfully'
    );
END;
$func$;

GRANT EXECUTE ON FUNCTION process_phone_exchange TO anon, authenticated;
