-- ============================================================================
-- Atomic bank / cash account balance changes. Safe to re-run.
-- Needs current_user_shop_id() (production_security_hardening.sql).
--
-- Why: the app used to read an account's balance, add or subtract in the browser and
-- write the result back as an absolute number, then insert the statement entry in a
-- second request. Two devices (or two payments saved close together) overwrote each
-- other, an offline change was never sent to the server, and the statement's
-- "balance before / after" could disagree with the account.
--
-- adjust_bank_balance(p_account_id, p_delta, p_reference_type, p_reference_id,
--                     p_description, p_op_id)
--   p_delta > 0 money in (deposit), p_delta < 0 money out (withdrawal)
-- In ONE transaction, for the caller's own shop only: locks the account, moves the
-- balance by p_delta and writes the statement entry with the true before / after.
-- p_op_id (uuid, optional) makes the call idempotent: an offline retry of the same
-- operation is recognised and not applied twice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.atomic_op_log (
    op_id      UUID PRIMARY KEY,
    shop_id    INTEGER,
    fn         TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.atomic_op_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atomic_op_log FROM PUBLIC;
DO $$ BEGIN
    EXECUTE 'REVOKE ALL ON public.atomic_op_log FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Same helper as sql/atomic_stock_and_balances.sql (kept identical so either file can run first)
CREATE OR REPLACE FUNCTION public.edgex_claim_op(p_op_id UUID, p_shop_id INTEGER, p_fn TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_op_id IS NULL THEN
        RETURN TRUE;
    END IF;
    INSERT INTO public.atomic_op_log (op_id, shop_id, fn) VALUES (p_op_id, p_shop_id, p_fn)
    ON CONFLICT (op_id) DO NOTHING;
    RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.edgex_claim_op(UUID, INTEGER, TEXT) FROM PUBLIC;
DO $$ BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.edgex_claim_op(UUID, INTEGER, TEXT) FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.adjust_bank_balance(
    p_account_id BIGINT,
    p_delta NUMERIC,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_op_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_before NUMERIC;
    v_after NUMERIC;
    v_tx public.bank_account_transactions%ROWTYPE;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 THEN
        RETURN jsonb_build_object('success', true, 'unchanged', true);
    END IF;

    -- Lock the account first, so two changes at once queue up instead of overwriting
    SELECT COALESCE(current_balance, 0) INTO v_before
      FROM public.bank_accounts
     WHERE id = p_account_id AND shop_id = v_shop
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account % not found in this shop', p_account_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.edgex_claim_op(p_op_id, v_shop, 'adjust_bank_balance') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'balance_after', v_before);
    END IF;

    v_after := v_before + p_delta;
    UPDATE public.bank_accounts
       SET current_balance = v_after, updated_at = now()
     WHERE id = p_account_id;

    INSERT INTO public.bank_account_transactions
        (shop_id, account_id, transaction_type, amount, balance_before, balance_after,
         reference_type, reference_id, description)
    VALUES
        (v_shop, p_account_id,
         CASE WHEN p_delta > 0 THEN 'deposit' ELSE 'withdrawal' END,
         abs(p_delta), v_before, v_after,
         lower(COALESCE(NULLIF(trim(p_reference_type), ''), 'manual')),
         NULLIF(trim(COALESCE(p_reference_id, '')), ''),
         NULLIF(trim(COALESCE(p_description, '')), ''))
    RETURNING * INTO v_tx;

    RETURN jsonb_build_object(
        'success', true,
        'balance_before', v_before,
        'balance_after', v_after,
        'transaction', to_jsonb(v_tx)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_bank_balance(BIGINT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_bank_balance(BIGINT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
