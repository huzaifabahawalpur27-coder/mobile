-- ============================================================
-- PHASE 2 MIGRATION: MULTI-TENANT & BRANCH FOUNDATION (EdgeX POS)
-- Backward-compatible upgrade preserving all existing shops and data.
-- ============================================================

-- 1. Extend shops table with metadata
ALTER TABLE shops ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'PKR';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS tax_number TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Create branches table
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    phone TEXT,
    address TEXT,
    is_main BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast branch lookups
CREATE INDEX IF NOT EXISTS idx_branches_shop_id ON branches(shop_id);

-- Backfill: Ensure every existing shop has a Main Branch
INSERT INTO branches (shop_id, name, code, is_main, is_active)
SELECT s.id, 'Main Branch', 'MAIN', true, true
FROM shops s
WHERE NOT EXISTS (
    SELECT 1 FROM branches b WHERE b.shop_id = s.id
);

-- 3. Create shop_members table (Multi-tenant user memberships)
CREATE TABLE IF NOT EXISTS shop_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('superadmin', 'owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_staff')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_members_user ON shop_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_shop ON shop_members(shop_id);

-- Backfill: Populate shop_members from existing users table
INSERT INTO shop_members (shop_id, user_id, branch_id, role, is_active)
SELECT 
    u.shop_id, 
    u.id, 
    (SELECT b.id FROM branches b WHERE b.shop_id = u.shop_id ORDER BY b.is_main DESC, b.id ASC LIMIT 1),
    CASE 
        WHEN u.role = 'admin' THEN 'owner'
        WHEN u.role IN ('owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_staff') THEN u.role
        ELSE 'cashier'
    END,
    COALESCE(u.is_active, true)
FROM users u
WHERE u.shop_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM shop_members sm WHERE sm.shop_id = u.shop_id AND sm.user_id = u.id
  );

-- Link shop owner_id if missing
UPDATE shops s
SET owner_id = sm.user_id
FROM shop_members sm
WHERE sm.shop_id = s.id 
  AND sm.role IN ('owner', 'admin')
  AND s.owner_id IS NULL;

-- 4. Extend sessions table with branch_id
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;

-- 5. Extend business tables with branch_id (nullable for backward compatibility)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;

-- Backfill existing business transactions with main branch of their shop
UPDATE sales s
SET branch_id = b.id
FROM branches b
WHERE b.shop_id = s.shop_id AND b.is_main = true AND s.branch_id IS NULL;

UPDATE purchases p
SET branch_id = b.id
FROM branches b
WHERE b.shop_id = p.shop_id AND b.is_main = true AND p.branch_id IS NULL;

UPDATE expenses e
SET branch_id = b.id
FROM branches b
WHERE b.shop_id = e.shop_id AND b.is_main = true AND e.branch_id IS NULL;

