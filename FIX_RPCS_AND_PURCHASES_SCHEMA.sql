-- ============================================================================
-- EDGEX POS: DEFINITIVE FIX FOR PURCHASES, SALES & CUSTODY RPC FUNCTIONS
-- Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hekqzkrpxqsjfkosilpr/sql
-- ============================================================================

-- 1. Ensure required columns exist in tables
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2);
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;

-- 2. Relax phones check constraints so both lowercase and titlecase are allowed
DO $$ BEGIN
    ALTER TABLE phones DROP CONSTRAINT IF EXISTS phones_condition_check;
    ALTER TABLE phones ADD CONSTRAINT phones_condition_check 
        CHECK (condition IN ('brand_new', 'used', 'refurbished', 'open_box', 'faulty', 'New', 'Used', 'Refurbished'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE phones DROP CONSTRAINT IF EXISTS phones_pta_status_check;
    ALTER TABLE phones ADD CONSTRAINT phones_pta_status_check 
        CHECK (pta_status IN ('approved', 'non_pta', 'cpid', 'vip', 'blocked', 'PTA Approved', 'Non-PTA', 'JV', 'Custom'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ============================================================================
-- 3. ATOMIC PHONE PURCHASE RPC (Primary 7-param signature used by PhonePurchasePanel)
-- ============================================================================
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
    v_clean_condition TEXT;
    v_clean_pta TEXT;
    v_balance_increase NUMERIC;
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
        RETURN jsonb_build_object('success', false, 'error', 'Purchase cart cannot be empty');
    END IF;

    -- Create Purchase Master Record
    INSERT INTO purchases (
        shop_id,
        branch_id,
        user_id,
        supplier_id,
        total_amount,
        net_amount,
        paid_amount,
        amount_paid,
        payment_method,
        payment_type,
        remarks,
        created_at
    ) VALUES (
        v_shop_id,
        v_branch_id,
        v_user_id,
        p_supplier_id,
        p_total_amount,
        p_total_amount,
        p_paid_amount,
        p_paid_amount,
        COALESCE(p_payment_type, 'cash'),
        COALESCE(p_payment_type, 'cash'),
        p_notes,
        NOW()
    )
    RETURNING id INTO v_purchase_id;

    -- Ingest each physical phone atomically
    FOR v_phone IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
        v_clean_imei1 := TRIM(v_phone->>'imei_1');
        v_clean_imei2 := NULLIF(TRIM(COALESCE(v_phone->>'imei_2', '')), '');

        -- Normalize condition
        v_clean_condition := LOWER(TRIM(COALESCE(v_phone->>'condition', 'used')));
        IF v_clean_condition IN ('new', 'brand new', 'brand_new') THEN
            v_clean_condition := 'brand_new';
        ELSIF v_clean_condition NOT IN ('used', 'refurbished', 'open_box', 'faulty') THEN
            v_clean_condition := 'used';
        END IF;

        -- Normalize PTA status
        v_clean_pta := LOWER(TRIM(COALESCE(v_phone->>'pta_status', 'approved')));
        IF v_clean_pta LIKE '%non%' THEN
            v_clean_pta := 'non_pta';
        ELSIF v_clean_pta LIKE '%cpid%' OR v_clean_pta = 'jv' THEN
            v_clean_pta := 'cpid';
        ELSIF v_clean_pta LIKE '%vip%' THEN
            v_clean_pta := 'vip';
        ELSIF v_clean_pta LIKE '%block%' THEN
            v_clean_pta := 'blocked';
        ELSIF v_clean_pta NOT IN ('approved', 'non_pta', 'cpid', 'vip', 'blocked') THEN
            v_clean_pta := 'approved';
        END IF;

        IF EXISTS (SELECT 1 FROM phones WHERE shop_id = v_shop_id AND imei_1 = v_clean_imei1) THEN
            RAISE EXCEPTION 'IMEI 1 % already exists in your shop inventory', v_clean_imei1;
        END IF;

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
            sale_price,
            supplier_id,
            purchase_id,
            status,
            created_at,
            updated_at
        ) VALUES (
            v_shop_id,
            v_branch_id,
            v_clean_imei1,
            v_clean_imei2,
            COALESCE(v_phone->>'brand', 'Unknown'),
            COALESCE(v_phone->>'model', 'Unknown Phone'),
            v_phone->>'storage',
            v_phone->>'color',
            v_clean_condition,
            v_clean_pta,
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'sale_price')::NUMERIC, 0),
            p_supplier_id,
            v_purchase_id,
            'in_stock',
            NOW(),
            NOW()
        )
        RETURNING id INTO v_phone_id;

        -- Record in purchase_items
        INSERT INTO purchase_items (
            purchase_id,
            phone_id,
            quantity,
            cost_price,
            subtotal
        ) VALUES (
            v_purchase_id,
            v_phone_id,
            1,
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0)
        );

        -- Record in phone_history
        INSERT INTO phone_history (
            phone_id,
            shop_id,
            action,
            previous_status,
            new_status,
            actor_id,
            details
        ) VALUES (
            v_phone_id,
            v_shop_id,
            'PURCHASED',
            NULL,
            'in_stock',
            v_user_id,
            jsonb_build_object(
                'purchase_id', v_purchase_id,
                'supplier_id', p_supplier_id,
                'cost_price', v_phone->>'cost_price',
                'imei_1', v_clean_imei1
            )
        );

        v_count := v_count + 1;
    END LOOP;

    -- Update Supplier Balance
    v_balance_increase := p_total_amount - p_paid_amount;
    IF p_supplier_id IS NOT NULL AND v_balance_increase > 0 THEN
        UPDATE suppliers
        SET balance = COALESCE(balance, 0) + v_balance_increase
        WHERE id = p_supplier_id;
    END IF;

    -- Record Supplier Payment
    IF p_supplier_id IS NOT NULL AND p_paid_amount > 0 THEN
        INSERT INTO supplier_payments (
            shop_id,
            supplier_id,
            user_id,
            amount,
            description
        ) VALUES (
            v_shop_id,
            p_supplier_id,
            v_user_id,
            p_paid_amount,
            format('Payment for Phone Purchase PR-%s (%s)', v_purchase_id, COALESCE(p_payment_type, 'cash'))
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'phones_count', v_count,
        'phone_count', v_count,
        'total_amount', p_total_amount,
        'paid_amount', p_paid_amount
    );
