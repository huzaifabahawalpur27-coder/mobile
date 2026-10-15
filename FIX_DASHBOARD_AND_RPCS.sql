-- ==============================================================================
-- FIX DASHBOARD, ANNOUNCEMENTS, AND MISSING RPCS
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- ==============================================================================

-- 1. Ensure customer_name exists on sales table for walk-in customer names
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- 2. Create get_shop_status RPC
CREATE OR REPLACE FUNCTION get_shop_status(p_shop_id INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM shops WHERE id = p_shop_id;
    RETURN COALESCE(v_status, 'active');
END;
$$;

GRANT EXECUTE ON FUNCTION get_shop_status(INTEGER) TO anon, authenticated, public;

-- 3. Create get_shop_config RPC
CREATE OR REPLACE FUNCTION get_shop_config(p_shop_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_shop RECORD;
    v_plan RECORD;
    v_product_limit INTEGER := 100;
    v_user_limit INTEGER := 3;
    v_plan_name TEXT := 'TRIAL';
    v_features JSONB := '{}'::jsonb;
BEGIN
    SELECT * INTO v_shop FROM shops WHERE id = p_shop_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'active',
            'plan_name', 'TRIAL',
            'product_limit', 100,
            'user_limit', 3,
            'features', '{}'::jsonb
        );
    END IF;

    -- Fetch from subscription_plans if plan_id exists
    IF v_shop.plan_id IS NOT NULL THEN
        SELECT * INTO v_plan FROM subscription_plans WHERE id = v_shop.plan_id;
        IF FOUND THEN
            v_plan_name := COALESCE(v_plan.name, 'TRIAL');
            v_product_limit := COALESCE(v_plan.product_limit, 100);
            v_user_limit := COALESCE(v_plan.user_limit, 3);
            v_features := COALESCE(v_plan.features, '{}'::jsonb);
        END IF;
    ELSE
        v_plan_name := COALESCE(v_shop.subscription_plan, 'TRIAL');
    END IF;

    RETURN jsonb_build_object(
        'status', COALESCE(v_shop.status, 'active'),
        'plan_name', v_plan_name,
        'product_limit', v_product_limit,
        'user_limit', v_user_limit,
        'features', v_features,
        'subscription_fee', COALESCE(v_shop.subscription_fee, 0),
        'next_billing_date', v_shop.next_billing_date,
        'shop_name', v_shop.name,
        'logo_url', v_shop.logo_url
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_shop_config(INTEGER) TO anon, authenticated, public;

-- 4. Create announcements table if it doesn't exist
CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    title TEXT,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info', -- 'info', 'warning', 'success', 'urgent'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Allow reading announcements (global or shop-specific)
DROP POLICY IF EXISTS "Announcements Read Policy" ON announcements;
CREATE POLICY "Announcements Read Policy" ON announcements
    FOR SELECT
    USING (is_active = true AND (shop_id IS NULL OR shop_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'shop_id')::INTEGER)));

-- Allow anon read fallback
DROP POLICY IF EXISTS "Announcements Public Read" ON announcements;
CREATE POLICY "Announcements Public Read" ON announcements
    FOR SELECT
    TO anon, authenticated
    USING (is_active = true);
