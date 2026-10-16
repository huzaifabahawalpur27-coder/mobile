-- ============================================================================
-- SQL MIGRATION: FIX SECURE LOGIN AND PAYMENTS SCHEMA
-- Run this script in the Supabase SQL Editor.
-- ============================================================================

-- 1. Ensure supplier_payments table has all required ledger columns
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment';
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash';
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS description TEXT;

DO $$ 
BEGIN 
    ALTER TABLE public.supplier_payments ALTER COLUMN details TYPE TEXT USING details::text;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Ensure customer_payments table has all required ledger columns
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment';
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash';
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS description TEXT;

DO $$ 
BEGIN 
    ALTER TABLE public.customer_payments ALTER COLUMN details TYPE TEXT USING details::text;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Fix secure_login stored procedure to prevent 'record v_shop is not assigned yet'
DROP FUNCTION IF EXISTS secure_login(TEXT, TEXT);
CREATE OR REPLACE FUNCTION secure_login(p_username TEXT, p_password_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user           RECORD;
    v_shop           RECORD;
    v_match_count    INTEGER;
    v_session_token  UUID;
    v_clean_username TEXT;
    v_has_shop       BOOLEAN := false;
BEGIN
    v_clean_username := TRIM(p_username);

    -- Check for multiple accounts with same username (case-insensitive)
    SELECT COUNT(*) INTO v_match_count
    FROM users
    WHERE LOWER(username) = LOWER(v_clean_username) OR LOWER(email) = LOWER(v_clean_username);

    IF v_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Multiple accounts found. Please use your email to login.');
    END IF;

    -- Find active user
    SELECT u.* INTO v_user
    FROM users u
    WHERE (LOWER(u.username) = LOWER(v_clean_username) OR LOWER(u.email) = LOWER(v_clean_username))
      AND u.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    -- Verify password hash
    IF v_user.password != p_password_hash THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    -- Safe shop lookup only if shop_id is not null
    IF v_user.shop_id IS NOT NULL THEN
        SELECT s.*,
               sp.name            AS plan_name,
               COALESCE(sp.product_limit, 100) AS product_limit,
               COALESCE(sp.user_limit, 3)      AS user_limit,
               COALESCE(sp.features, '{}'::jsonb) AS features
        INTO v_shop
        FROM shops s
        LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
        WHERE s.id = v_user.shop_id;

        IF FOUND THEN
            v_has_shop := true;
            IF v_shop.status = 'suspended' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Your account has been suspended. Please contact support: 0301-2616367',
                    'suspension_reason', COALESCE(v_shop.suspension_reason, 'No reason specified')
                );
            END IF;
        END IF;
    END IF;

    -- If non-superadmin has no linked shop
    IF v_user.role != 'superadmin' AND NOT v_has_shop THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active shop organization is linked to this account.');
    END IF;

    -- Update sign-in stats
    UPDATE users SET last_sign_in_at = NOW() WHERE id = v_user.id;
    IF v_has_shop THEN
        UPDATE shops SET last_sign_in_at = NOW() WHERE id = v_user.shop_id;
    END IF;

    -- Generate and insert new secure session token
    v_session_token := gen_random_uuid();
    INSERT INTO sessions (token, user_id, shop_id)
    VALUES (v_session_token, v_user.id, v_user.shop_id);

    -- Build return response
    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'user', jsonb_build_object(
            'id',          v_user.id,
            'username',    v_user.username,
            'email',       COALESCE(v_user.email, ''),
            'role',        v_user.role,
            'shop_id',     v_user.shop_id,
            'permissions', COALESCE(v_user.permissions, '[]'::jsonb)
        ),
        'shop_config', CASE 
            WHEN v_has_shop THEN jsonb_build_object(
                'shop_name',         COALESCE(v_shop.name, 'EdgeX Store'),
                'logo_url',          COALESCE(v_shop.logo_url, ''),
                'currency',          COALESCE(v_shop.currency, 'PKR'),
                'plan_name',         COALESCE(v_shop.plan_name, v_shop.subscription_plan, 'Trial'),
                'product_limit',     COALESCE(v_shop.product_limit, 10000),
                'user_limit',        COALESCE(v_shop.user_limit, 10),
                'status',            COALESCE(v_shop.status, 'active'),
                'next_billing_date', v_shop.next_billing_date,
                'subscription_fee',  COALESCE(v_shop.subscription_fee, 0),
                'features',          COALESCE(v_shop.features, '{}'::jsonb)
            )
            ELSE jsonb_build_object(
                'shop_name',         'Superadmin Platform',
                'logo_url',          '',
                'currency',          'PKR',
                'plan_name',         'Platform Master',
                'product_limit',     999999,
                'user_limit',        999,
                'status',            'active',
                'next_billing_date', NULL,
                'subscription_fee',  0,
                'features',          '{"all": true}'::jsonb
            )
        END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_login(TEXT, TEXT) TO anon, authenticated;

-- 4. Notify PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';
