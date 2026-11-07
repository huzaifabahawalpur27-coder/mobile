-- ============================================================
-- PHASE 7 MIGRATION: PHONE TRADE-IN & EXCHANGE WORKFLOW
-- ============================================================

-- 0. Helper Functions (Session & Multitenancy Resolvers)
CREATE OR REPLACE FUNCTION public.current_session_token()
RETURNS uuid
LANGUAGE plpgsql STABLE
AS $token$
DECLARE
  raw_token text;
BEGIN
  raw_token := COALESCE(
    current_setting('request.headers', true)::json->>'x-session-token',
    current_setting('request.headers', true)::json->>'x-auth-token'
  );
  IF raw_token IS NULL OR raw_token = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw_token::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$token$;

CREATE OR REPLACE FUNCTION public.current_user_shop_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $shop$
  SELECT s.shop_id
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id AND COALESCE(u.is_active, true) = true
  WHERE s.token::text = public.current_session_token()::text
    AND (s.expires_at IS NULL OR s.expires_at > now())
  LIMIT 1
$shop$;

GRANT EXECUTE ON FUNCTION public.current_session_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_shop_id() TO anon, authenticated;

-- 1. Table: exchanges (Master Aggregate)
CREATE TABLE IF NOT EXISTS public.exchanges (
    id SERIAL PRIMARY KEY,
    exchange_number TEXT NOT NULL,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES public.branches(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT,
    customer_phone TEXT,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sale_id INTEGER REFERENCES public.sales(id) ON DELETE SET NULL,
    purchase_id INTEGER REFERENCES public.purchases(id) ON DELETE SET NULL,
    sale_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    trade_in_credit NUMERIC(15,2) NOT NULL DEFAULT 0,
    settlement_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    settlement_direction TEXT NOT NULL CHECK (settlement_direction IN ('customer_paid', 'shop_payout', 'even')),
    settlement_payment_method TEXT,
    settlement_payment_details JSONB,
    settlement_account_id BIGINT REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
    settlement_paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
    notes TEXT,
    idempotency_key UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    void_reason TEXT
);

-- 2. Table: exchange_items (Snapshots of traded-in and outgoing items)
CREATE TABLE IF NOT EXISTS public.exchange_items (
    id BIGSERIAL PRIMARY KEY,
    exchange_id INTEGER NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    item_direction TEXT NOT NULL CHECK (item_direction IN ('incoming_trade_in', 'outgoing_sale')),
    phone_id INTEGER REFERENCES public.phones(id) ON DELETE SET NULL,
    product_id INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    imei_1 TEXT,
    imei_2 TEXT,
    brand TEXT,
    model TEXT,
    storage TEXT,
    color TEXT,
    condition TEXT,
    pta_status TEXT,
    assessed_value NUMERIC(15,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(15,2) DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes TEXT,
    inspection_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Extend existing tables for cross-linkage and trade-in flags
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS exchange_id INTEGER REFERENCES public.exchanges(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS trade_in_amount NUMERIC(15,2) DEFAULT 0;

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS exchange_id INTEGER REFERENCES public.exchanges(id) ON DELETE SET NULL;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS is_trade_in BOOLEAN DEFAULT false;

ALTER TABLE public.phones ADD COLUMN IF NOT EXISTS exchange_id INTEGER REFERENCES public.exchanges(id) ON DELETE SET NULL;

-- 4. Indexes for query and filtering performance
CREATE INDEX IF NOT EXISTS idx_exchanges_shop_id ON public.exchanges(shop_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_branch_id ON public.exchanges(branch_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_customer_id ON public.exchanges(customer_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_status ON public.exchanges(status);
CREATE INDEX IF NOT EXISTS idx_exchanges_idempotency ON public.exchanges(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_exchanges_created_at ON public.exchanges(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_items_exchange_id ON public.exchange_items(exchange_id);
CREATE INDEX IF NOT EXISTS idx_exchange_items_shop_id ON public.exchange_items(shop_id);
CREATE INDEX IF NOT EXISTS idx_exchange_items_phone_id ON public.exchange_items(phone_id);
CREATE INDEX IF NOT EXISTS idx_exchange_items_direction ON public.exchange_items(item_direction);

-- 5. Enable RLS
ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchanges_shop_access ON public.exchanges;
CREATE POLICY exchanges_shop_access ON public.exchanges
    FOR ALL USING (
        shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL
    )
    WITH CHECK (
        shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL
    );

DROP POLICY IF EXISTS exchange_items_shop_access ON public.exchange_items;
CREATE POLICY exchange_items_shop_access ON public.exchange_items
    FOR ALL USING (
        shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL
    )
    WITH CHECK (
        shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL
    );
