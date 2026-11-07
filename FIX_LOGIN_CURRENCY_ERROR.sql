-- ============================================================================
-- STEP 1: INSTANT FIX FOR CURRENCY & SESSIONS
-- Run these 3 lines first in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hekqzkrpxqsjfkosilpr/sql
-- ============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'PKR';
ALTER TABLE public.sessions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.sessions ALTER COLUMN shop_id DROP NOT NULL;

-- ============================================================================
-- STEP 2 (OPTIONAL): FULL RE-CREATION OF SECURE_LOGIN
-- (Only run if you want to replace the procedure; make sure to copy the entire block including $func$; at the end)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.secure_login(p_username TEXT, p_password_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $func$
DECLARE
    v_user           RECORD;
    v_shop           RECORD;
    v_session_token  TEXT;
    v_clean_username TEXT;
    v_has_shop       BOOLEAN := false;
BEGIN
    v_clean_username := TRIM(p_username);

    SELECT u.* INTO v_user
    FROM public.users u
    WHERE (LOWER(u.username) = LOWER(v_clean_username) OR LOWER(COALESCE(u.email, '')) = LOWER(v_clean_username))
      AND COALESCE(u.is_active, true) = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    IF v_user.password != p_password_hash THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    IF v_user.shop_id IS NOT NULL THEN
        SELECT s.* INTO v_shop
        FROM public.shops s
        WHERE s.id = v_user.shop_id;

        IF FOUND THEN
            v_has_shop := true;
            IF v_shop.status = 'suspended' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Your account has been suspended. Please contact support.',
                    'suspension_reason', COALESCE(to_jsonb(v_shop)->>'suspension_reason', 'Account suspended')
                );
            END IF;
        END IF;
    END IF;

    IF v_user.role != 'superadmin' AND NOT v_has_shop THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active shop organization is linked to this account.');
    END IF;

    BEGIN
        UPDATE public.users SET last_sign_in_at = NOW() WHERE id = v_user.id;
        IF v_has_shop THEN
            UPDATE public.shops SET last_sign_in_at = NOW() WHERE id = v_user.shop_id;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    v_session_token := gen_random_uuid()::text;
    BEGIN
        INSERT INTO public.sessions (token, user_id, shop_id, expires_at)
        VALUES (v_session_token, v_user.id, v_user.shop_id, NOW() + INTERVAL '30 days')
        ON CONFLICT (token) DO UPDATE 
            SET user_id = EXCLUDED.user_id,
                shop_id = EXCLUDED.shop_id,
                expires_at = EXCLUDED.expires_at;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

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
                'shop_name',         COALESCE(to_jsonb(v_shop)->>'name', 'EdgeX Store'),
                'logo_url',          COALESCE(to_jsonb(v_shop)->>'logo_url', ''),
                'currency',          COALESCE(to_jsonb(v_shop)->>'currency', 'PKR'),
                'plan_name',         COALESCE(to_jsonb(v_shop)->>'subscription_plan', 'Trial'),
                'product_limit',     10000,
                'user_limit',        10,
                'status',            COALESCE(to_jsonb(v_shop)->>'status', 'active'),
                'next_billing_date', to_jsonb(v_shop)->>'next_billing_date',
                'subscription_fee',  COALESCE((to_jsonb(v_shop)->>'subscription_fee')::numeric, 0),
                'features',          '{"all": true}'::jsonb
            )
            ELSE jsonb_build_object(
                'shop_name',         'Platform Master',
                'logo_url',          '',
                'currency',          'PKR',
                'plan_name',         'Master',
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
$func$;

GRANT EXECUTE ON FUNCTION public.secure_login(TEXT, TEXT) TO anon, authenticated, service_role, public;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