-- 6. RPC: Switch Tenant / Branch Context securely
CREATE OR REPLACE FUNCTION switch_tenant_context(
    p_target_shop_id INTEGER,
    p_target_branch_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_member RECORD;
    v_shop RECORD;
    v_branch RECORD;
    v_branch_id INTEGER;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    -- Retrieve current user from active session
    SELECT user_id INTO v_user_id
    FROM sessions
    WHERE token = v_token AND expires_at > NOW();

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired or invalid');
    END IF;

    -- Validate user is a member of the target shop
    SELECT sm.*, s.status as shop_status, s.name as shop_name
    INTO v_member
    FROM shop_members sm
    JOIN shops s ON s.id = sm.shop_id
    WHERE sm.user_id = v_user_id 
      AND sm.shop_id = p_target_shop_id
      AND sm.is_active = true;

    IF NOT FOUND THEN
        -- Check if user is platform superadmin
        IF EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND role = 'superadmin') THEN
            SELECT *, status as shop_status, name as shop_name INTO v_shop FROM shops WHERE id = p_target_shop_id;
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'Shop not found');
            END IF;
        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Access denied to target organization');
        END IF;
    END IF;

    IF v_member.shop_status = 'suspended' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target shop account is suspended');
    END IF;

    -- Resolve branch
    v_branch_id := p_target_branch_id;
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id FROM branches WHERE shop_id = p_target_shop_id AND is_main = true LIMIT 1;
        IF v_branch_id IS NULL THEN
            SELECT id INTO v_branch_id FROM branches WHERE shop_id = p_target_shop_id LIMIT 1;
        END IF;
    ELSE
        -- Ensure target branch belongs to target shop
        IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_branch_id AND shop_id = p_target_shop_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Branch does not belong to specified shop');
        END IF;
    END IF;

    -- Update the session row to the new tenant & branch context
    UPDATE sessions
    SET shop_id = p_target_shop_id,
        branch_id = v_branch_id
    WHERE token = v_token;

    -- Fetch branch details
    SELECT * INTO v_branch FROM branches WHERE id = v_branch_id;

    RETURN jsonb_build_object(
        'success', true,
        'shop_id', p_target_shop_id,
        'branch_id', v_branch_id,
        'branch_name', COALESCE(v_branch.name, 'Main Branch'),
        'role', COALESCE(v_member.role, 'admin')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION switch_tenant_context(INTEGER, INTEGER) TO anon, authenticated, public;

-- 7. Upgrade secure_login to return authorized shops and branches
CREATE OR REPLACE FUNCTION secure_login(p_username TEXT, p_password_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user          RECORD;
    v_shop          RECORD;
    v_branch_id     INTEGER;
    v_branch_name   TEXT;
    v_match_count   INTEGER;
    v_session_token UUID;
    v_auth_shops    JSONB;
    v_branches      JSONB;
    v_effective_role TEXT;
BEGIN
    -- Match username or email
    SELECT COUNT(*) INTO v_match_count
    FROM users
    WHERE LOWER(username) = LOWER(p_username) OR LOWER(email) = LOWER(p_username);

    IF v_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Multiple accounts found. Please use your email to login.');
    END IF;

    SELECT u.*
    INTO v_user
    FROM users u
    WHERE (LOWER(u.username) = LOWER(p_username) OR LOWER(u.email) = LOWER(p_username))
      AND u.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    IF v_user.password != p_password_hash THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid username or password');
    END IF;

    -- Superadmin bypass
    IF v_user.role = 'superadmin' THEN
        INSERT INTO sessions (user_id, shop_id)
        VALUES (v_user.id, COALESCE(v_user.shop_id, 1))
        RETURNING token INTO v_session_token;

        RETURN jsonb_build_object(
            'success', true,
            'session_token', v_session_token,
            'user', jsonb_build_object(
                'id',          v_user.id,
                'username',    v_user.username,
                'email',       COALESCE(v_user.email, ''),
                'role',        'superadmin',
                'shop_id',     v_user.shop_id,
                'permissions', COALESCE(v_user.permissions, '[]'::jsonb)
            ),
            'shop_config', jsonb_build_object('plan_name', 'ENTERPRISE', 'status', 'active')
        );
    END IF;

    -- Resolve primary shop membership
    IF v_user.shop_id IS NULL THEN
        SELECT shop_id INTO v_user.shop_id 
        FROM shop_members 
        WHERE user_id = v_user.id AND is_active = true 
        ORDER BY created_at ASC 
        LIMIT 1;
    END IF;

    IF v_user.shop_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User is not assigned to any organization');
    END IF;

    -- Fetch shop details
    SELECT s.*, sp.name as plan_name, COALESCE(sp.product_limit, 100) as product_limit, COALESCE(sp.user_limit, 3) as user_limit
    INTO v_shop
    FROM shops s
    LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
    WHERE s.id = v_user.shop_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
    END IF;

    IF v_shop.status = 'suspended' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account has been suspended. Please contact support: 0301-2616367');
    END IF;

    -- Resolve user role in target shop
    SELECT role INTO v_effective_role
    FROM shop_members
    WHERE user_id = v_user.id AND shop_id = v_user.shop_id;
    
    IF v_effective_role IS NULL THEN
        v_effective_role := v_user.role;
    END IF;

    -- Resolve main branch
    SELECT id, name INTO v_branch_id, v_branch_name
    FROM branches
    WHERE shop_id = v_user.shop_id AND is_main = true
    LIMIT 1;

    IF v_branch_id IS NULL THEN
        SELECT id, name INTO v_branch_id, v_branch_name
        FROM branches
        WHERE shop_id = v_user.shop_id
        LIMIT 1;
    END IF;

    -- Update sign-in timestamp
    UPDATE users SET last_sign_in_at = NOW() WHERE id = v_user.id;
    UPDATE shops SET last_sign_in_at = NOW() WHERE id = v_user.shop_id;

    -- Insert session
    INSERT INTO sessions (user_id, shop_id, branch_id)
    VALUES (v_user.id, v_user.shop_id, v_branch_id)
    RETURNING token INTO v_session_token;

    -- Build list of user authorized shops
    SELECT jsonb_agg(jsonb_build_object(
        'shop_id', s.id,
        'shop_name', s.name,
        'role', sm.role
    )) INTO v_auth_shops
    FROM shop_members sm
    JOIN shops s ON s.id = sm.shop_id
    WHERE sm.user_id = v_user.id AND sm.is_active = true AND s.status != 'suspended';

    -- Build list of branches for active shop
    SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'code', b.code,
        'is_main', b.is_main
    )) INTO v_branches
    FROM branches b
    WHERE b.shop_id = v_user.shop_id AND b.is_active = true;

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'user', jsonb_build_object(
            'id',          v_user.id,
            'username',    v_user.username,
            'email',       COALESCE(v_user.email, ''),
            'role',        v_effective_role,
            'shop_id',     v_user.shop_id,
            'branch_id',   v_branch_id,
            'branch_name', COALESCE(v_branch_name, 'Main Branch'),
            'permissions', COALESCE(v_user.permissions, '[]'::jsonb)
        ),
        'authorized_shops', COALESCE(v_auth_shops, '[]'::jsonb),
        'branches',         COALESCE(v_branches, '[]'::jsonb),
        'shop_config', jsonb_build_object(
            'plan_name',     COALESCE(v_shop.plan_name, v_shop.subscription_plan, 'TRIAL'),
            'product_limit', COALESCE(v_shop.product_limit, 100),
            'user_limit',    COALESCE(v_shop.user_limit, 3),
            'status',        COALESCE(v_shop.status, 'active')
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION secure_login(TEXT, TEXT) TO anon, authenticated, public;

-- 8. Apply RLS policies to branches and shop_members
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branches Tenant Isolation" ON branches;
CREATE POLICY "Branches Tenant Isolation" ON branches
AS PERMISSIVE FOR ALL TO public
USING (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = branches.shop_id
          AND s.expires_at > NOW()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = branches.shop_id
          AND s.expires_at > NOW()
    )
);

DROP POLICY IF EXISTS "Shop Members Isolation" ON shop_members;
CREATE POLICY "Shop Members Isolation" ON shop_members
AS PERMISSIVE FOR ALL TO public
USING (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = shop_members.shop_id
          AND s.expires_at > NOW()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.token = current_session_token()
          AND s.shop_id = shop_members.shop_id
          AND s.expires_at > NOW()
    )
);
