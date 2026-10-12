-- ============================================================
-- SQL MIGRATION: BUSINESS BANK ACCOUNTS & TRANSACTIONS SCHEMA
-- ============================================================

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
    transaction_type TEXT NOT NULL, -- 'CREDIT', 'DEBIT'
    amount NUMERIC(15,2) NOT NULL,
    balance_before NUMERIC(15,2) NOT NULL,
    balance_after NUMERIC(15,2) NOT NULL,
    reference_type TEXT, -- 'PURCHASE', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'OPENING_BALANCE'
    reference_id TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bank_accounts_shop ON public.bank_accounts(shop_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_default ON public.bank_accounts(shop_id, is_default);
CREATE INDEX IF NOT EXISTS idx_bank_account_txs_account ON public.bank_account_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_account_txs_shop ON public.bank_account_transactions(shop_id);

-- Enable RLS
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_transactions ENABLE ROW LEVEL SECURITY;

-- Permissive policies for tenant access
DROP POLICY IF EXISTS bank_accounts_shop_access ON public.bank_accounts;
CREATE POLICY bank_accounts_shop_access ON public.bank_accounts
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bank_account_txs_shop_access ON public.bank_account_transactions;
CREATE POLICY bank_account_txs_shop_access ON public.bank_account_transactions
    FOR ALL USING (true) WITH CHECK (true);
