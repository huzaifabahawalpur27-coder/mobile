-- Migration: Fix Phone Re-purchase / Customer Buy-Back in record_phone_purchase RPC
-- Allows re-purchasing phones that were previously sold or returned without triggering uq_shop_imei_1 duplicate key error.

CREATE OR REPLACE FUNCTION record_phone_purchase(
    p_supplier_id INTEGER,
    p_branch_id INTEGER,
    p_phones JSONB,
    p_total_amount NUMERIC,
    p_paid_amount NUMERIC,
    p_payment_type TEXT,
    p_notes TEXT DEFAULT NULL
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
    v_purchase_id INTEGER;
    v_supplier RECORD;
    v_phone JSONB;
    v_phone_id INTEGER;
    v_clean_imei1 TEXT;
    v_clean_imei2 TEXT;
    v_existing_id INTEGER;
    v_existing_status TEXT;
    v_count INTEGER := 0;
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

    -- Override branch if specified
    IF p_branch_id IS NOT NULL THEN
        v_branch_id := p_branch_id;
    END IF;

    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id FROM branches WHERE shop_id = v_shop_id AND is_main = true LIMIT 1;
    END IF;

    -- Validate Supplier if provided
    IF p_supplier_id IS NOT NULL THEN
        SELECT * INTO v_supplier FROM suppliers WHERE id = p_supplier_id AND shop_id = v_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Supplier not found');
        END IF;
    END IF;

    -- Validate incoming phones payload
    IF p_phones IS NULL OR jsonb_array_length(p_phones) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'No phones provided in purchase cart');
    END IF;

    -- Create Purchase Master Record
    INSERT INTO purchases (
        shop_id,
        branch_id,
        user_id,
        supplier_id,
        total_amount,
        paid_amount,
        payment_method,
        remarks,
        created_at
    ) VALUES (
        v_shop_id,
        v_branch_id,
        v_user_id,
        p_supplier_id,
        p_total_amount,
        p_paid_amount,
        p_payment_type,
        p_notes,
        NOW()
    )
    RETURNING id INTO v_purchase_id;

    -- Ingest each physical phone atomically
    FOR v_phone IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
        v_clean_imei1 := TRIM(v_phone->>'imei_1');
        v_clean_imei2 := NULLIF(TRIM(COALESCE(v_phone->>'imei_2', '')), '');

        -- Check if phone already exists in this shop
        v_existing_id := NULL;
        v_existing_status := NULL;
        SELECT id, status INTO v_existing_id, v_existing_status
        FROM phones
        WHERE shop_id = v_shop_id AND imei_1 = v_clean_imei1
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
            IF v_existing_status = 'in_stock' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Phone with IMEI ' || v_clean_imei1 || ' is already in stock');
            ELSE
                -- Re-purchase / buy-back of previously sold or returned phone
                UPDATE phones SET
                    branch_id = v_branch_id,
                    brand = COALESCE(v_phone->>'brand', brand),
                    model = COALESCE(v_phone->>'model', model),
                    storage = COALESCE(v_phone->>'storage', storage),
                    color = COALESCE(v_phone->>'color', color),
                    condition = COALESCE(v_phone->>'condition', 'Used'),
                    pta_status = COALESCE(v_phone->>'pta_status', pta_status),
                    cost_price = COALESCE((v_phone->>'cost_price')::NUMERIC, cost_price),
                    additional_costs = COALESCE((v_phone->>'additional_costs')::NUMERIC, 0),
                    sale_price = COALESCE((v_phone->>'sale_price')::NUMERIC, sale_price),
                    supplier_id = p_supplier_id,
                    purchase_id = v_purchase_id,
                    purchase_date = CURRENT_DATE,
                    status = 'in_stock',
                    sold_at = NULL,
                    sale_id = NULL,
                    notes = v_phone->>'notes',
                    updated_at = NOW()
                WHERE id = v_existing_id
                RETURNING id INTO v_phone_id;
            END IF;
        ELSE
            -- New phone insertion
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
                supplier_id,
                purchase_id,
                purchase_date,
                status,
                notes
            ) VALUES (
                v_shop_id,
                v_branch_id,
                v_clean_imei1,
                v_clean_imei2,
                COALESCE(v_phone->>'brand', 'Unknown'),
                COALESCE(v_phone->>'model', 'Unknown Phone'),
                v_phone->>'storage',
                v_phone->>'color',
                COALESCE(v_phone->>'condition', 'Used'),
                COALESCE(v_phone->>'pta_status', 'PTA Approved'),
                COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
                COALESCE((v_phone->>'additional_costs')::NUMERIC, 0),
                COALESCE((v_phone->>'sale_price')::NUMERIC, 0),
                p_supplier_id,
                v_purchase_id,
                CURRENT_DATE,
                'in_stock',
                v_phone->>'notes'
            )
            RETURNING id INTO v_phone_id;
        END IF;

        -- Record Purchase Line Item
        INSERT INTO purchase_items (
            purchase_id,
            phone_id,
            quantity,
            unit_price,
            cost_price,
            total_price,
            subtotal
        ) VALUES (
            v_purchase_id,
            v_phone_id,
            1,
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0)
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'phones_count', v_count,
        'total_amount', p_total_amount,
        'paid_amount', p_paid_amount
    );
END;
$$;
