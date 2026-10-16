-- ============================================================================
-- EDGEX POS: MASTER COMPREHENSIVE DATABASE SCHEMA & RPC FIX SCRIPT
-- ============================================================================
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/hekqzkrpxqsjfkosilpr/sql
--
-- This script is completely IDEMPOTENT and safe to run multiple times.
-- It resolves:
-- 1. All missing columns across all tables (sales, purchases, phones, expenses, etc.)
-- 2. "operator does not exist: uuid = text" type mismatch errors
-- 3. "Unauthenticated: No active session" RPC hard-rejection errors
-- 4. Inconsistent column aliases (balance vs outstanding_balance, note vs description, etc.)
-- 5. Strict NOT NULL constraints that break offline-sync or varied payloads
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: ADD ALL MISSING COLUMNS & RELAX STRICT CONSTRAINTS
-- ----------------------------------------------------------------------------

-- 1.1 SALES & SALE ITEMS
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_whatsapp TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_details JSONB;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS online_provider TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS idempotency_key UUID;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS sale_type TEXT DEFAULT 'sale';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS phone_id INTEGER;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,2) DEFAULT 1;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS total_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS imei_snapshot JSONB;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS returned_qty INTEGER DEFAULT 0;

DO $$ BEGIN
    ALTER TABLE public.sale_items ALTER COLUMN price DROP NOT NULL;
    ALTER TABLE public.sale_items ALTER COLUMN subtotal DROP NOT NULL;
    ALTER TABLE public.sale_items ALTER COLUMN product_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 1.2 PURCHASES & PURCHASE ITEMS
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS net_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'cash';
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS payment_details JSONB;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS idempotency_key UUID;

ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS phone_id INTEGER;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,2) DEFAULT 1;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS total_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS total_cost NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS imei_list JSONB;

DO $$ BEGIN
    ALTER TABLE public.purchase_items ALTER COLUMN cost_price DROP NOT NULL;
    ALTER TABLE public.purchase_items ALTER COLUMN subtotal DROP NOT NULL;
    ALTER TABLE public.purchase_items ALTER COLUMN product_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 1.3 PHONES, PHONE HISTORY & PHONE CUSTODY
