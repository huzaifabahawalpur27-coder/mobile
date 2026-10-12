-- ============================================================
-- PHASE 3 MIGRATION: IMEI-FIRST INVENTORY & ATOMIC PURCHASES
-- ============================================================

-- 1. Create phones inventory table
CREATE TABLE IF NOT EXISTS phones (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    imei_1 TEXT NOT NULL,
    imei_2 TEXT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    storage TEXT,
    color TEXT,
    condition TEXT NOT NULL DEFAULT 'Used' CHECK (condition IN ('New', 'Used', 'Refurbished')),
    pta_status TEXT NOT NULL DEFAULT 'PTA Approved' CHECK (pta_status IN ('PTA Approved', 'Non-PTA', 'JV', 'Custom')),
    cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    additional_costs NUMERIC(15,2) NOT NULL DEFAULT 0,
    sale_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    purchase_date DATE DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'reserved', 'issued', 'personal', 'returned')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast search indexes
CREATE INDEX IF NOT EXISTS idx_phones_shop_id ON phones(shop_id);
CREATE INDEX IF NOT EXISTS idx_phones_branch_id ON phones(branch_id);
CREATE INDEX IF NOT EXISTS idx_phones_imei_1 ON phones(imei_1);
CREATE INDEX IF NOT EXISTS idx_phones_imei_2 ON phones(imei_2);
CREATE INDEX IF NOT EXISTS idx_phones_status ON phones(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_phones_brand_model ON phones(shop_id, brand, model);

-- 2. Database-level Cross-Slot IMEI Uniqueness Enforcement
-- A phone cannot have the same IMEI 1 and IMEI 2.
-- Furthermore, an IMEI cannot duplicate any other phone's IMEI 1 or IMEI 2 within the same shop.

CREATE OR REPLACE FUNCTION check_imei_cross_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_conflict_id INTEGER;
    v_clean_imei1 TEXT;
    v_clean_imei2 TEXT;
BEGIN
    v_clean_imei1 := TRIM(NEW.imei_1);
    v_clean_imei2 := NULLIF(TRIM(COALESCE(NEW.imei_2, '')), '');

    -- Ensure IMEI 1 is not empty
    IF v_clean_imei1 IS NULL OR v_clean_imei1 = '' THEN
        RAISE EXCEPTION 'IMEI 1 is required and cannot be empty.';
    END IF;

    -- Ensure IMEI 1 and IMEI 2 are not identical on the same phone
    IF v_clean_imei2 IS NOT NULL AND v_clean_imei1 = v_clean_imei2 THEN
        RAISE EXCEPTION 'IMEI 1 and IMEI 2 cannot be identical on the same phone (%)', v_clean_imei1;
    END IF;

    NEW.imei_1 := v_clean_imei1;
    NEW.imei_2 := v_clean_imei2;

    -- Check if IMEI 1 duplicates another phone's IMEI 1 or IMEI 2 in the same shop
    SELECT id INTO v_conflict_id
    FROM phones
    WHERE shop_id = NEW.shop_id
      AND id != COALESCE(NEW.id, -1)
      AND (imei_1 = v_clean_imei1 OR imei_2 = v_clean_imei1)
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'IMEI 1 (%) is already registered to phone ID #% in this organization.', v_clean_imei1, v_conflict_id;
    END IF;

    -- Check if IMEI 2 duplicates another phone's IMEI 1 or IMEI 2 in the same shop
    IF v_clean_imei2 IS NOT NULL THEN
        SELECT id INTO v_conflict_id
        FROM phones
        WHERE shop_id = NEW.shop_id
          AND id != COALESCE(NEW.id, -1)
          AND (imei_1 = v_clean_imei2 OR imei_2 = v_clean_imei2)
        LIMIT 1;

        IF v_conflict_id IS NOT NULL THEN
            RAISE EXCEPTION 'IMEI 2 (%) is already registered to phone ID #% in this organization.', v_clean_imei2, v_conflict_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_imei_cross_uniqueness ON phones;
CREATE TRIGGER trg_check_imei_cross_uniqueness
BEFORE INSERT OR UPDATE ON phones
FOR EACH ROW
EXECUTE FUNCTION check_imei_cross_uniqueness();

-- 3. Create phone_history table (Audit trail for every status transition)
CREATE TABLE IF NOT EXISTS phone_history (
    id BIGSERIAL PRIMARY KEY,
    phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    reference_id TEXT,
    performed_by UUID REFERENCES users(id),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_history_phone ON phone_history(phone_id);

-- 4. Enable RLS on phones and phone_history
ALTER TABLE phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Phones Tenant Isolation" ON phones;
CREATE POLICY "Phones Tenant Isolation" ON phones
AS PERMISSIVE FOR ALL TO public
USING (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = phones.shop_id
          AND s.expires_at > NOW()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = phones.shop_id
          AND s.expires_at > NOW()
    )
);

DROP POLICY IF EXISTS "Phone History Tenant Isolation" ON phone_history;
CREATE POLICY "Phone History Tenant Isolation" ON phone_history
AS PERMISSIVE FOR ALL TO public
USING (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = phone_history.shop_id
          AND s.expires_at > NOW()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = phone_history.shop_id
          AND s.expires_at > NOW()
    )
);

-- 5. ATOMIC PURCHASE RPC: record_phone_purchase
-- Atomically writes: purchase header, purchase items, individual phone records,
-- phone history entries, supplier balance update, and supplier payment record.
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
            'purchased',
            NULL,
            'in_stock',
            v_purchase_id::TEXT,
            v_user_id,
            jsonb_build_object(
                'purchase_id', v_purchase_id,
                'supplier_id', p_supplier_id,
                'cost_price', v_phone->>'cost_price',
                'imei_1', v_clean_imei1
            )
        );

        -- Also record in purchase_items for backward-compatible reporting
        INSERT INTO purchase_items (
            purchase_id,
            product_id,
            quantity,
            cost_price,
            subtotal
        ) VALUES (
            v_purchase_id,
            NULL,
            1,
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
            COALESCE((v_phone->>'cost_price')::NUMERIC, 0)
        );

        v_count := v_count + 1;
    END LOOP;

    -- Update Supplier Balance if credit / unpaid balance exists
    v_balance_increase := p_total_amount - p_paid_amount;
    IF p_supplier_id IS NOT NULL AND v_balance_increase > 0 THEN
        UPDATE suppliers
        SET balance = COALESCE(balance, 0) + v_balance_increase
        WHERE id = p_supplier_id;
    END IF;

    -- Record Supplier Payment if partial/full payment made
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
            format('Payment for Phone Purchase PR-%s (%s)', v_purchase_id, p_payment_type)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'phones_count', v_count,
        'total_amount', p_total_amount,
        'paid_amount', p_paid_amount
    );
END;
$$;

GRANT EXECUTE ON FUNCTION record_phone_purchase(INTEGER, INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;
