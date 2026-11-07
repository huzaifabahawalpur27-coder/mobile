-- ==============================================================================
-- FIX BANK ACCOUNTS & TRANSACTIONS: BIGINT IDs & TENANT ACCESS RLS POLICIES
-- ==============================================================================

-- 1. Ensure columns use BIGINT (supports high-volume transaction IDs)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'bank_accounts' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.bank_accounts ALTER COLUMN id TYPE BIGINT;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'bank_account_transactions' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.bank_account_transactions ALTER COLUMN id TYPE BIGINT;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'bank_account_transactions' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE public.bank_account_transactions ALTER COLUMN account_id TYPE BIGINT;
    END IF;
END $$;

-- 2. Enable RLS
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_transactions ENABLE ROW LEVEL SECURITY;

-- 3. Open tenant RLS policies for bank_accounts
DROP POLICY IF EXISTS bank_accounts_shop_access ON public.bank_accounts;
CREATE POLICY bank_accounts_shop_access ON public.bank_accounts
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. Open tenant RLS policies for bank_account_transactions
DROP POLICY IF EXISTS bank_account_txs_shop_access ON public.bank_account_transactions;
CREATE POLICY bank_account_txs_shop_access ON public.bank_account_transactions
    FOR ALL
    USING (true)
    WITH CHECK (true);
