-- ============================================================
-- PHASE 6 MIGRATION: CASH SESSIONS & SERIALIZED COGS ACCOUNTING
-- ============================================================

-- 1. Create cash_sessions table
CREATE TABLE IF NOT EXISTS cash_sessions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opening_cash NUMERIC(15,2) NOT NULL DEFAULT 0,
    closing_cash_expected NUMERIC(15,2),
    closing_cash_actual NUMERIC(15,2),
    variance NUMERIC(15,2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    notes TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_shop ON cash_sessions(shop_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_user ON cash_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);

-- 2. Enable RLS on cash_sessions
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_sessions_tenant_isolation ON cash_sessions;
CREATE POLICY cash_sessions_tenant_isolation ON cash_sessions
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

-- 3. Atomic RPC: open_cash_session
CREATE OR REPLACE FUNCTION open_cash_session(
    p_opening_cash NUMERIC,
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
    v_existing_session RECORD;
    v_session_id INTEGER;
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

    -- Check if user already has an active open session
    SELECT id INTO v_existing_session
    FROM cash_sessions
    WHERE user_id = v_user_id AND shop_id = v_shop_id AND status = 'open'
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'You already have an active open cash drawer session',
            'session_id', v_existing_session.id
        );
    END IF;

    INSERT INTO cash_sessions (
        shop_id,
        branch_id,
        user_id,
        opening_cash,
        status,
        notes,
        opened_at
    ) VALUES (
        v_shop_id,
        v_branch_id,
        v_user_id,
        COALESCE(p_opening_cash, 0),
        'open',
        p_notes,
        NOW()
    )
    RETURNING id INTO v_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', v_session_id,
        'opening_cash', COALESCE(p_opening_cash, 0),
        'status', 'open'
    );
END;
$$;

-- 4. Atomic RPC: close_cash_session
CREATE OR REPLACE FUNCTION close_cash_session(
    p_session_id INTEGER,
    p_closing_cash_actual NUMERIC,
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
    v_session RECORD;
    v_cash_sales NUMERIC := 0;
    v_cash_payments NUMERIC := 0;
    v_cash_expenses NUMERIC := 0;
    v_expected NUMERIC;
    v_variance NUMERIC;
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

    -- Lock session
    SELECT * INTO v_session
    FROM cash_sessions
    WHERE id = p_session_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cash session not found');
    END IF;

    IF v_session.status != 'open' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cash session is already closed');
    END IF;

    -- Calculate total cash received from sales during this shift
    SELECT COALESCE(SUM(paid_amount), 0) INTO v_cash_sales
    FROM sales
    WHERE shop_id = v_shop_id
      AND user_id = v_session.user_id
      AND (payment_method = 'cash' OR payment_type = 'cash')
      AND created_at >= v_session.opened_at;

    -- Calculate customer cash payments received during this shift
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_payments
    FROM customer_payments
    WHERE shop_id = v_shop_id
      AND user_id = v_session.user_id
      AND created_at >= v_session.opened_at;

    -- Calculate cash expenses paid out during this shift
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
    FROM expenses
    WHERE shop_id = v_shop_id
      AND created_at >= v_session.opened_at;

    v_expected := v_session.opening_cash + v_cash_sales + v_cash_payments - v_cash_expenses;
    v_variance := p_closing_cash_actual - v_expected;

    -- Close session
    UPDATE cash_sessions
    SET status = 'closed',
        closing_cash_expected = v_expected,
        closing_cash_actual = p_closing_cash_actual,
        variance = v_variance,
        notes = CASE WHEN p_notes IS NOT NULL THEN COALESCE(notes, '') || ' [Closing note: ' || p_notes || ']' ELSE notes END,
        closed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'opening_cash', v_session.opening_cash,
        'cash_sales', v_cash_sales,
        'cash_expenses', v_cash_expenses,
        'closing_cash_expected', v_expected,
        'closing_cash_actual', p_closing_cash_actual,
        'variance', v_variance,
        'status', 'closed'
    );
END;
$$;
