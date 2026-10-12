-- ============================================================================
-- EDGEX POS & MOBILE SHOP SAAS — COMPLETE TURNKEY SUPABASE SETUP
-- ============================================================================
-- Run this entire script in your Supabase SQL Editor (Dashboard → SQL Editor).
-- It will create all tables, indexes, RLS policies, RPC functions, and default
-- administrator / shop credentials so you can log in immediately.
-- ============================================================================

-- 0. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. BASE TABLES & MULTI-TENANCY FOUNDATION
-- ============================================================================

-- Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    price NUMERIC(15,2) DEFAULT 0,
    billing_period TEXT DEFAULT 'monthly',
    product_limit INTEGER DEFAULT 1000,
    user_limit INTEGER DEFAULT 10,
    branch_limit INTEGER DEFAULT 5,
    features JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shops (Tenants)
CREATE TABLE IF NOT EXISTS shops (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    email TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    logo_url TEXT,
    notes TEXT,
    plan_id INTEGER REFERENCES subscription_plans(id),
    subscription_plan TEXT DEFAULT 'TRIAL',
    invoice_footer TEXT DEFAULT 'شکریہ! دوبارہ تشریف لائیں',
    quotation_footer TEXT DEFAULT 'یہ صرف قیمت نامہ ہے',
    print_size TEXT DEFAULT 'thermal',
    print_mode TEXT DEFAULT 'manual',
    print_template TEXT DEFAULT '2',
    wa_reminder_template TEXT,
    wa_bill_template TEXT,
    wa_reorder_template TEXT,
    invoice_prefix TEXT DEFAULT 'INV',
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if shops table was already created in a previous migration
ALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES subscription_plans(id);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'TRIAL';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS invoice_footer TEXT DEFAULT 'شکریہ! دوبارہ تشریف لائیں';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS quotation_footer TEXT DEFAULT 'یہ صرف قیمت نامہ ہے';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS print_size TEXT DEFAULT 'thermal';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS print_mode TEXT DEFAULT 'manual';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS print_template TEXT DEFAULT '2';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS wa_reminder_template TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS wa_bill_template TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS wa_reorder_template TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS invoice_prefix TEXT DEFAULT 'INV';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Branches
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    is_main BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password TEXT NOT NULL, -- Stored as SHA-256 hex string
    role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('superadmin', 'owner', 'admin', 'manager', 'cashier', 'staff')),
    shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    permissions JSONB DEFAULT '[]'::jsonb,
    last_sign_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if users table was already created
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Shop Members (Many-to-many user to tenant mapping)
CREATE TABLE IF NOT EXISTS shop_members (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    default_branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'cashier',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shop_user UNIQUE (user_id, shop_id)
);

