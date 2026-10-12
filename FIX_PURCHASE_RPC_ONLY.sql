-- ============================================================================
-- EDGEX POS: DIRECT FIX FOR record_phone_purchase RPC
-- Run this entire script in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hekqzkrpxqsjfkosilpr/sql
-- ============================================================================

-- 1. Ensure required columns exist on purchases table
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2);
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL;

-- 2. Relax phones check constraints so both lowercase and titlecase are allowed
DO $$ 
BEGIN
    ALTER TABLE phones DROP CONSTRAINT IF EXISTS phones_condition_check;
    ALTER TABLE phones ADD CONSTRAINT phones_condition_check 
        CHECK (condition IN ('brand_new', 'used', 'refurbished', 'open_box', 'faulty', 'New', 'Used', 'Refurbished'));
EXCEPTION WHEN OTHERS THEN 
    NULL;
END $$;

DO $$ 
BEGIN
    ALTER TABLE phones DROP CONSTRAINT IF EXISTS phones_pta_status_check;
    ALTER TABLE phones ADD CONSTRAINT phones_pta_status_check 
        CHECK (pta_status IN ('approved', 'non_pta', 'cpid', 'vip', 'blocked', 'PTA Approved', 'Non-PTA', 'JV', 'Custom'));
EXCEPTION WHEN OTHERS THEN 
    NULL;
END $$;

-- 3. Atomic phone purchase RPC function (7-parameter primary version)
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

    IF p_branch_id IS NOT NULL THEN
        v_branch_id := p_branch_id;
    END IF;

    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id FROM branches WHERE shop_id = v_shop_id AND is_main = true LIMIT 1;
    END IF;

    IF p_supplier_id IS NOT NULL THEN
        SELECT * INTO v_supplier FROM suppliers WHERE id = p_supplier_id AND shop_id = v_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Supplier not found');
        END IF;
    END IF;

    IF p_phones IS NULL OR jsonb_array_length(p_phones) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Purchase cart cannot be empty');
    END IF;

    INSERT INTO purchases (
        shop_id, branch_id, user_id, supplier_id,
        total_amount, net_amount, paid_amount, amount_paid,
        payment_method, payment_type, remarks, created_at
    ) VALUES (
        v_shop_id, v_branch_id, v_user_id, p_supplier_id,
        p_total_amount, p_total_amount, p_paid_amount, p_paid_amount,
        COALESCE(p_payment_type, 'cash'), COALESCE(p_payment_type, 'cash'), p_notes, NOW()
    )
    RETURNING id INTO v_purchase_id;

    FOR v_phone IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
        v_clean_imei1 := TRIM(v_phone->>'imei_1');
        v_clean_imei2 := NULLIF(TRIM(COALESCE(v_phone->>'imei_2', '')), '');

        v_clean_condition := LOWER(TRIM(COALESCE(v_phone->>'condition', 'used')));
        IF v_clean_condition IN ('new', 'brand new', 'brand_new') THEN
            v_clean_condition := 'brand_new';
        ELSIF v_clean_condition NOT IN ('used', 'refurbished', 'open_box', 'faulty') THEN
            v_clean_condition := 'used';
        END IF;

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
            shop_id, branch_id, imei_1, imei_2, brand, model,
            storage, color, condition, pta_status,
            cost_price, sale_price, supplier_id, purchase_id,
            status, created_at, updated_at
        ) VALUES (
            v_shop_id, v_branch_id, v_clean_imei1, v_clean_imei2,
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

        INSERT INTO purchase_items (
            purchase_id, phone_id, quantity, cost_price, subtotal
        ) VALUES (
            v_purchase_id, v_phone_id, 1,
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0)
        );

        INSERT INTO phone_history (
            phone_id, shop_id, action, previous_status, new_status, actor_id, details
        ) VALUES (
            v_phone_id, v_shop_id, 'PURCHASED', NULL, 'in_stock', v_user_id,
            jsonb_build_object(
                'purchase_id', v_purchase_id,
                'supplier_id', p_supplier_id,
                'cost_price', v_phone->>'cost_price',
                'imei_1', v_clean_imei1
            )
        );

        v_count := v_count + 1;
    END LOOP;

    v_balance_increase := p_total_amount - p_paid_amount;
    IF p_supplier_id IS NOT NULL AND v_balance_increase > 0 THEN
        UPDATE suppliers
        SET balance = COALESCE(balance, 0) + v_balance_increase
        WHERE id = p_supplier_id;
    END IF;

    IF p_supplier_id IS NOT NULL AND p_paid_amount > 0 THEN
        INSERT INTO supplier_payments (
            shop_id, supplier_id, user_id, amount, description
        ) VALUES (
            v_shop_id, p_supplier_id, v_user_id, p_paid_amount,
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

-- 4. Overload for 6-parameter compatibility
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

-- 5. Grant permissions and refresh schema cache
GRANT EXECUTE ON FUNCTION record_phone_purchase(INTEGER, INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION record_phone_purchase(INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;

NOTIFY pgrst, 'reload schema';
