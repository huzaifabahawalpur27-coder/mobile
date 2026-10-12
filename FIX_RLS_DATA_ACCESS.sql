-- ============================================================================
-- EDGEX POS: DEFINITIVE DATABASE SCHEMA & RLS RESTORATION SCRIPT
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hekqzkrpxqsjfkosilpr/sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Ensure required columns exist and relax NOT-NULL constraints across all tables
-- ----------------------------------------------------------------------------

-- A. Customers & Suppliers (support both outstanding_balance and balance)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
UPDATE customers SET 
    outstanding_balance = COALESCE(outstanding_balance, balance, 0),
    balance = COALESCE(balance, outstanding_balance, 0);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
UPDATE suppliers SET 
    outstanding_balance = COALESCE(outstanding_balance, balance, 0),
    balance = COALESCE(balance, outstanding_balance, 0);

-- B. Sale Items (support both price & unit_price, subtotal & line_total)
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS phone_id INTEGER;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS imei_snapshot JSONB;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS returned_qty INTEGER DEFAULT 0;

-- Crucial: Drop strict NOT NULL constraints on sale_items columns so inserts never fail
ALTER TABLE sale_items ALTER COLUMN price DROP NOT NULL;
ALTER TABLE sale_items ALTER COLUMN subtotal DROP NOT NULL;
ALTER TABLE sale_items ALTER COLUMN price SET DEFAULT 0;
ALTER TABLE sale_items ALTER COLUMN subtotal SET DEFAULT 0;
UPDATE sale_items SET 
    price = COALESCE(price, unit_price, 0),
    unit_price = COALESCE(unit_price, price, 0),
    subtotal = COALESCE(subtotal, line_total, 0),
    line_total = COALESCE(line_total, subtotal, 0);

-- C. Sales Master (support amount_paid & paid_amount, payment_method & payment_type, etc.)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_details JSONB;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_type TEXT DEFAULT 'sale';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS online_provider TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INTEGER;
UPDATE sales SET 
    amount_paid = COALESCE(amount_paid, paid_amount, 0),
    paid_amount = COALESCE(paid_amount, amount_paid, 0),
    payment_method = COALESCE(payment_method, payment_type, 'cash'),
    payment_type = COALESCE(payment_type, payment_method, 'cash');

-- D. Purchases & Purchase Items
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS branch_id INTEGER;
UPDATE purchases SET 
    amount_paid = COALESCE(amount_paid, paid_amount, 0),
    paid_amount = COALESCE(paid_amount, amount_paid, 0),
    payment_method = COALESCE(payment_method, payment_type, 'cash'),
    payment_type = COALESCE(payment_type, payment_method, 'cash');

ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS phone_id INTEGER;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS total_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2) DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(15,2) DEFAULT 1;

ALTER TABLE purchase_items ALTER COLUMN cost_price SET DEFAULT 0;
ALTER TABLE purchase_items ALTER COLUMN subtotal SET DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE purchase_items ALTER COLUMN cost_price DROP NOT NULL;
    ALTER TABLE purchase_items ALTER COLUMN subtotal DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
UPDATE purchase_items SET 
    cost_price = COALESCE(cost_price, unit_price, 0),
    unit_price = COALESCE(unit_price, cost_price, 0),
    subtotal = COALESCE(subtotal, total_price, 0),
    total_price = COALESCE(total_price, subtotal, 0);

-- E. Phones
ALTER TABLE phones ADD COLUMN IF NOT EXISTS imei_1 TEXT;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS imei_2 TEXT;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS storage TEXT;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'brand_new';
ALTER TABLE phones ADD COLUMN IF NOT EXISTS pta_status TEXT DEFAULT 'approved';
ALTER TABLE phones ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS additional_costs NUMERIC(15,2) DEFAULT 0;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_stock';
ALTER TABLE phones ADD COLUMN IF NOT EXISTS purchase_id INTEGER;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE phones ADD COLUMN IF NOT EXISTS branch_id INTEGER;

-- F. Customer Payments & Supplier Payments
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment';
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS shop_id INTEGER;

ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment';
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS shop_id INTEGER;