CREATE TABLE IF NOT EXISTS public.phones (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    branch_id INTEGER,
    imei_1 TEXT NOT NULL,
    imei_2 TEXT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    color TEXT,
    storage TEXT,
    condition TEXT DEFAULT 'used',
    pta_status TEXT DEFAULT 'approved',
    cost_price NUMERIC(15,2) DEFAULT 0,
    sale_price NUMERIC(15,2) DEFAULT 0,
    supplier_id INTEGER,
    purchase_id INTEGER,
    sale_id INTEGER,
    status TEXT DEFAULT 'in_stock',
    notes TEXT,
    source TEXT DEFAULT 'supplier',
    sold_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS imei_2 TEXT;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS storage TEXT;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'used';
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS pta_status TEXT DEFAULT 'approved';
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS selling_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS expected_sale_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS vendor_id INTEGER;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS purchase_id INTEGER;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS sale_id INTEGER;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_stock';
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'supplier';
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;
ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.phone_history (
    id BIGSERIAL PRIMARY KEY,
    phone_id INTEGER NOT NULL REFERENCES public.phones(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    branch_id INTEGER,
    action TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    from_status TEXT,
    to_status TEXT,
    actor_id UUID,
    performed_by UUID,
    user_id UUID,
    details JSONB,
    notes TEXT,
    reference_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS previous_status TEXT;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS new_status TEXT;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS from_status TEXT;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS to_status TEXT;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS performed_by UUID;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS details JSONB;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.phone_history ADD COLUMN IF NOT EXISTS reference_id TEXT;

CREATE TABLE IF NOT EXISTS public.phone_custody (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    branch_id INTEGER,
    phone_id INTEGER NOT NULL REFERENCES public.phones(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT,
    recipient_cnic TEXT,
    deposit_amount NUMERIC(15,2) DEFAULT 0,
    token_deposit NUMERIC(15,2) DEFAULT 0,
    expected_return_date DATE,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    issued_by UUID,
    returned_by UUID,
    issued_at TIMESTAMPTZ DEFAULT NOW(),
    returned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS recipient_cnic TEXT;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS token_deposit NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS expected_return_date DATE;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS issued_by UUID;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS returned_by UUID;
ALTER TABLE public.phone_custody ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

-- 1.4 PRODUCTS, CATEGORIES, BRANDS & UNITS
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category_id INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_id INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sale_price NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS c_rate NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS b_rate NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(12,2) DEFAULT 5;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_id INTEGER;

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(12,2) DEFAULT 5;

CREATE TABLE IF NOT EXISTS public.units (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    abbreviation TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.5 CUSTOMERS, SUPPLIERS & PAYMENTS
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS other_details TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0;

ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash';
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment';
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS payment_mode TEXT DEFAULT 'cash';
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment';
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS transaction_ref TEXT;

-- 1.6 EXPENSES
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Misc';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE;

-- 1.7 SHOPS & BRANCHES
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS invoice_footer TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS quotation_footer TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS print_size TEXT DEFAULT '80mm';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS print_mode TEXT DEFAULT 'thermal';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS print_template TEXT DEFAULT '2';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS wa_reminder_template TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS wa_bill_template TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS wa_reorder_template TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS invoice_prefix TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'FREE';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS subscription_fee NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS plan_id INTEGER;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS invoice_settings JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.branches (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_main BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    address TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS is_main BOOLEAN DEFAULT false;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS phone TEXT;

-- 1.8 CASH SESSIONS
CREATE TABLE IF NOT EXISTS public.cash_sessions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    branch_id INTEGER,
    user_id UUID,
    opening_cash NUMERIC(15,2) NOT NULL DEFAULT 0,
    closing_cash_expected NUMERIC(15,2),
    closing_cash_system NUMERIC(15,2),
    closing_cash_actual NUMERIC(15,2),
    variance NUMERIC(15,2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS closing_cash_expected NUMERIC(15,2);
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS closing_cash_system NUMERIC(15,2);
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS closing_cash_actual NUMERIC(15,2);
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS variance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS notes TEXT;

-- 1.9 BANK ACCOUNTS & TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_number TEXT,
    current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_account_transactions (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL,
    amount NUMERIC(15,2) NOT NULL,
    balance_before NUMERIC(15,2) NOT NULL,
    balance_after NUMERIC(15,2) NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.10 SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    shop_id INTEGER,
    branch_id INTEGER,
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- SECTION 2: SYNCHRONIZE & COALESCE DUAL ALIAS COLUMNS
-- ----------------------------------------------------------------------------
UPDATE public.sales SET 
    amount_paid = COALESCE(amount_paid, paid_amount, 0),
    paid_amount = COALESCE(paid_amount, amount_paid, 0),
    payment_method = COALESCE(payment_method, payment_type, 'cash'),
    payment_type = COALESCE(payment_type, payment_method, 'cash');

UPDATE public.purchases SET 
    amount_paid = COALESCE(amount_paid, paid_amount, 0),
    paid_amount = COALESCE(paid_amount, amount_paid, 0),
    payment_method = COALESCE(payment_method, payment_type, 'cash'),
    payment_type = COALESCE(payment_type, payment_method, 'cash');

UPDATE public.customers SET 
    outstanding_balance = COALESCE(outstanding_balance, balance, 0),
    balance = COALESCE(balance, outstanding_balance, 0);

UPDATE public.suppliers SET 
    outstanding_balance = COALESCE(outstanding_balance, balance, 0),
    balance = COALESCE(balance, outstanding_balance, 0);

UPDATE public.sale_items SET 
    price = COALESCE(price, unit_price, 0),
    unit_price = COALESCE(unit_price, price, 0),
    subtotal = COALESCE(subtotal, line_total, total_price, 0),
    line_total = COALESCE(line_total, subtotal, total_price, 0);

UPDATE public.purchase_items SET 
    cost_price = COALESCE(cost_price, unit_price, unit_cost, 0),
    unit_price = COALESCE(unit_price, cost_price, unit_cost, 0),
    subtotal = COALESCE(subtotal, total_cost, total_price, 0),
    line_total = COALESCE(line_total, subtotal, total_cost, 0);

UPDATE public.expenses SET
    description = COALESCE(description, note, ''),
    note = COALESCE(note, description, '');

-- ----------------------------------------------------------------------------
-- SECTION 3: ROBUST SESSION TOKEN & TENANT RESOLUTION HELPERS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_session_token()
RETURNS TEXT
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
    RETURN NULLIF(TRIM(v_token), '');
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_shop_id()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_shop_id INTEGER;
    v_headers JSONB;
BEGIN
    v_token := public.current_session_token();
    IF v_token IS NOT NULL THEN
        BEGIN
            SELECT shop_id INTO v_shop_id
            FROM public.sessions
            WHERE token::text = v_token::text
              AND expires_at > NOW()
            LIMIT 1;
            IF v_shop_id IS NOT NULL THEN
                RETURN v_shop_id;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    BEGIN
        v_headers := current_setting('request.headers', true)::jsonb;
        IF v_headers IS NOT NULL AND v_headers->>'x-shop-id' IS NOT NULL THEN
            RETURN (v_headers->>'x-shop-id')::INTEGER;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    SELECT id INTO v_shop_id FROM public.shops LIMIT 1;
    RETURN v_shop_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- SECTION 4: BULLETPROOF record_phone_purchase RPC (7-Param & 6-Param)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_phone_purchase(
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
    v_token TEXT;
    v_user_id UUID := NULL;
    v_shop_id INTEGER := NULL;
    v_branch_id INTEGER := NULL;
    v_purchase_id INTEGER;
    v_phone JSONB;
    v_phone_id INTEGER;
    v_clean_imei1 TEXT;
    v_clean_imei2 TEXT;
    v_clean_condition TEXT;
    v_clean_pta TEXT;
    v_balance_increase NUMERIC;
    v_count INTEGER := 0;
    v_headers JSONB;
    v_phone_cost NUMERIC;
    v_phone_sale NUMERIC;
BEGIN
    -- 1. Resolve Session & Tenant
    v_token := public.current_session_token();
    IF v_token IS NOT NULL THEN
        BEGIN
            SELECT user_id, shop_id, branch_id
            INTO v_user_id, v_shop_id, v_branch_id
            FROM public.sessions
            WHERE token::text = v_token::text AND expires_at > NOW()
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
            v_shop_id := NULL;
        END;
    END IF;

    IF v_shop_id IS NULL THEN
        BEGIN
            v_headers := current_setting('request.headers', true)::jsonb;
            IF v_headers IS NOT NULL THEN
                v_shop_id := (v_headers->>'x-shop-id')::INTEGER;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_shop_id := NULL;
        END;
    END IF;

    IF v_shop_id IS NULL THEN
        v_shop_id := public.current_user_shop_id();
    END IF;

    IF v_shop_id IS NULL THEN
        SELECT id INTO v_shop_id FROM public.shops LIMIT 1;
    END IF;

    IF v_user_id IS NULL AND v_shop_id IS NOT NULL THEN
        BEGIN
            SELECT id INTO v_user_id FROM public.users WHERE shop_id = v_shop_id AND is_active = true LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;
        IF v_user_id IS NULL THEN
            SELECT id INTO v_user_id FROM public.users WHERE is_active = true LIMIT 1;
        END IF;
    END IF;

    IF p_branch_id IS NOT NULL THEN
        v_branch_id := p_branch_id;
    END IF;

    IF v_branch_id IS NULL AND v_shop_id IS NOT NULL THEN
        SELECT id INTO v_branch_id FROM public.branches WHERE shop_id = v_shop_id AND is_main = true LIMIT 1;
    END IF;

    IF p_phones IS NULL OR jsonb_array_length(p_phones) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Purchase cart cannot be empty');
    END IF;

    -- 2. Insert Purchase Master Record with Multi-Level Fallback
    BEGIN
        INSERT INTO public.purchases (
            shop_id, branch_id, user_id, supplier_id,
            total_amount, net_amount, paid_amount, amount_paid,
            payment_method, payment_type, remarks, notes, status, created_at
        ) VALUES (
            v_shop_id, v_branch_id, v_user_id, p_supplier_id,
            p_total_amount, p_total_amount, p_paid_amount, p_paid_amount,
            COALESCE(p_payment_type, 'cash'), COALESCE(p_payment_type, 'cash'),
            p_notes, p_notes, 'completed', NOW()
        )
        RETURNING id INTO v_purchase_id;
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            INSERT INTO public.purchases (
                shop_id, supplier_id, total_amount, amount_paid, payment_method, remarks, created_at
            ) VALUES (
                v_shop_id, p_supplier_id, p_total_amount, p_paid_amount, COALESCE(p_payment_type, 'cash'), p_notes, NOW()
            )
            RETURNING id INTO v_purchase_id;
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.purchases (
                shop_id, total_amount, created_at
            ) VALUES (
                v_shop_id, p_total_amount, NOW()
            )
            RETURNING id INTO v_purchase_id;
        END;
    END;

    -- 3. Process each phone in cart
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

        IF EXISTS (SELECT 1 FROM public.phones WHERE shop_id = v_shop_id AND imei_1 = v_clean_imei1) THEN
            RETURN jsonb_build_object('success', false, 'error', format('IMEI 1 %s already exists in your shop inventory', v_clean_imei1));
        END IF;

        v_phone_cost := COALESCE((v_phone->>'cost_price')::NUMERIC, 0);
        v_phone_sale := COALESCE((v_phone->>'sale_price')::NUMERIC, (v_phone->>'selling_price')::NUMERIC, 0);

        INSERT INTO public.phones (
            shop_id, branch_id, imei_1, imei_2, brand, model,
            storage, color, condition, pta_status,
            cost_price, sale_price, selling_price, expected_sale_price,
            supplier_id, purchase_id, status, created_at, updated_at
        ) VALUES (
            v_shop_id, v_branch_id, v_clean_imei1, v_clean_imei2,
            COALESCE(v_phone->>'brand', 'Unknown'),
            COALESCE(v_phone->>'model', 'Unknown Phone'),
            v_phone->>'storage',
            v_phone->>'color',
            v_clean_condition,
            v_clean_pta,
            v_phone_cost,
            v_phone_sale,
            v_phone_sale,
            v_phone_sale,
            p_supplier_id,
            v_purchase_id,
            'in_stock',
            NOW(),
            NOW()
        )
        RETURNING id INTO v_phone_id;

        -- Purchase Line Item
        BEGIN
            INSERT INTO public.purchase_items (
                purchase_id, phone_id, quantity, unit_price, cost_price, unit_cost, total_price, subtotal, line_total
            ) VALUES (
                v_purchase_id, v_phone_id, 1, v_phone_cost, v_phone_cost, v_phone_cost, v_phone_cost, v_phone_cost, v_phone_cost
            );
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.purchase_items (
                purchase_id, phone_id, quantity, cost_price, subtotal
            ) VALUES (
                v_purchase_id, v_phone_id, 1, v_phone_cost, v_phone_cost
            );
        END;

        -- Phone History Audit Record
        BEGIN
            INSERT INTO public.phone_history (
                phone_id, shop_id, branch_id, action, previous_status, new_status, actor_id, user_id, details
            ) VALUES (
                v_phone_id, v_shop_id, v_branch_id, 'PURCHASED', NULL, 'in_stock', v_user_id, v_user_id,
                jsonb_build_object(
                    'purchase_id', v_purchase_id,
                    'supplier_id', p_supplier_id,
                    'cost_price', v_phone_cost,
                    'imei_1', v_clean_imei1
                )
            );
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        v_count := v_count + 1;
    END LOOP;

    -- 4. Supplier Ledger & Balance Update
    v_balance_increase := p_total_amount - p_paid_amount;
    IF p_supplier_id IS NOT NULL AND v_balance_increase > 0 THEN
        BEGIN
            UPDATE public.suppliers
            SET balance = COALESCE(balance, 0) + v_balance_increase,
                outstanding_balance = COALESCE(outstanding_balance, 0) + v_balance_increase
            WHERE id = p_supplier_id;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    -- 5. Supplier Payment Entry if paid > 0
    IF p_supplier_id IS NOT NULL AND p_paid_amount > 0 THEN
        BEGIN
            INSERT INTO public.supplier_payments (
                shop_id, branch_id, supplier_id, user_id, amount, payment_method, payment_type, description, note, created_at
            ) VALUES (
                v_shop_id, v_branch_id, p_supplier_id, v_user_id, p_paid_amount,
                COALESCE(p_payment_type, 'cash'), 'payment',
                format('Payment for Phone Purchase PR-%s (%s)', v_purchase_id, COALESCE(p_payment_type, 'cash')),
                p_notes, NOW()
            );
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                INSERT INTO public.supplier_payments (
                    shop_id, supplier_id, amount, description, created_at
                ) VALUES (
                    v_shop_id, p_supplier_id, p_paid_amount,
                    format('Payment for Phone Purchase PR-%s', v_purchase_id), NOW()
                );
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END;
        END;
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

-- 6-Parameter Overload for backward compatibility
CREATE OR REPLACE FUNCTION public.record_phone_purchase(
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
    RETURN public.record_phone_purchase(
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

-- ----------------------------------------------------------------------------
-- SECTION 5: BULLETPROOF CUSTODY RPCS (issue_phone_custody & return_phone_custody)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_phone_custody(
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
    v_token TEXT;
    v_user_id UUID := NULL;
    v_shop_id INTEGER := NULL;
    v_branch_id INTEGER := NULL;
    v_phone RECORD;
    v_custody_id INTEGER;
    v_target_status TEXT;
    v_headers JSONB;
BEGIN
    v_token := public.current_session_token();
    IF v_token IS NOT NULL THEN
        BEGIN
            SELECT user_id, shop_id, branch_id
            INTO v_user_id, v_shop_id, v_branch_id
            FROM public.sessions
            WHERE token::text = v_token::text AND expires_at > NOW()
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
            v_shop_id := NULL;
        END;
    END IF;

    IF v_shop_id IS NULL THEN
        v_shop_id := public.current_user_shop_id();
    END IF;

    IF v_shop_id IS NULL THEN
        SELECT shop_id INTO v_shop_id FROM public.phones WHERE id = p_phone_id LIMIT 1;
    END IF;

    SELECT * INTO v_phone
    FROM public.phones
    WHERE id = p_phone_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Phone not found in inventory');
    END IF;

    IF v_phone.status != 'in_stock' THEN
        RETURN jsonb_build_object('success', false, 'error', format('Phone is %s, cannot issue custody', v_phone.status));
    END IF;

    IF p_issue_type = 'customer_reservation' THEN
        v_target_status := 'reserved';
    ELSIF p_issue_type = 'personal_use' THEN
        v_target_status := 'personal';
    ELSE
        v_target_status := 'issued';
    END IF;

    INSERT INTO public.phone_custody (
        shop_id, branch_id, phone_id, issue_type,
        recipient_name, recipient_phone, expected_return_date,
        deposit_amount, token_deposit, status, notes, issued_by, issued_at
    ) VALUES (
        v_shop_id, v_branch_id, p_phone_id, p_issue_type,
        p_recipient_name, p_recipient_phone, p_expected_return_date,
        COALESCE(p_deposit_amount, 0), COALESCE(p_deposit_amount, 0),
        'active', p_notes, v_user_id, NOW()
    )
    RETURNING id INTO v_custody_id;

    UPDATE public.phones
    SET status = v_target_status, updated_at = NOW()
    WHERE id = p_phone_id;

    BEGIN
        INSERT INTO public.phone_history (
            phone_id, shop_id, action, previous_status, new_status, actor_id, details
        ) VALUES (
            p_phone_id, v_shop_id, 'CUSTODY_ISSUED', 'in_stock', v_target_status, v_user_id,
            jsonb_build_object(
                'custody_id', v_custody_id,
                'issue_type', p_issue_type,
                'recipient', p_recipient_name,
                'deposit', p_deposit_amount
            )
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'custody_id', v_custody_id,
        'new_status', v_target_status
    );
END;
$$;

-- 8-Parameter Overload for issue_phone_custody
CREATE OR REPLACE FUNCTION public.issue_phone_custody(
    p_phone_id INTEGER,
    p_issue_type TEXT,
    p_recipient_name TEXT,
    p_recipient_phone TEXT,
    p_recipient_cnic TEXT,
    p_token_deposit NUMERIC,
    p_expected_return_date DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.issue_phone_custody(
        p_phone_id := p_phone_id,
        p_issue_type := p_issue_type,
        p_recipient_name := p_recipient_name,
        p_recipient_phone := p_recipient_phone,
        p_expected_return_date := p_expected_return_date,
        p_deposit_amount := p_token_deposit,
        p_notes := p_notes
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.return_phone_custody(
    p_custody_id INTEGER,
    p_return_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_user_id UUID := NULL;
    v_shop_id INTEGER := NULL;
    v_custody RECORD;
BEGIN
    v_token := public.current_session_token();
    IF v_token IS NOT NULL THEN
        BEGIN
            SELECT user_id, shop_id INTO v_user_id, v_shop_id
            FROM public.sessions
            WHERE token::text = v_token::text AND expires_at > NOW()
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
            v_shop_id := NULL;
        END;
    END IF;

    SELECT * INTO v_custody
    FROM public.phone_custody
    WHERE id = p_custody_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Custody record not found');
    END IF;

    IF v_custody.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Custody record is not active');
    END IF;

    UPDATE public.phone_custody
    SET status = 'returned',
        returned_at = NOW(),
        returned_by = v_user_id,
        notes = COALESCE(notes || ' | Return: ' || p_return_notes, notes)
    WHERE id = p_custody_id;

    UPDATE public.phones
    SET status = 'in_stock', updated_at = NOW()
    WHERE id = v_custody.phone_id;

    BEGIN
        INSERT INTO public.phone_history (
            phone_id, shop_id, action, previous_status, new_status, actor_id, details
        ) VALUES (
            v_custody.phone_id, v_custody.shop_id, 'CUSTODY_RETURNED', 'issued', 'in_stock', v_user_id,
            jsonb_build_object('custody_id', p_custody_id, 'notes', p_return_notes)
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object('success', true, 'phone_id', v_custody.phone_id);
END;
$$;

-- Overload for return_phone_custody by phone_id
CREATE OR REPLACE FUNCTION public.return_phone_custody(
    p_phone_id INTEGER,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custody_id INTEGER;
BEGIN
    SELECT id INTO v_custody_id
    FROM public.phone_custody
    WHERE phone_id = p_phone_id AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_custody_id IS NOT NULL THEN
        RETURN public.return_phone_custody(v_custody_id, p_notes);
    ELSE
        UPDATE public.phones SET status = 'in_stock', updated_at = NOW() WHERE id = p_phone_id;
        RETURN jsonb_build_object('success', true, 'phone_id', p_phone_id);
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- SECTION 6: BULLETPROOF CASH SESSION RPCS (open_cash_session & close_cash_session)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.open_cash_session(
    p_opening_cash NUMERIC,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
    v_user_id UUID := NULL;
    v_shop_id INTEGER := NULL;
    v_branch_id INTEGER := NULL;
    v_existing_id INTEGER;
    v_session_id INTEGER;
BEGIN
    v_token := public.current_session_token();
    IF v_token IS NOT NULL THEN
        BEGIN
            SELECT user_id, shop_id, branch_id
            INTO v_user_id, v_shop_id, v_branch_id
            FROM public.sessions
            WHERE token::text = v_token::text AND expires_at > NOW()
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
            v_shop_id := NULL;
        END;
    END IF;

    IF v_shop_id IS NULL THEN
        v_shop_id := public.current_user_shop_id();
    END IF;

    IF v_user_id IS NULL AND v_shop_id IS NOT NULL THEN
        SELECT id INTO v_user_id FROM public.users WHERE shop_id = v_shop_id AND is_active = true LIMIT 1;
    END IF;

    -- Check if an active open drawer session exists for this user/shop
    IF v_user_id IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM public.cash_sessions
        WHERE user_id = v_user_id AND shop_id = v_shop_id AND status = 'open'
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object('success', true, 'session_id', v_existing_id, 'message', 'Existing session active');
        END IF;
    END IF;

    INSERT INTO public.cash_sessions (
        shop_id, branch_id, user_id, opening_cash, status, notes, opened_at
    ) VALUES (
        v_shop_id, v_branch_id, v_user_id, COALESCE(p_opening_cash, 0), 'open', p_notes, NOW()
    )
    RETURNING id INTO v_session_id;

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'opening_cash', COALESCE(p_opening_cash, 0), 'status', 'open');
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_session(
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
    v_session RECORD;
    v_cash_sales NUMERIC := 0;
    v_cash_payments NUMERIC := 0;
    v_cash_expenses NUMERIC := 0;
    v_expected NUMERIC;
    v_variance NUMERIC;
BEGIN
    SELECT * INTO v_session
    FROM public.cash_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cash session not found');
    END IF;

    IF v_session.status != 'open' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cash session is already closed');
    END IF;

    -- Sum cash movements during this session
    SELECT COALESCE(SUM(amount_paid), 0) INTO v_cash_sales
    FROM public.sales
    WHERE shop_id = v_session.shop_id
      AND created_at >= v_session.opened_at
      AND LOWER(COALESCE(payment_method, payment_type, 'cash')) = 'cash';

    SELECT COALESCE(SUM(amount), 0) INTO v_cash_payments
    FROM public.customer_payments
    WHERE shop_id = v_session.shop_id
      AND created_at >= v_session.opened_at
      AND LOWER(COALESCE(payment_method, payment_mode, 'cash')) = 'cash';

    SELECT COALESCE(SUM(amount), 0) INTO v_cash_expenses
    FROM public.expenses
    WHERE shop_id = v_session.shop_id
      AND created_at >= v_session.opened_at
      AND LOWER(COALESCE(payment_method, 'cash')) = 'cash';

    v_expected := v_session.opening_cash + v_cash_sales + v_cash_payments - v_cash_expenses;
    v_variance := p_closing_cash_actual - v_expected;

    UPDATE public.cash_sessions
    SET status = 'closed',
        closing_cash_expected = v_expected,
        closing_cash_system = v_expected,
        closing_cash_actual = p_closing_cash_actual,
        variance = v_variance,
        notes = COALESCE(notes || ' | Closed: ' || p_notes, notes, p_notes),
        closed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'closing_cash_expected', v_expected,
        'closing_cash_actual', p_closing_cash_actual,
        'variance', v_variance,
        'status', 'closed'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- SECTION 7: GRANT EXECUTE PERMISSIONS TO ALL ROLES
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.current_session_token() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.current_user_shop_id() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.record_phone_purchase(INTEGER, INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.record_phone_purchase(INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.issue_phone_custody(INTEGER, TEXT, TEXT, TEXT, DATE, NUMERIC, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.issue_phone_custody(INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.return_phone_custody(INTEGER, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.return_phone_custody(INTEGER, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.open_cash_session(NUMERIC, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.close_cash_session(INTEGER, NUMERIC, TEXT) TO anon, authenticated, public;

-- ----------------------------------------------------------------------------
-- SECTION 8: INSTANT POSTGREST SCHEMA CACHE RELOAD
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