-- Sessions (Active multi-tenant sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_shop ON sessions(shop_id);

-- Session token helper
CREATE OR REPLACE FUNCTION current_session_token()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_headers JSONB;
    v_token TEXT;
BEGIN
    BEGIN
        v_headers := current_setting('request.headers', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    IF v_headers IS NULL THEN
        RETURN NULL;
    END IF;
    v_token := COALESCE(v_headers->>'x-session-token', v_headers->>'X-Session-Token');
    IF v_token IS NULL OR v_token !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN NULL;
    END IF;
    RETURN v_token::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION current_session_token() TO anon, authenticated, public;

-- Categories
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brands
CREATE TABLE IF NOT EXISTS brands (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand Categories Junction
CREATE TABLE IF NOT EXISTS brand_categories (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Units of Measure
CREATE TABLE IF NOT EXISTS units (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    abbreviation TEXT,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Standard Products (Accessories, Parts, General Stock)
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    cost_price NUMERIC(15,2) DEFAULT 0,
    sale_price NUMERIC(15,2) DEFAULT 0,
    stock_quantity NUMERIC(15,2) DEFAULT 0,
    low_stock_threshold NUMERIC(15,2) DEFAULT 5,
    sku TEXT,
    barcode TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if products table was already created
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Serialized Mobile Phones (IMEI-First Tracking)
CREATE TABLE IF NOT EXISTS phones (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    imei_1 TEXT NOT NULL,
    imei_2 TEXT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    color TEXT,
    storage TEXT,
    condition TEXT DEFAULT 'used' CHECK (condition IN ('brand_new', 'used', 'refurbished', 'open_box', 'faulty')),
    pta_status TEXT DEFAULT 'approved' CHECK (pta_status IN ('approved', 'non_pta', 'cpid', 'vip', 'blocked')),
    status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'in_custody', 'returned', 'reserved')),
    cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    sale_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    battery_health INTEGER,
    specs JSONB DEFAULT '{}'::jsonb,
    supplier_id INTEGER,
    purchase_id INTEGER,
    sale_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shop_imei_1 UNIQUE (shop_id, imei_1)
);

CREATE INDEX IF NOT EXISTS idx_phones_shop ON phones(shop_id);
CREATE INDEX IF NOT EXISTS idx_phones_imei1 ON phones(imei_1);
CREATE INDEX IF NOT EXISTS idx_phones_imei2 ON phones(imei_2);
CREATE INDEX IF NOT EXISTS idx_phones_status ON phones(status);

-- Phone Lifecycle Audit Trail
CREATE TABLE IF NOT EXISTS phone_history (
    id SERIAL PRIMARY KEY,
    phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phone Custody (Temporary Dealer Issues, Customer Reservations, Personal Use)
CREATE TABLE IF NOT EXISTS phone_custody (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL CHECK (issue_type IN ('temporary_issue', 'reservation', 'personal_use', 'repair')),
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT,
    recipient_cnic TEXT,
    token_deposit NUMERIC(15,2) DEFAULT 0,
    expected_return_date DATE,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'converted_to_sale')),
    issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
    returned_at TIMESTAMPTZ,
    returned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance NUMERIC(15,2) DEFAULT 0,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    balance NUMERIC(15,2) DEFAULT 0,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    total_amount NUMERIC(15,2) DEFAULT 0,
    discount NUMERIC(15,2) DEFAULT 0,
    net_amount NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    payment_type TEXT DEFAULT 'cash',
    payment_details JSONB,
    idempotency_key UUID UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if sales table was already created
ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_details JSONB;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key UUID;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_idempotency_key_key') THEN
        ALTER TABLE sales ADD CONSTRAINT sales_idempotency_key_key UNIQUE (idempotency_key);
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL,
    quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    price NUMERIC(15,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
    imei_snapshot TEXT,
    returned_qty NUMERIC(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if sale_items table was already created
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS imei_snapshot TEXT;

-- Purchases
CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    total_amount NUMERIC(15,2) DEFAULT 0,
    discount NUMERIC(15,2) DEFAULT 0,
    net_amount NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0,
    amount_paid NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if purchases table was already created
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0;

-- Purchase Items
CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL,
    quantity NUMERIC(15,2) NOT NULL DEFAULT 1,
    cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- Ensure all columns exist if purchase_items table was already created
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS phone_id INTEGER REFERENCES phones(id) ON DELETE SET NULL;

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(15,2) NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id),
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist if expenses table was already created
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL;

-- Customer Payments (Ledger Receivables)
CREATE TABLE IF NOT EXISTS customer_payments (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Supplier Payments (Ledger Payables)
CREATE TABLE IF NOT EXISTS supplier_payments (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cash Drawer & Shift Sessions
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

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    action_type TEXT,
    entity TEXT NOT NULL,
    entity_id TEXT,
    details JSONB,
    user_id UUID REFERENCES users(id),
    shop_id INTEGER REFERENCES shops(id),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_custody ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper macro function for tenant checking
CREATE OR REPLACE FUNCTION current_user_shop_id()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_shop_id INTEGER;
    v_headers JSONB;
    v_header_shop_id TEXT;
BEGIN
    -- 1. Try resolving from active session token
    v_token := current_session_token();
    IF v_token IS NOT NULL THEN
        SELECT shop_id INTO v_shop_id
        FROM sessions
        WHERE token = v_token AND expires_at > NOW()
        LIMIT 1;
        IF v_shop_id IS NOT NULL THEN
            RETURN v_shop_id;
        END IF;
    END IF;

    -- 2. Fallback: resolve from x-shop-id header if present
    BEGIN
        v_headers := current_setting('request.headers', true)::jsonb;
        v_header_shop_id := COALESCE(v_headers->>'x-shop-id', v_headers->>'X-Shop-Id');
        IF v_header_shop_id IS NOT NULL AND v_header_shop_id ~ '^[0-9]+$' THEN
            RETURN v_header_shop_id::INTEGER;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 3. Fallback: Default to shop 1 (single-tenant / demo baseline fallback)
    RETURN 1;
END;
$$;
GRANT EXECUTE ON FUNCTION current_user_shop_id() TO anon, authenticated, public;

-- Sessions table security policy
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sessions Access" ON sessions;
CREATE POLICY "Sessions Access" ON sessions FOR ALL TO anon, authenticated, public
USING (token = current_session_token() OR current_session_token() IS NULL)
WITH CHECK (true);

-- Apply standard tenant isolation policies
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'branches', 'products', 'phones', 'phone_history', 'phone_custody',
        'categories', 'brands', 'units', 'customers', 'suppliers',
        'sales', 'purchases', 'expenses', 'customer_payments',
        'supplier_payments', 'cash_sessions', 'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I;', tbl, tbl);
        EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I FOR ALL USING (shop_id = current_user_shop_id()) WITH CHECK (shop_id = current_user_shop_id());', tbl, tbl);
    END LOOP;
END;
$$;

-- Shops policy (user can only view their active shop)
DROP POLICY IF EXISTS shops_tenant_isolation ON shops;
CREATE POLICY shops_tenant_isolation ON shops FOR ALL
USING (id = current_user_shop_id())
WITH CHECK (id = current_user_shop_id());

-- Users policy
DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users FOR ALL
USING (shop_id = current_user_shop_id() OR role = 'superadmin')
WITH CHECK (shop_id = current_user_shop_id());

-- Sale items & purchase items parent cascade policies
DROP POLICY IF EXISTS sale_items_tenant_isolation ON sale_items;
CREATE POLICY sale_items_tenant_isolation ON sale_items FOR ALL
USING (sale_id IN (SELECT id FROM sales WHERE shop_id = current_user_shop_id()))
WITH CHECK (sale_id IN (SELECT id FROM sales WHERE shop_id = current_user_shop_id()));

DROP POLICY IF EXISTS purchase_items_tenant_isolation ON purchase_items;
CREATE POLICY purchase_items_tenant_isolation ON purchase_items FOR ALL
USING (purchase_id IN (SELECT id FROM purchases WHERE shop_id = current_user_shop_id()))
WITH CHECK (purchase_id IN (SELECT id FROM purchases WHERE shop_id = current_user_shop_id()));

-- ============================================================================
-- 3. STORED PROCEDURES & SECURE RPC FUNCTIONS
-- ============================================================================

-- A. Secure Login RPC (authenticates, provisions active session, returns token)
CREATE OR REPLACE FUNCTION secure_login(p_username TEXT, p_password_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user       RECORD;
    v_shop       RECORD;
    v_branch_id  INTEGER;
    v_session_token UUID;
    v_match_count INTEGER;
BEGIN
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

    -- For regular tenant users, check shop status
    IF v_user.shop_id IS NOT NULL THEN
        SELECT s.*, COALESCE(sp.name, s.subscription_plan, 'TRIAL') as plan_name,
               COALESCE(sp.product_limit, 1000) as product_limit,
               COALESCE(sp.user_limit, 10) as user_limit
        INTO v_shop
        FROM shops s
        LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
        WHERE s.id = v_user.shop_id;

        IF v_shop.status = 'suspended' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Your shop account has been suspended. Please contact support: 0301-2616367');
        END IF;

        -- Resolve default branch
        v_branch_id := v_user.branch_id;
        IF v_branch_id IS NULL THEN
            SELECT id INTO v_branch_id FROM branches WHERE shop_id = v_user.shop_id AND is_main = true LIMIT 1;
            IF v_branch_id IS NULL THEN
                SELECT id INTO v_branch_id FROM branches WHERE shop_id = v_user.shop_id LIMIT 1;
            END IF;
        END IF;
    END IF;

    -- Generate active session token
    v_session_token := gen_random_uuid();
    INSERT INTO sessions (user_id, shop_id, branch_id, token, expires_at)
    VALUES (v_user.id, COALESCE(v_user.shop_id, 1), v_branch_id, v_session_token, NOW() + INTERVAL '30 days');

    UPDATE users SET last_sign_in_at = NOW() WHERE id = v_user.id;
    IF v_user.shop_id IS NOT NULL THEN
        UPDATE shops SET last_sign_in_at = NOW() WHERE id = v_user.shop_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'session_token', v_session_token,
        'user', jsonb_build_object(
            'id',          v_user.id,
            'username',    v_user.username,
            'email',       COALESCE(v_user.email, ''),
            'role',        v_user.role,
            'shop_id',     v_user.shop_id,
            'branch_id',   v_branch_id,
            'permissions', COALESCE(v_user.permissions, '[]'::jsonb)
        ),
        'shop_config', jsonb_build_object(
            'plan_name',     COALESCE(v_shop.plan_name, 'ENTERPRISE'),
            'product_limit', COALESCE(v_shop.product_limit, 1000),
            'user_limit',    COALESCE(v_shop.user_limit, 10),
            'status',        COALESCE(v_shop.status, 'active')
        )
    );
END;
$$;

-- B. Switch Tenant / Branch Context RPC
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
    v_branch_id INTEGER;
BEGIN
    v_token := current_session_token();
    IF v_token IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated: No active session');
    END IF;

    SELECT user_id INTO v_user_id
    FROM sessions
    WHERE token = v_token AND expires_at > NOW();

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Session expired');
    END IF;

    -- Validate user has access or is superadmin
    IF NOT EXISTS (
        SELECT 1 FROM users WHERE id = v_user_id AND (role = 'superadmin' OR shop_id = p_target_shop_id)
    ) AND NOT EXISTS (
        SELECT 1 FROM shop_members WHERE user_id = v_user_id AND shop_id = p_target_shop_id AND is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied to target organization');
    END IF;

    v_branch_id := p_target_branch_id;
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id FROM branches WHERE shop_id = p_target_shop_id AND is_main = true LIMIT 1;
        IF v_branch_id IS NULL THEN
            SELECT id INTO v_branch_id FROM branches WHERE shop_id = p_target_shop_id LIMIT 1;
        END IF;
    END IF;

    UPDATE sessions
    SET shop_id = p_target_shop_id,
        branch_id = v_branch_id
    WHERE token = v_token;

    RETURN jsonb_build_object(
        'success', true,
        'shop_id', p_target_shop_id,
        'branch_id', v_branch_id
    );
END;
$$;

-- C. Update Shop Settings RPC
CREATE OR REPLACE FUNCTION update_shop_settings(
  p_shop_id INTEGER,
  p_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_invoice_footer TEXT DEFAULT NULL,
  p_quotation_footer TEXT DEFAULT NULL,
  p_print_size TEXT DEFAULT NULL,
  p_print_mode TEXT DEFAULT NULL,
  p_print_template TEXT DEFAULT NULL,
  p_wa_reminder_template TEXT DEFAULT NULL,
  p_wa_bill_template TEXT DEFAULT NULL,
  p_wa_reorder_template TEXT DEFAULT NULL,
  p_invoice_prefix TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shops WHERE id = p_shop_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shop not found');
  END IF;

  UPDATE shops SET
    name                 = COALESCE(p_name, name),
    phone                = COALESCE(p_phone, phone),
    address              = COALESCE(p_address, address),
    logo_url             = COALESCE(p_logo_url, logo_url),
    invoice_footer       = COALESCE(p_invoice_footer, invoice_footer),
    quotation_footer     = COALESCE(p_quotation_footer, quotation_footer),
    print_size           = COALESCE(p_print_size, print_size),
    print_mode           = COALESCE(p_print_mode, print_mode),
    print_template       = COALESCE(p_print_template, print_template),
    wa_reminder_template = COALESCE(p_wa_reminder_template, wa_reminder_template),
    wa_bill_template     = COALESCE(p_wa_bill_template, wa_bill_template),
    wa_reorder_template  = COALESCE(p_wa_reorder_template, wa_reorder_template),
    invoice_prefix       = COALESCE(p_invoice_prefix, invoice_prefix),
    updated_at           = NOW()
  WHERE id = p_shop_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- D. Atomic Phone Purchase RPC (Primary 7-param signature used by PhonePurchasePanel)
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

-- Backward-compatible overload for record_phone_purchase (6-parameter version)
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

-- E. Atomic POS Phone Sale RPC
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
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_branch_id INTEGER;
    v_sale_id INTEGER;
    v_existing_sale RECORD;
    v_item RECORD;
    v_locked_phone RECORD;
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

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, net_amount, paid_amount INTO v_existing_sale
        FROM sales
        WHERE idempotency_key = p_idempotency_key AND shop_id = v_shop_id;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'sale_id', v_existing_sale.id,
                'idempotent_replay', true
            );
        END IF;
    END IF;

    INSERT INTO sales (
        user_id, customer_id, shop_id, branch_id,
        total_amount, discount, net_amount, paid_amount, amount_paid,
        payment_method, payment_type, payment_details, idempotency_key, created_at
    ) VALUES (
        v_user_id, p_customer_id, v_shop_id, v_branch_id,
        p_total_amount, COALESCE(p_discount, 0), p_net_amount, p_paid_amount, p_paid_amount,
        p_payment_method, p_payment_method, p_payment_details, p_idempotency_key, NOW()
    )
    RETURNING id INTO v_sale_id;

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        type TEXT, product_id INTEGER, phone_id INTEGER,
        quantity NUMERIC, custom_price NUMERIC, imei_snapshot TEXT
    )
    LOOP
        IF v_item.phone_id IS NOT NULL THEN
            SELECT * INTO v_locked_phone
            FROM phones
            WHERE id = v_item.phone_id AND shop_id = v_shop_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Phone ID % not found in inventory', v_item.phone_id;
            END IF;

            IF v_locked_phone.status != 'in_stock' THEN
                RAISE EXCEPTION 'Phone % % (IMEI: %) is not available for sale (current status: %)',
                    v_locked_phone.brand, v_locked_phone.model, v_locked_phone.imei_1, v_locked_phone.status;
            END IF;

            UPDATE phones
            SET status = 'sold',
                sale_id = v_sale_id,
                updated_at = NOW()
            WHERE id = v_item.phone_id;

            INSERT INTO sale_items (
                sale_id, phone_id, quantity,
                unit_price, price, line_total, subtotal, imei_snapshot
            ) VALUES (
                v_sale_id, v_item.phone_id, 1,
                v_item.custom_price, v_item.custom_price, v_item.custom_price, v_item.custom_price,
                COALESCE(v_item.imei_snapshot, v_locked_phone.imei_1)
            );

            INSERT INTO phone_history (phone_id, shop_id, action, previous_status, new_status, actor_id, details)
            VALUES (v_item.phone_id, v_shop_id, 'SOLD', 'in_stock', 'sold', v_user_id,
                jsonb_build_object('sale_id', v_sale_id, 'sold_price', v_item.custom_price, 'customer_id', p_customer_id)
            );
        ELSE
            UPDATE products
            SET stock_quantity = stock_quantity - v_item.quantity,
                updated_at = NOW()
            WHERE id = v_item.product_id AND shop_id = v_shop_id;

            INSERT INTO sale_items (
                sale_id, product_id, quantity,
                unit_price, price, line_total, subtotal
            ) VALUES (
                v_sale_id, v_item.product_id, v_item.quantity,
                v_item.custom_price, v_item.custom_price,
                v_item.custom_price * v_item.quantity, v_item.custom_price * v_item.quantity
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id
    );
END;
$$;

-- F. Phone Custody RPCs
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
DECLARE
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_branch_id INTEGER;
    v_phone RECORD;
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

    SELECT * INTO v_phone
    FROM phones
    WHERE id = p_phone_id AND shop_id = v_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Phone not found in inventory');
    END IF;

    IF v_phone.status != 'in_stock' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Phone is not in stock (current status: ' || v_phone.status || ')');
    END IF;

    INSERT INTO phone_custody (
        shop_id, branch_id, phone_id, issue_type,
        recipient_name, recipient_phone, recipient_cnic,
        token_deposit, expected_return_date, notes,
        status, issued_by
    ) VALUES (
        v_shop_id, v_branch_id, p_phone_id, p_issue_type,
        p_recipient_name, p_recipient_phone, p_recipient_cnic,
        COALESCE(p_token_deposit, 0), p_expected_return_date, p_notes,
        'active', v_user_id
    )
    RETURNING id INTO v_custody_id;

    UPDATE phones SET status = 'in_custody', updated_at = NOW() WHERE id = p_phone_id;

    INSERT INTO phone_history (phone_id, shop_id, action, previous_status, new_status, actor_id, details)
    VALUES (p_phone_id, v_shop_id, 'CUSTODY_ISSUED', 'in_stock', 'in_custody', v_user_id,
        jsonb_build_object('custody_id', v_custody_id, 'issue_type', p_issue_type, 'recipient', p_recipient_name)
    );

    RETURN jsonb_build_object('success', true, 'custody_id', v_custody_id);
END;
$$;

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
    v_token UUID;
    v_user_id UUID;
    v_shop_id INTEGER;
    v_custody RECORD;
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

    SELECT * INTO v_custody
    FROM phone_custody
    WHERE phone_id = p_phone_id AND shop_id = v_shop_id AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active custody record found for this phone');
    END IF;

    UPDATE phone_custody
    SET status = 'returned',
        returned_at = NOW(),
        returned_by = v_user_id,
        notes = CASE WHEN p_notes IS NOT NULL THEN COALESCE(notes, '') || ' [Return note: ' || p_notes || ']' ELSE notes END,
        updated_at = NOW()
    WHERE id = v_custody.id;

    UPDATE phones SET status = 'in_stock', updated_at = NOW() WHERE id = p_phone_id;

    INSERT INTO phone_history (phone_id, shop_id, action, previous_status, new_status, actor_id, details)
    VALUES (p_phone_id, v_shop_id, 'CUSTODY_RETURNED', 'in_custody', 'in_stock', v_user_id,
        jsonb_build_object('custody_id', v_custody.id, 'recipient', v_custody.recipient_name)
    );

    RETURN jsonb_build_object('success', true, 'custody_id', v_custody.id);
END;
$$;

-- G. Cash Sessions RPCs
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
    v_existing_id INTEGER;
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

    SELECT id INTO v_existing_id
    FROM cash_sessions
    WHERE user_id = v_user_id AND shop_id = v_shop_id AND status = 'open'
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Active open drawer session already exists', 'session_id', v_existing_id);
    END IF;

    INSERT INTO cash_sessions (
        shop_id, branch_id, user_id, opening_cash, status, notes, opened_at
    ) VALUES (
        v_shop_id, v_branch_id, v_user_id, COALESCE(p_opening_cash, 0), 'open', p_notes, NOW()
    )
    RETURNING id INTO v_session_id;

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'opening_cash', COALESCE(p_opening_cash, 0), 'status', 'open');
END;
$$;

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

    SELECT COALESCE(SUM(paid_amount), 0) INTO v_cash_sales
    FROM sales
    WHERE shop_id = v_shop_id AND user_id = v_session.user_id
      AND (payment_method = 'cash' OR payment_type = 'cash')
      AND created_at >= v_session.opened_at;

    SELECT COALESCE(SUM(amount), 0) INTO v_cash_payments
    FROM customer_payments
    WHERE shop_id = v_shop_id AND user_id = v_session.user_id
      AND created_at >= v_session.opened_at;

    SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
    FROM expenses
    WHERE shop_id = v_shop_id AND created_at >= v_session.opened_at;

    v_expected := v_session.opening_cash + v_cash_sales + v_cash_payments - v_cash_expenses;
    v_variance := p_closing_cash_actual - v_expected;

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
        'closing_cash_expected', v_expected,
        'closing_cash_actual', p_closing_cash_actual,
        'variance', v_variance,
        'status', 'closed'
    );
END;
$$;

-- Grant execute permissions to API clients
GRANT EXECUTE ON FUNCTION secure_login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION switch_tenant_context(INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_shop_settings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_phone_purchase TO anon, authenticated;
GRANT EXECUTE ON FUNCTION process_phone_sale TO anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_phone_custody TO anon, authenticated;
GRANT EXECUTE ON FUNCTION return_phone_custody TO anon, authenticated;
GRANT EXECUTE ON FUNCTION open_cash_session TO anon, authenticated;
GRANT EXECUTE ON FUNCTION close_cash_session TO anon, authenticated;

-- ============================================================================
-- 4. BASELINE SEED DATA (CREATES INITIAL SHOP & ADMIN CREDENTIALS)
-- ============================================================================

-- Default Subscription Plan
INSERT INTO subscription_plans (id, name, price, product_limit, user_limit, branch_limit)
VALUES (1, 'Enterprise Unlimited', 0, 999999, 9999, 99)
ON CONFLICT (id) DO NOTHING;

-- Default Shop (ID: 1)
INSERT INTO shops (id, name, phone, address, email, status, plan_id, subscription_plan)
VALUES (1, 'EdgeX Mobile Store', '0300-1234567', 'Main Mobile Market, Lahore', 'shop@edgexpos.com', 'active', 1, 'Enterprise Unlimited')
ON CONFLICT (id) DO UPDATE SET status = 'active', plan_id = EXCLUDED.plan_id, subscription_plan = EXCLUDED.subscription_plan;

-- Default Main Branch (ID: 1)
INSERT INTO branches (id, shop_id, name, is_main, is_active)
VALUES (1, 1, 'Main Branch', true, true)
ON CONFLICT (id) DO NOTHING;

-- Baseline Users (Password for all accounts is: 1234)
-- SHA-256 for '1234': 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4

-- 1. Shop Admin / Owner (Username: admin, Password: 1234)
INSERT INTO users (username, email, password, role, shop_id, branch_id, is_active)
VALUES (
    'admin',
    'admin@edgexpos.com',
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    'owner',
    1,
    1,
    true
)
ON CONFLICT (username) DO UPDATE
SET password = EXCLUDED.password, role = 'owner', shop_id = 1, is_active = true;

-- 2. Platform Superadmin (Username: superadmin or babarjoya@gmail.com, Password: 1234)
INSERT INTO users (username, email, password, role, shop_id, branch_id, is_active)
VALUES (
    'superadmin',
    'babarjoya@gmail.com',
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    'superadmin',
    1,
    1,
    true
)
ON CONFLICT (username) DO UPDATE
SET password = EXCLUDED.password, role = 'superadmin', is_active = true;

-- 3. Shop Member Link (Dynamically linked to the actual admin user ID)
INSERT INTO shop_members (user_id, shop_id, default_branch_id, role, is_active)
SELECT id, 1, 1, 'owner', true
FROM users
WHERE username = 'admin'
ON CONFLICT (user_id, shop_id) DO NOTHING;

-- Default Categories
INSERT INTO categories (name, shop_id) VALUES
('Smart Phones', 1),
('Feature Phones', 1),
('Chargers & Adapters', 1),
('Cables & Data Leads', 1),
('Earphones & Audio', 1),
('Screen Protectors & Covers', 1)
ON CONFLICT DO NOTHING;

-- Default Units
INSERT INTO units (name, abbreviation, shop_id) VALUES
('Piece', 'Pcs', 1),
('Box', 'Box', 1),
('Set', 'Set', 1)
ON CONFLICT DO NOTHING;

-- Default Sample Supplier & Customer
INSERT INTO suppliers (name, phone, shop_id) VALUES ('Al-Madina Mobile Wholesale', '0321-7654321', 1) ON CONFLICT DO NOTHING;
INSERT INTO customers (name, phone, shop_id) VALUES ('Walk-In Customer', '0300-0000000', 1) ON CONFLICT DO NOTHING;

-- Demo Mobile Phones
INSERT INTO phones (shop_id, branch_id, imei_1, imei_2, brand, model, color, storage, condition, pta_status, status, cost_price, sale_price, battery_health)
VALUES
(1, 1, '354891110192834', '354891110192835', 'Apple', 'iPhone 15 Pro Max', 'Natural Titanium', '256GB', 'brand_new', 'approved', 'in_stock', 445000, 485000, 100),
(1, 1, '358921102938475', '358921102938476', 'Apple', 'iPhone 13', 'Midnight', '128GB', 'used', 'approved', 'in_stock', 135000, 152000, 88),
(1, 1, '359182390192847', '359182390192848', 'Samsung', 'Galaxy S24 Ultra', 'Titanium Black', '512GB', 'brand_new', 'approved', 'in_stock', 385000, 415000, 100),
(1, 1, '357192830192849', '357192830192850', 'Samsung', 'Galaxy A54 5G', 'Awesome Lime', '128GB', 'used', 'approved', 'in_stock', 88000, 98000, 94),
(1, 1, '864910293847561', '864910293847562', 'Xiaomi', 'Redmi Note 13 Pro', 'Ocean Teal', '256GB', 'brand_new', 'approved', 'in_stock', 62000, 71000, 100),
(1, 1, '862910394857201', '862910394857202', 'Infinix', 'Note 40 Pro', 'Vintage Green', '256GB', 'open_box', 'approved', 'in_stock', 54000, 62000, 100),
(1, 1, '356891029384712', '356891029384713', 'Google Pixel', 'Pixel 7 Pro', 'Obsidian', '128GB', 'used', 'cpid', 'in_stock', 92000, 108000, 89)
ON CONFLICT (shop_id, imei_1) DO NOTHING;

-- Demo Accessories Products
INSERT INTO products (name, brand, cost_price, sale_price, stock_quantity, low_stock_threshold, sku, barcode, shop_id)
VALUES
('Apple 20W USB-C Power Adapter (Original)', 'Apple', 4500, 6500, 25, 5, 'CHG-APL-20W', '194252157015', 1),
('Samsung 25W Super Fast Travel Charger (Type-C)', 'Samsung', 3200, 4800, 30, 5, 'CHG-SAM-25W', '880609012345', 1),
('Anker PowerLine III USB-C to Lightning Cable 1.8m', 'Anker', 1800, 2800, 40, 10, 'CAB-ANK-LGT', '848061034567', 1),
('Baseus 10000mAh Magnetic Wireless Power Bank 20W', 'Baseus', 5200, 7500, 12, 3, 'PB-BAS-10K', '695315620123', 1),
('iPhone 15 Pro 9D Tempered Glass Screen Protector', 'Apple', 250, 800, 85, 15, 'SCR-IP15P-9D', '958201928471', 1),
('Liquid Silicone MagSafe Case with Microfiber Lining', 'Apple', 450, 1500, 60, 10, 'CAS-MAG-SIL', '958201928472', 1),
('AirPods Pro 2 Wireless ANC Earbuds (Master Copy)', 'Apple', 3200, 5500, 20, 4, 'AUD-APP2-ANC', '194253397123', 1)
ON CONFLICT DO NOTHING;

-- Reset primary key sequences safely
DO $$ BEGIN
    IF pg_get_serial_sequence('shops', 'id') IS NOT NULL THEN
        PERFORM setval(pg_get_serial_sequence('shops', 'id'), COALESCE((SELECT MAX(id) FROM shops), 1));
    END IF;
    IF pg_get_serial_sequence('branches', 'id') IS NOT NULL THEN
        PERFORM setval(pg_get_serial_sequence('branches', 'id'), COALESCE((SELECT MAX(id) FROM branches), 1));
    END IF;
    IF pg_get_serial_sequence('categories', 'id') IS NOT NULL THEN
        PERFORM setval(pg_get_serial_sequence('categories', 'id'), COALESCE((SELECT MAX(id) FROM categories), 1));
    END IF;
    IF pg_get_serial_sequence('units', 'id') IS NOT NULL THEN
        PERFORM setval(pg_get_serial_sequence('units', 'id'), COALESCE((SELECT MAX(id) FROM units), 1));
    END IF;
END $$;

-- Grant PostgREST API permissions to anon and authenticated
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