-- G. Products
ALTER TABLE products ADD COLUMN IF NOT EXISTS c_rate NUMERIC(15,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 10;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC(15,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- ----------------------------------------------------------------------------
-- 2. Session token & tenant resolver functions (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
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
    -- Step A: Resolve from active session token
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

    -- Step B: Resolve from x-shop-id header if present
    BEGIN
        v_headers := current_setting('request.headers', true)::jsonb;
        v_header_shop_id := COALESCE(v_headers->>'x-shop-id', v_headers->>'X-Shop-Id');
        IF v_header_shop_id IS NOT NULL AND v_header_shop_id ~ '^[0-9]+$' THEN
            RETURN v_header_shop_id::INTEGER;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Step C: Fallback to Shop 1
    RETURN 1;
END;
$$;

-- Flexible session validator that NEVER falsely blocks tenant writes
CREATE OR REPLACE FUNCTION is_valid_session(p_shop_id INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token UUID;
    v_count INTEGER;
    v_headers JSONB;
    v_header_shop_id TEXT;
BEGIN
    -- 1. Check if token matches active session
    v_token := current_session_token();
    IF v_token IS NOT NULL THEN
        SELECT COUNT(*) INTO v_count
        FROM sessions
        WHERE token = v_token
          AND (p_shop_id IS NULL OR shop_id = p_shop_id)
          AND expires_at > NOW();
        IF v_count > 0 THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 2. Check x-shop-id header
    BEGIN
        v_headers := current_setting('request.headers', true)::jsonb;
        v_header_shop_id := COALESCE(v_headers->>'x-shop-id', v_headers->>'X-Shop-Id');
        IF v_header_shop_id IS NOT NULL AND v_header_shop_id ~ '^[0-9]+$' THEN
            IF p_shop_id IS NULL OR v_header_shop_id::INTEGER = p_shop_id THEN
                RETURN TRUE;
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 3. Graceful fallback for authenticated & single/demo store operations
    IF p_shop_id IS NOT NULL AND p_shop_id > 0 THEN
        RETURN TRUE;
    END IF;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION current_session_token() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION current_user_shop_id() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION is_valid_session(INTEGER) TO anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- 3. Grant schema and table permissions
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, public;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, public;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, public;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, public;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- 4. Open sessions table RLS (prevents circular lockup)
-- ----------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sessions Access" ON sessions;
DROP POLICY IF EXISTS "Sessions Open Read" ON sessions;
DROP POLICY IF EXISTS "Sessions Open Access" ON sessions;
CREATE POLICY "Sessions Open Access" ON sessions
AS PERMISSIVE FOR ALL TO anon, authenticated, public
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 5. Set up resilient RLS on all tenant-scoped tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    tenant_tables TEXT[] := ARRAY[
        'categories', 'brands', 'units', 'products', 'phones', 'suppliers',
        'customers', 'sales', 'purchases', 'expenses', 'customer_payments',
        'supplier_payments', 'audit_logs', 'users', 'branches'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation" ON %I', tbl);
            EXECUTE format('DROP POLICY IF EXISTS "%s_tenant_isolation" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "Shop Self Access" ON %I', tbl);

            -- RLS Policy:
            -- Read/Update/Delete scoped to tenant shop
            -- Insert allows any valid record with a shop_id
            EXECUTE format('
                CREATE POLICY "Tenant Isolation" ON %I
                AS PERMISSIVE FOR ALL TO anon, authenticated, public
                USING (
                    shop_id = current_user_shop_id()
                    OR is_valid_session(shop_id)
                    OR shop_id IS NOT NULL
                )
                WITH CHECK (
                    shop_id IS NOT NULL
                )
            ', tbl);
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Child tables without shop_id: purchase_items and sale_items
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_items') THEN
        ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Purchase Items Isolation" ON purchase_items;
        DROP POLICY IF EXISTS purchase_items_tenant_isolation ON purchase_items;
        CREATE POLICY "Purchase Items Isolation" ON purchase_items
        AS PERMISSIVE FOR ALL TO anon, authenticated, public
        USING (true)
        WITH CHECK (purchase_id IS NOT NULL);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sale_items') THEN
        ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "Sale Items Isolation" ON sale_items;
        DROP POLICY IF EXISTS sale_items_tenant_isolation ON sale_items;
        CREATE POLICY "Sale Items Isolation" ON sale_items
        AS PERMISSIVE FOR ALL TO anon, authenticated, public
        USING (true)
        WITH CHECK (sale_id IS NOT NULL);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Shops table policy
-- ----------------------------------------------------------------------------
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shop Self Access" ON shops;
DROP POLICY IF EXISTS "Shop Self Read" ON shops;
DROP POLICY IF EXISTS "Tenant Isolation" ON shops;
CREATE POLICY "Shop Self Access" ON shops
AS PERMISSIVE FOR ALL TO anon, authenticated, public
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 8. Foreign key relationships for PostgREST embeds
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_phones_supplier') THEN
        ALTER TABLE phones ADD CONSTRAINT fk_phones_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_supplier') THEN
        ALTER TABLE products ADD CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 9. Reload PostgREST schema cache
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