END;
$$;


-- ============================================================================
-- 4. BACKWARD-COMPATIBLE OVERLOAD FOR record_phone_purchase (6-parameter version)
-- ============================================================================
CREATE OR REPLACE FUNCTION record_phone_purchase(
    p_supplier_id INTEGER,
    p_phones JSONB,
    p_total_amount NUMERIC,
    p_paid_amount NUMERIC,
    p_payment_method TEXT DEFAULT 'cash',
    p_remarks TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN record_phone_purchase(
        p_supplier_id := p_supplier_id,
        p_branch_id := NULL,
        p_phones := p_phones,
        p_total_amount := p_total_amount,
        p_paid_amount := p_paid_amount,
        p_payment_type := p_payment_method,
        p_notes := p_remarks
    );
END;
$$;


-- ============================================================================
-- 5. ATOMIC POS PHONE SALE RPC (Primary 13-param signature used by POS.jsx)
-- ============================================================================
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
    v_item_cost NUMERIC;
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

    IF p_branch_id IS NOT NULL THEN
        v_branch_id := p_branch_id;
    END IF;

    -- Idempotency Replay Protection
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, total_amount INTO v_existing_sale
        FROM sales
        WHERE shop_id = v_shop_id AND idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'sale_id', v_existing_sale.id,
                'replayed', true
            );
        END IF;
    END IF;

    -- Lock physical phone rows (FOR UPDATE)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_phone_id := (v_item->>'phone_id')::INTEGER;
        IF v_phone_id IS NOT NULL THEN
            SELECT * INTO v_phone
            FROM phones
            WHERE id = v_phone_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', format('Phone ID %s not found in stock', v_phone_id));
            END IF;

            IF v_phone.status != 'in_stock' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', format('Phone %s %s (IMEI: %s) is %s, cannot be sold', v_phone.brand, v_phone.model, v_phone.imei_1, v_phone.status)
                );
            END IF;
        END IF;
    END LOOP;

    -- Insert Sales Master Record
    INSERT INTO sales (
        shop_id, branch_id, user_id, customer_id, customer_name,
        customer_phone, customer_whatsapp, total_amount, discount,
        net_amount, paid_amount, payment_method, payment_details,
        idempotency_key, created_at
    ) VALUES (
        v_shop_id, v_branch_id, v_user_id, p_customer_id, p_customer_name,
        p_customer_phone, p_customer_whatsapp, p_total_amount, p_discount,
        p_net_amount, p_paid_amount, p_payment_method, p_payment_details,
        p_idempotency_key, NOW()
    )
    RETURNING id INTO v_sale_id;

    -- Process Each Line Item
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_phone_id := (v_item->>'phone_id')::INTEGER;
        v_product_id := (v_item->>'product_id')::INTEGER;
        v_unit_price := (v_item->>'price')::NUMERIC;
        v_qty := COALESCE((v_item->>'quantity')::INTEGER, 1);
        v_imei_snap := NULL;

        IF v_phone_id IS NOT NULL THEN
            SELECT * INTO v_phone FROM phones WHERE id = v_phone_id;
            v_item_cost := v_phone.cost_price;
            v_imei_snap := jsonb_build_object(
                'imei_1', v_phone.imei_1,
                'imei_2', v_phone.imei_2,
                'brand', v_phone.brand,
                'model', v_phone.model,
                'color', v_phone.color,
                'storage', v_phone.storage,
                'condition', v_phone.condition,
                'pta_status', v_phone.pta_status
            );

            UPDATE phones
            SET status = 'sold',
                sale_id = v_sale_id,
                updated_at = NOW()
            WHERE id = v_phone_id;

            INSERT INTO phone_history (
                phone_id, shop_id, action, previous_status, new_status, actor_id, details
            ) VALUES (
                v_phone_id, v_shop_id, 'SOLD', 'in_stock', 'sold', v_user_id,
                jsonb_build_object(
                    'sale_id', v_sale_id,
                    'customer_id', p_customer_id,
                    'customer_name', p_customer_name,
                    'sale_price', v_unit_price,
                    'cost_price', v_item_cost
                )
            );
        ELSE
            SELECT cost_price INTO v_item_cost FROM products WHERE id = v_product_id;
            UPDATE products
            SET stock_quantity = GREATEST(0, stock_quantity - v_qty)
            WHERE id = v_product_id;
        END IF;

        INSERT INTO sale_items (
            sale_id, phone_id, product_id, quantity, unit_price,
            total_price, cost_price, imei_snapshot
        ) VALUES (
            v_sale_id, v_phone_id, v_product_id, v_qty, v_unit_price,
            v_unit_price * v_qty, COALESCE(v_item_cost, 0), v_imei_snap
        );
    END LOOP;

    -- Update Customer Credit Balance if unpaid
    v_balance_increase := p_net_amount - p_paid_amount;
    IF p_customer_id IS NOT NULL AND v_balance_increase > 0 THEN
        UPDATE customers
        SET current_balance = COALESCE(current_balance, 0) + v_balance_increase
        WHERE id = p_customer_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'net_amount', p_net_amount,
        'paid_amount', p_paid_amount
    );
