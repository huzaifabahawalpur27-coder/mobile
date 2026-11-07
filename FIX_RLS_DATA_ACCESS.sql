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
DECLARE v_shop_id INTEGER;
BEGIN
    SELECT s.shop_id INTO v_shop_id
    FROM sessions s JOIN users u ON u.id = s.user_id AND u.is_active = true
    WHERE s.token = current_session_token() AND s.expires_at > NOW()
    LIMIT 1;
    RETURN v_shop_id;
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
BEGIN
    RETURN p_shop_id IS NOT NULL AND p_shop_id = current_user_shop_id();
END;
$$;

GRANT EXECUTE ON FUNCTION current_session_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION current_user_shop_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_valid_session(INTEGER) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Grant schema and table permissions
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION current_session_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION current_user_shop_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION is_valid_session(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION secure_login(TEXT, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Open sessions table RLS (prevents circular lockup)
-- ----------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sessions Access" ON sessions;
DROP POLICY IF EXISTS "Sessions Open Read" ON sessions;
DROP POLICY IF EXISTS "Sessions Open Access" ON sessions;
REVOKE ALL ON sessions FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Set up resilient RLS on all tenant-scoped tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    seq_name TEXT;
    policy_rec RECORD;
    tenant_tables TEXT[] := ARRAY[
        'categories', 'brands', 'units', 'products', 'phones', 'suppliers',
        'customers', 'sales', 'purchases', 'expenses', 'customer_payments',
        'supplier_payments', 'audit_logs', 'users', 'branches'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
            FOR policy_rec IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
                EXECUTE format('DROP POLICY %I ON public.%I', policy_rec.policyname, tbl);
            END LOOP;
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation" ON %I', tbl);
            EXECUTE format('DROP POLICY IF EXISTS "%s_tenant_isolation" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "Shop Self Access" ON %I', tbl);

            -- RLS Policy:
            -- Read/Update/Delete scoped to tenant shop
            -- Insert allows any valid record with a shop_id
            EXECUTE format('
                CREATE POLICY "Tenant Isolation" ON %I
                AS PERMISSIVE FOR ALL TO anon, authenticated
                USING (shop_id = current_user_shop_id())
                WITH CHECK (shop_id = current_user_shop_id())
            ', tbl);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO anon, authenticated', tbl);
            seq_name := pg_get_serial_sequence(format('public.%I', tbl), 'id');
            IF seq_name IS NOT NULL THEN
                EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq_name);
            END IF;
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Child tables without shop_id: purchase_items and sale_items
-- ----------------------------------------------------------------------------
DO $$ DECLARE policy_rec RECORD; seq_name TEXT; BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_items') THEN
        ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
        FOR policy_rec IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'purchase_items' LOOP
            EXECUTE format('DROP POLICY %I ON public.purchase_items', policy_rec.policyname);
        END LOOP;
        DROP POLICY IF EXISTS "Purchase Items Isolation" ON purchase_items;
        DROP POLICY IF EXISTS purchase_items_tenant_isolation ON purchase_items;
        CREATE POLICY "Purchase Items Isolation" ON purchase_items
        AS PERMISSIVE FOR ALL TO anon, authenticated
        USING (EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id AND p.shop_id = current_user_shop_id()))
        WITH CHECK (EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_items.purchase_id AND p.shop_id = current_user_shop_id()));
        GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_items TO anon, authenticated;
        seq_name := pg_get_serial_sequence('public.purchase_items', 'id');
        IF seq_name IS NOT NULL THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq_name); END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sale_items') THEN
        ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
        FOR policy_rec IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sale_items' LOOP
            EXECUTE format('DROP POLICY %I ON public.sale_items', policy_rec.policyname);
        END LOOP;
        DROP POLICY IF EXISTS "Sale Items Isolation" ON sale_items;
        DROP POLICY IF EXISTS sale_items_tenant_isolation ON sale_items;
        CREATE POLICY "Sale Items Isolation" ON sale_items
        AS PERMISSIVE FOR ALL TO anon, authenticated
        USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND s.shop_id = current_user_shop_id()))
        WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND s.shop_id = current_user_shop_id()));
        GRANT SELECT, INSERT, UPDATE, DELETE ON sale_items TO anon, authenticated;
        seq_name := pg_get_serial_sequence('public.sale_items', 'id');
        IF seq_name IS NOT NULL THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq_name); END IF;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Shops table policy
-- ----------------------------------------------------------------------------
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE policy_rec RECORD; BEGIN
    FOR policy_rec IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shops' LOOP
        EXECUTE format('DROP POLICY %I ON public.shops', policy_rec.policyname);
    END LOOP;
END $$;
DROP POLICY IF EXISTS "Shop Self Access" ON shops;
DROP POLICY IF EXISTS "Shop Self Read" ON shops;
DROP POLICY IF EXISTS "Tenant Isolation" ON shops;
CREATE POLICY "Shop Self Access" ON shops
AS PERMISSIVE FOR SELECT TO anon, authenticated
USING (id = current_user_shop_id());
GRANT SELECT ON shops TO anon, authenticated;

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
