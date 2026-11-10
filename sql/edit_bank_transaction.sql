-- ============================================================================
-- Correct a bank / cash account entry (Accounts > edit transaction). Safe to re-run.
-- Needs current_user_shop_id() (production_security_hardening.sql).
--
-- edit_bank_transaction(p_tx_id, p_amount, p_direction, p_account_id, p_description, p_reason)
--   p_direction: 'deposit' (money in) or 'withdrawal' (money out)
--   p_account_id: NULL keeps the account; another account of the shop moves the entry
--
-- In ONE transaction, for the caller's own shop only:
--   * the account balance changes by the difference only (e.g. a deposit of 50,000
--     corrected to 5,000 takes 45,000 off the balance; nothing else is touched);
--   * when the entry moves to another account, it is taken off the old account and
--     added to the new one;
--   * the running "balance after" of this entry and every later entry on the affected
--     accounts is shifted by the same amount, so statements stay consistent;
--   * the entry keeps a note of what it was, when it was corrected and why.
-- Transfers are refused: they have a matching entry on the other account, so a
-- one-sided edit would make the two accounts disagree.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edit_bank_transaction(
    p_tx_id BIGINT,
    p_amount NUMERIC,
    p_direction TEXT,
    p_account_id BIGINT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_tx public.bank_account_transactions%ROWTYPE;
    v_dir TEXT := lower(trim(COALESCE(p_direction, '')));
    v_old_acc BIGINT;
    v_new_acc BIGINT;
    v_old_effect NUMERIC;
    v_new_effect NUMERIC;
    v_delta NUMERIC;
    v_before NUMERIC;
    v_note TEXT;
    v_old_bal NUMERIC;
    v_new_bal NUMERIC;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be greater than 0';
    END IF;
    IF v_dir NOT IN ('deposit', 'withdrawal') THEN
        RAISE EXCEPTION 'Type must be deposit or withdrawal';
    END IF;
    IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Please give a reason for the correction';
    END IF;

    SELECT * INTO v_tx FROM public.bank_account_transactions
     WHERE id = p_tx_id AND shop_id = v_shop
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction % not found in this shop', p_tx_id USING ERRCODE = 'P0002';
    END IF;
    IF lower(COALESCE(v_tx.reference_type, '')) LIKE 'transfer%' THEN
        RAISE EXCEPTION 'Transfers cannot be edited here (the other account has a matching entry). Make a new transfer to correct it.';
    END IF;

    v_old_acc := v_tx.account_id;
    v_new_acc := COALESCE(p_account_id, v_tx.account_id);

    -- Lock both accounts (same order every time) and check they belong to the shop
    PERFORM 1 FROM public.bank_accounts
     WHERE id IN (v_old_acc, v_new_acc) AND shop_id = v_shop
     ORDER BY id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id = v_new_acc AND shop_id = v_shop) THEN
        RAISE EXCEPTION 'Account % not found in this shop', v_new_acc USING ERRCODE = 'P0002';
    END IF;

    v_old_effect := CASE WHEN lower(v_tx.transaction_type) IN ('deposit', 'credit') THEN v_tx.amount ELSE -v_tx.amount END;
    v_new_effect := CASE WHEN v_dir = 'deposit' THEN p_amount ELSE -p_amount END;

    IF v_new_acc = v_old_acc THEN
        v_delta := v_new_effect - v_old_effect;
        UPDATE public.bank_accounts SET current_balance = current_balance + v_delta, updated_at = now()
         WHERE id = v_old_acc
        RETURNING current_balance INTO v_new_bal;
        v_old_bal := v_new_bal;
        -- this entry: balance after moves; later entries: both balances move
        UPDATE public.bank_account_transactions
           SET balance_after = balance_after + v_delta,
               balance_before = CASE WHEN id = v_tx.id THEN balance_before ELSE balance_before + v_delta END
         WHERE account_id = v_old_acc
           AND (created_at, id) >= (v_tx.created_at, v_tx.id);
        v_before := v_tx.balance_before;
    ELSE
        v_delta := v_new_effect;
        -- take it off the old account
        UPDATE public.bank_accounts SET current_balance = current_balance - v_old_effect, updated_at = now()
         WHERE id = v_old_acc
        RETURNING current_balance INTO v_old_bal;
        UPDATE public.bank_account_transactions
           SET balance_before = balance_before - v_old_effect, balance_after = balance_after - v_old_effect
         WHERE account_id = v_old_acc AND (created_at, id) > (v_tx.created_at, v_tx.id);
        -- add it to the new account at the same point in its history
        UPDATE public.bank_accounts SET current_balance = current_balance + v_new_effect, updated_at = now()
         WHERE id = v_new_acc
        RETURNING current_balance INTO v_new_bal;
        UPDATE public.bank_account_transactions
           SET balance_before = balance_before + v_new_effect, balance_after = balance_after + v_new_effect
         WHERE account_id = v_new_acc AND (created_at, id) > (v_tx.created_at, v_tx.id);
        SELECT t.balance_after INTO v_before
          FROM public.bank_account_transactions t
         WHERE t.account_id = v_new_acc AND (t.created_at, t.id) < (v_tx.created_at, v_tx.id)
         ORDER BY t.created_at DESC, t.id DESC LIMIT 1;
        IF v_before IS NULL THEN
            SELECT COALESCE(opening_balance, 0) INTO v_before FROM public.bank_accounts WHERE id = v_new_acc;
        END IF;
    END IF;

    v_note := format(' [Corrected %s: was %s Rs. %s%s. Reason: %s]',
                     to_char(now(), 'YYYY-MM-DD HH24:MI'),
                     CASE WHEN v_old_effect >= 0 THEN 'deposit' ELSE 'withdrawal' END,
                     to_char(v_tx.amount, 'FM999,999,999,990.##'),
                     CASE WHEN v_new_acc <> v_old_acc THEN format(' in account #%s', v_old_acc) ELSE '' END,
                     trim(p_reason));

    UPDATE public.bank_account_transactions
       SET amount = p_amount,
           transaction_type = v_dir,
           account_id = v_new_acc,
           balance_before = CASE WHEN v_new_acc = v_old_acc THEN balance_before ELSE v_before END,
           balance_after = CASE WHEN v_new_acc = v_old_acc THEN balance_after ELSE v_before + v_new_effect END,
           description = COALESCE(NULLIF(trim(COALESCE(p_description, '')), ''), description, '') || v_note
     WHERE id = v_tx.id;

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_tx.id,
        'balance_change', v_delta,
        'account_id', v_new_acc,
        'account_balance', v_new_bal,
        'previous_account_id', CASE WHEN v_new_acc <> v_old_acc THEN v_old_acc END,
        'previous_account_balance', CASE WHEN v_new_acc <> v_old_acc THEN v_old_bal END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_bank_transaction(BIGINT, NUMERIC, TEXT, BIGINT, TEXT, TEXT) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