END;
$$;


-- ============================================================================
-- 6. BACKWARD-COMPATIBLE OVERLOAD FOR process_phone_sale (9-param version)
-- ============================================================================
CREATE OR REPLACE FUNCTION process_phone_sale(
    p_customer_id INTEGER,
    p_items JSONB,
    p_total_amount NUMERIC,
    p_discount NUMERIC,
    p_net_amount NUMERIC,
    p_paid_amount NUMERIC,
    p_payment_method TEXT DEFAULT 'cash',
    p_payment_details JSONB DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN process_phone_sale(
        p_customer_id := p_customer_id,
        p_customer_name := NULL,
        p_customer_phone := NULL,
        p_customer_whatsapp := NULL,
        p_branch_id := NULL,
        p_items := p_items,
        p_total_amount := p_total_amount,
        p_discount := p_discount,
        p_net_amount := p_net_amount,
        p_paid_amount := p_paid_amount,
        p_payment_method := p_payment_method,
        p_payment_details := p_payment_details,
        p_idempotency_key := p_idempotency_key
    );
END;
$$;


-- ============================================================================
-- 7. CUSTODY RPCS (Support both argument naming styles)
-- ============================================================================
CREATE OR REPLACE FUNCTION issue_phone_custody(
    p_phone_id INTEGER,
    p_issue_type TEXT,
    p_recipient_name TEXT,
    p_recipient_phone TEXT DEFAULT NULL,
    p_expected_return_date DATE DEFAULT NULL,
    p_deposit_amount NUMERIC DEFAULT 0,
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
    v_phone RECORD;
    v_custody_id INTEGER;
    v_target_status TEXT;
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

    SELECT * INTO v_phone
    FROM phones
    WHERE id = p_phone_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Phone not found in inventory');
    END IF;

    IF v_phone.status != 'in_stock' THEN
        RETURN jsonb_build_object('success', false, 'error', format('Phone is %s, cannot issue custody', v_phone.status));
    END IF;

    v_target_status := CASE
        WHEN p_issue_type = 'customer_reservation' THEN 'reserved'
        WHEN p_issue_type = 'personal_use' THEN 'personal'
        ELSE 'issued'
    END;

    INSERT INTO phone_custody (
        shop_id, branch_id, phone_id, issue_type,
        recipient_name, recipient_phone, token_deposit,
        expected_return_date, notes, status, issued_by
    ) VALUES (
        v_shop_id, v_branch_id, p_phone_id, p_issue_type,
        p_recipient_name, p_recipient_phone, COALESCE(p_deposit_amount, 0),
        p_expected_return_date, p_notes, 'active', v_user_id
    )
    RETURNING id INTO v_custody_id;

    UPDATE phones
    SET status = v_target_status, updated_at = NOW()
    WHERE id = p_phone_id;

    INSERT INTO phone_history (
        phone_id, shop_id, action, previous_status, new_status, actor_id, details
    ) VALUES (
        p_phone_id, v_shop_id, 'CUSTODY_ISSUED', 'in_stock', v_target_status, v_user_id,
        jsonb_build_object(
            'custody_id', v_custody_id,
            'issue_type', p_issue_type,
            'recipient_name', p_recipient_name
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'custody_id', v_custody_id,
        'new_status', v_target_status
    );
END;
$$;

-- Overload for issue_phone_custody with p_token_deposit & p_recipient_cnic
CREATE OR REPLACE FUNCTION issue_phone_custody(
    p_phone_id INTEGER,
    p_issue_type TEXT,
    p_recipient_name TEXT,
    p_recipient_phone TEXT DEFAULT NULL,
    p_recipient_cnic TEXT DEFAULT NULL,
    p_token_deposit NUMERIC DEFAULT 0,
    p_expected_return_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN issue_phone_custody(
        p_phone_id := p_phone_id,
        p_issue_type := p_issue_type,
        p_recipient_name := p_recipient_name,
        p_recipient_phone := p_recipient_phone,
        p_expected_return_date := p_expected_return_date,
        p_deposit_amount := p_token_deposit,
        p_notes := p_notes
    );
END;
$$;

-- return_phone_custody (By custody_id)
CREATE OR REPLACE FUNCTION return_phone_custody(
    p_custody_id INTEGER,
    p_return_notes TEXT DEFAULT NULL
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
    v_custody RECORD;
    v_prev_status TEXT;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id INTO v_user_id, v_shop_id
    FROM sessions
    WHERE token = v_token AND expires_at > NOW();

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired');
    END IF;

    SELECT * INTO v_custody
    FROM phone_custody
    WHERE id = p_custody_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Custody record not found');
    END IF;

    IF v_custody.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Custody record is not active');
    END IF;

    UPDATE phone_custody
    SET status = 'returned',
        returned_at = NOW(),
        returned_by = v_user_id,
        notes = COALESCE(notes || ' | Return: ' || p_return_notes, notes)
    WHERE id = p_custody_id;

    SELECT status INTO v_prev_status FROM phones WHERE id = v_custody.phone_id;

    UPDATE phones
    SET status = 'in_stock', updated_at = NOW()
    WHERE id = v_custody.phone_id;

    INSERT INTO phone_history (
        phone_id, shop_id, action, previous_status, new_status, actor_id, details
    ) VALUES (
        v_custody.phone_id, v_shop_id, 'CUSTODY_RETURNED', v_prev_status, 'in_stock', v_user_id,
        jsonb_build_object('custody_id', p_custody_id, 'return_notes', p_return_notes)
    );

    RETURN jsonb_build_object('success', true, 'phone_id', v_custody.phone_id);
END;
$$;

-- Overload for return_phone_custody (By phone_id)
CREATE OR REPLACE FUNCTION return_phone_custody(
    p_phone_id INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custody_id INTEGER;
BEGIN
    SELECT id INTO v_custody_id
    FROM phone_custody
    WHERE phone_id = p_phone_id AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_custody_id IS NOT NULL THEN
        RETURN return_phone_custody(p_custody_id := v_custody_id, p_return_notes := p_notes);
    END IF;

    UPDATE phones SET status = 'in_stock', updated_at = NOW() WHERE id = p_phone_id;
    RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id);
END;
$$;


-- ============================================================================
-- 8. GET SHOP CONFIG RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION get_shop_config(p_shop_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_shop RECORD;
    v_plan RECORD;
    v_features JSONB;
BEGIN
    SELECT * INTO v_shop FROM shops WHERE id = p_shop_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Shop not found');
    END IF;

    SELECT * INTO v_plan FROM plans WHERE id = v_shop.plan_id;
    IF NOT FOUND THEN
        v_features := jsonb_build_object(
            'multiple_branches', true,
            'barcode_scanning', true,
            'whatsapp_alerts', true,
            'excel_export', true,
            'daily_reports', true,
            'audit_trail', true,
            'role_permissions', true,
            'phone_inventory', true
        );
    ELSE
        v_features := COALESCE(v_plan.features, '{}'::jsonb);
    END IF;

    RETURN jsonb_build_object(
        'shop_id', v_shop.id,
        'shop_name', v_shop.name,
        'plan_name', COALESCE(v_plan.name, 'Enterprise'),
        'plan_tier', COALESCE(v_plan.tier, 'enterprise'),
        'max_products', COALESCE(v_plan.max_products, 999999),
        'max_branches', COALESCE(v_plan.max_branches, 99),
        'features', v_features,
        'is_active', v_shop.is_active,
        'status', v_shop.status
    );
END;
$$;


-- ============================================================================
-- 9. PERMISSIONS AND SCHEMA CACHE RELOAD
-- ============================================================================
GRANT EXECUTE ON FUNCTION record_phone_purchase(INTEGER, INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION record_phone_purchase(INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION process_phone_sale(INTEGER, TEXT, TEXT, TEXT, INTEGER, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION process_phone_sale(INTEGER, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, UUID) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION issue_phone_custody(INTEGER, TEXT, TEXT, TEXT, DATE, NUMERIC, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION issue_phone_custody(INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION return_phone_custody(INTEGER, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION get_shop_config(INTEGER) TO anon, authenticated, public;

-- Instruct PostgREST to reload its schema cache immediately
NOTIFY pgrst, 'reload schema';
