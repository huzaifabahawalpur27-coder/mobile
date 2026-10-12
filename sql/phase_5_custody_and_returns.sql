-- ============================================================
-- PHASE 5 MIGRATION: CUSTODY, RESERVATIONS & RETURN WORKFLOWS
-- ============================================================

-- 1. Create phone_custody table
CREATE TABLE IF NOT EXISTS phone_custody (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL CHECK (issue_type IN ('temporary_issue', 'customer_reservation', 'personal_use')),
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT,
    expected_return_date DATE,
    deposit_amount NUMERIC(15,2) DEFAULT 0,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'converted_to_sale')),
    issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    returned_at TIMESTAMPTZ,
    returned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_custody_shop ON phone_custody(shop_id);
CREATE INDEX IF NOT EXISTS idx_phone_custody_phone ON phone_custody(phone_id);
CREATE INDEX IF NOT EXISTS idx_phone_custody_status ON phone_custody(status);

-- 2. Enable RLS on phone_custody
ALTER TABLE phone_custody ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_custody_tenant_isolation ON phone_custody;
CREATE POLICY phone_custody_tenant_isolation ON phone_custody
    FOR ALL
    USING (
        shop_id = (
            SELECT shop_id FROM sessions
            WHERE token = current_session_token()
              AND expires_at > NOW()
            LIMIT 1
        )
    )
    WITH CHECK (
        shop_id = (
            SELECT shop_id FROM sessions
            WHERE token = current_session_token()
              AND expires_at > NOW()
            LIMIT 1
        )
    );

-- 3. Atomic RPC: issue_phone_custody
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
    v_target_status TEXT;
    v_custody_id INTEGER;
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

    -- Lock and inspect phone
    SELECT * INTO v_phone
    FROM phones
    WHERE id = p_phone_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Phone not found in shop');
    END IF;

    IF v_phone.status != 'in_stock' THEN
        RETURN jsonb_build_object('success', false, 'error', format('Phone is currently %s and cannot be issued', v_phone.status));
    END IF;

    -- Determine new phone status
    IF p_issue_type = 'customer_reservation' THEN
        v_target_status := 'reserved';
    ELSIF p_issue_type = 'personal_use' THEN
        v_target_status := 'personal';
    ELSE
        v_target_status := 'issued';
    END IF;

    -- Insert custody tracking record
    INSERT INTO phone_custody (
        shop_id,
        branch_id,
        phone_id,
        issue_type,
        recipient_name,
        recipient_phone,
        expected_return_date,
        deposit_amount,
        notes,
        status,
        issued_by,
        issued_at
    ) VALUES (
        v_shop_id,
        v_phone.branch_id,
        p_phone_id,
        p_issue_type,
        p_recipient_name,
        p_recipient_phone,
        p_expected_return_date,
        COALESCE(p_deposit_amount, 0),
        p_notes,
        'active',
        v_user_id,
        NOW()
    )
    RETURNING id INTO v_custody_id;

    -- Transition phone status
    UPDATE phones
    SET status = v_target_status,
        updated_at = NOW()
    WHERE id = p_phone_id;

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
        p_phone_id,
        v_shop_id,
        format('custody_%s', p_issue_type),
        'in_stock',
        v_target_status,
        v_custody_id::TEXT,
        v_user_id,
        jsonb_build_object(
            'custody_id', v_custody_id,
            'issue_type', p_issue_type,
            'recipient_name', p_recipient_name,
            'recipient_phone', p_recipient_phone,
            'deposit_amount', p_deposit_amount,
            'notes', p_notes
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'custody_id', v_custody_id,
        'phone_id', p_phone_id,
        'new_status', v_target_status
    );
END;
$$;

-- 4. Atomic RPC: return_phone_custody
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
    v_phone RECORD;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id, shop_id
    INTO v_user_id, v_shop_id
    FROM sessions
    WHERE token = v_token AND expires_at > NOW();

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired');
    END IF;

    -- Lock custody record
    SELECT * INTO v_custody
    FROM phone_custody
    WHERE id = p_custody_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Custody record not found');
    END IF;

    IF v_custody.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Custody item is already closed');
    END IF;

    -- Lock phone
    SELECT * INTO v_phone
    FROM phones
    WHERE id = v_custody.phone_id AND shop_id = v_shop_id
    FOR UPDATE;

    -- Close custody record
    UPDATE phone_custody
    SET status = 'returned',
        returned_at = NOW(),
        returned_by = v_user_id,
        notes = CASE WHEN p_return_notes IS NOT NULL THEN COALESCE(notes, '') || ' [Return note: ' || p_return_notes || ']' ELSE notes END,
        updated_at = NOW()
    WHERE id = p_custody_id;

    -- Restore phone to in_stock
    UPDATE phones
    SET status = 'in_stock',
        updated_at = NOW()
    WHERE id = v_custody.phone_id;

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
        v_custody.phone_id,
        v_shop_id,
        'custody_returned',
        v_phone.status,
        'in_stock',
        p_custody_id::TEXT,
        v_user_id,
        jsonb_build_object(
            'custody_id', p_custody_id,
            'recipient_name', v_custody.recipient_name,
            'return_notes', p_return_notes
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'custody_id', p_custody_id,
        'phone_id', v_custody.phone_id,
        'new_status', 'in_stock'
    );
END;
$$;
