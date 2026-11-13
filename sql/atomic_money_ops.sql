-- ============================================================================
-- One-step money actions + links between payments and their bills. Safe to re-run.
-- Run AFTER: production_security_hardening.sql, atomic_stock_and_balances.sql,
--            atomic_bank_balance.sql
--
-- PART 1: columns
--   supplier_payments.purchase_id  the purchase bill a payment / refund belongs to
--   customer_payments.sale_id      the sale a return / refund note belongs to
--   expenses.account_id            the cash / bank account an expense was paid from
--   expenses.payment_method        (kept if already there)
--
-- PART 2: apply_money_op(p_op jsonb, p_op_id uuid)
--   A customer payment, a supplier payment, an expense or a sale return used to be
--   saved as several separate requests (the entry, the party's balance, the cash /
--   bank account, the stock). A dropped connection in the middle left them
--   disagreeing. This function applies ALL parts of one action in ONE transaction,
--   for the caller's own shop only: everything is saved, or nothing is.
--
--   p_op = {
--     "inserts":  [{"table": "customer_payments", "row": {...}}, ...],
--     "updates":  [{"table": "sales", "id": "12", "set": {...}}, ...],
--     "deletes":  [{"table": "expenses", "id": "7"}, ...],
--     "customer": {"id": 3, "delta": -500},       -- balance change (optional)
--     "supplier": {"id": 9, "delta": 1200},       -- balance change (optional)
--     "accounts": [{"account_id": 1, "delta": 500, "reference_type": "customer_payment",
--                   "reference_id": "3", "description": "..."}],
--     "stock":    [{"product_id": 44, "delta": 2}]
--   }
--   Only real columns of each table are written (older / newer schemas both work);
--   shop_id is always the caller's. p_op_id makes a retry (offline queue, lost reply)
--   apply once only.
-- ============================================================================

ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS purchase_id BIGINT;
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS sale_id BIGINT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS account_id BIGINT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_method TEXT;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON public.supplier_payments(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_sale ON public.customer_payments(sale_id) WHERE sale_id IS NOT NULL;

-- Internal: columns of a table that a JSON object may write (never id / shop_id)
CREATE OR REPLACE FUNCTION public.edgex_writable_cols(p_table TEXT, p_row JSONB)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = p_table
       AND c.column_name NOT IN ('id', 'shop_id') AND c.is_generated = 'NEVER'
       AND p_row ? c.column_name
$$;
REVOKE ALL ON FUNCTION public.edgex_writable_cols(TEXT, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_money_op(p_op JSONB, p_op_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_item JSONB;
    v_table TEXT;
    v_row JSONB;
    v_cols TEXT;
    v_id TEXT;
    v_out JSONB;
    v_count INTEGER;
    v_parent TEXT;
    v_parent_col TEXT;
    v_inserted JSONB := '[]'::jsonb;
    v_accounts JSONB := '[]'::jsonb;
    v_res JSONB;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF p_op IS NULL OR jsonb_typeof(p_op) <> 'object' THEN
        RAISE EXCEPTION 'Nothing to apply';
    END IF;
    IF NOT public.edgex_claim_op(p_op_id, v_shop, 'apply_money_op') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    -- 1. New entries
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_op -> 'inserts', '[]'::jsonb)) LOOP
        v_table := v_item ->> 'table';
        IF v_table NOT IN ('customer_payments', 'supplier_payments', 'expenses') THEN
            RAISE EXCEPTION 'Cannot insert into %', v_table;
        END IF;
        v_row := COALESCE(v_item -> 'row', '{}'::jsonb) - 'id' - 'shop_id';
        v_cols := public.edgex_writable_cols(v_table, v_row);
        IF v_cols IS NULL THEN
            RAISE EXCEPTION 'Nothing to insert into %', v_table;
        END IF;
        EXECUTE format('INSERT INTO public.%1$I (shop_id, %2$s) SELECT $2, %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) RETURNING to_jsonb(%1$I.*)',
                       v_table, v_cols)
           INTO v_out USING v_row, v_shop;
        v_inserted := v_inserted || jsonb_build_object('table', v_table, 'row', v_out);
    END LOOP;

    -- 2. Changes to existing records (own shop only)
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_op -> 'updates', '[]'::jsonb)) LOOP
        v_table := v_item ->> 'table';
        v_id := v_item ->> 'id';
        IF v_table NOT IN ('customer_payments', 'supplier_payments', 'expenses', 'sales', 'purchases', 'sale_items', 'purchase_items') THEN
            RAISE EXCEPTION 'Cannot update %', v_table;
        END IF;
        v_row := COALESCE(v_item -> 'set', '{}'::jsonb) - 'id' - 'shop_id';
        v_cols := public.edgex_writable_cols(v_table, v_row);
        IF v_cols IS NULL OR v_id IS NULL THEN
            RAISE EXCEPTION 'Nothing to update in %', v_table;
        END IF;
        IF v_table IN ('sale_items', 'purchase_items') THEN
            -- line tables belong to the shop through their bill
            v_parent := CASE v_table WHEN 'sale_items' THEN 'sales' ELSE 'purchases' END;
            v_parent_col := CASE v_table WHEN 'sale_items' THEN 'sale_id' ELSE 'purchase_id' END;
            EXECUTE format('UPDATE public.%1$I t SET (%2$s) = (SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1)) WHERE t.id::text = $2 AND EXISTS (SELECT 1 FROM public.%3$I b WHERE b.id = t.%4$I AND b.shop_id = $3)',
                           v_table, v_cols, v_parent, v_parent_col)
               USING v_row, v_id, v_shop;
        ELSE
            EXECUTE format('UPDATE public.%1$I t SET (%2$s) = (SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1)) WHERE t.id::text = $2 AND t.shop_id = $3',
                           v_table, v_cols)
               USING v_row, v_id, v_shop;
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count = 0 THEN
            RAISE EXCEPTION '% % not found in this shop', v_table, v_id USING ERRCODE = 'P0002';
        END IF;
    END LOOP;

    -- 3. Removed entries (own shop only)
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_op -> 'deletes', '[]'::jsonb)) LOOP
        v_table := v_item ->> 'table';
        v_id := v_item ->> 'id';
        IF v_table NOT IN ('customer_payments', 'supplier_payments', 'expenses') THEN
            RAISE EXCEPTION 'Cannot delete from %', v_table;
        END IF;
        EXECUTE format('DELETE FROM public.%I t WHERE t.id::text = $1 AND t.shop_id = $2', v_table)
           USING v_id, v_shop;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count = 0 THEN
            RAISE EXCEPTION '% % not found in this shop', v_table, v_id USING ERRCODE = 'P0002';
        END IF;
    END LOOP;

    -- 4. Customer / supplier balance
    IF COALESCE((p_op #>> '{customer,delta}')::numeric, 0) <> 0 THEN
        PERFORM public.edgex_adjust_party_balance('customers', (p_op #>> '{customer,id}')::bigint,
                                                  (p_op #>> '{customer,delta}')::numeric, NULL, 'apply_money_op');
    END IF;
    IF COALESCE((p_op #>> '{supplier,delta}')::numeric, 0) <> 0 THEN
        PERFORM public.edgex_adjust_party_balance('suppliers', (p_op #>> '{supplier,id}')::bigint,
                                                  (p_op #>> '{supplier,delta}')::numeric, NULL, 'apply_money_op');
    END IF;

    -- 5. Cash / bank accounts (statement entry written with the true before / after)
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_op -> 'accounts', '[]'::jsonb)) LOOP
        IF COALESCE((v_item ->> 'delta')::numeric, 0) <> 0 THEN
            v_res := public.adjust_bank_balance((v_item ->> 'account_id')::bigint, (v_item ->> 'delta')::numeric,
                                                v_item ->> 'reference_type', v_item ->> 'reference_id',
                                                v_item ->> 'description', NULL);
            v_accounts := v_accounts || jsonb_build_object(
                'account_id', (v_item ->> 'account_id')::bigint,
                'balance_after', v_res -> 'balance_after',
                'transaction', v_res -> 'transaction');
        END IF;
    END LOOP;

    -- 6. Stock
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_op -> 'stock', '[]'::jsonb)) LOOP
        IF COALESCE((v_item ->> 'delta')::numeric, 0) <> 0 THEN
            PERFORM public.adjust_product_stock((v_item ->> 'product_id')::bigint, (v_item ->> 'delta')::numeric, NULL);
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'inserted', v_inserted, 'accounts', v_accounts);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_money_op(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_money_op(JSONB, UUID) TO anon, authenticated;

-- ============================================================================
-- PART 3: check_bank_balances()
--   Compares each account's stored balance with what its own statement adds up to
--   (opening balance + money in - money out). A row with difference <> 0 means the
--   balance and the statement disagree and should be reviewed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_bank_balances()
RETURNS TABLE (account_id BIGINT, account_name TEXT, bank_name TEXT, stored_balance NUMERIC,
               statement_balance NUMERIC, difference NUMERIC, entries BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT a.id, a.account_name, a.bank_name,
           COALESCE(a.current_balance, 0),
           COALESCE(a.opening_balance, 0) + COALESCE(t.net, 0),
           COALESCE(a.current_balance, 0) - (COALESCE(a.opening_balance, 0) + COALESCE(t.net, 0)),
           COALESCE(t.n, 0)
      FROM public.bank_accounts a
      LEFT JOIN (
            SELECT x.account_id,
                   SUM(CASE WHEN lower(x.transaction_type) IN ('deposit', 'credit') THEN x.amount ELSE -x.amount END) AS net,
                   COUNT(*) AS n
              FROM public.bank_account_transactions x
             WHERE x.shop_id = public.current_user_shop_id()
               AND lower(COALESCE(x.reference_type, '')) <> 'opening_balance'
             GROUP BY x.account_id
           ) t ON t.account_id = a.id
     WHERE a.shop_id = public.current_user_shop_id()
     ORDER BY a.id
$$;
REVOKE ALL ON FUNCTION public.check_bank_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_bank_balances() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PART 4: bank / cash accounts are visible to their own shop only
--   Earlier setup scripts created these two tables with an open policy
--   (USING (true)), which let any shop read and change every other shop's accounts.
-- ============================================================================
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_account_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_accounts_shop_access ON public.bank_accounts;
DROP POLICY IF EXISTS tenant_session_scope ON public.bank_accounts;
CREATE POLICY tenant_session_scope ON public.bank_accounts
    FOR ALL TO anon, authenticated
    USING (shop_id = public.current_user_shop_id())
    WITH CHECK (shop_id = public.current_user_shop_id());

DROP POLICY IF EXISTS bank_account_txs_shop_access ON public.bank_account_transactions;
DROP POLICY IF EXISTS tenant_session_scope ON public.bank_account_transactions;
CREATE POLICY tenant_session_scope ON public.bank_account_transactions
    FOR ALL TO anon, authenticated
    USING (shop_id = public.current_user_shop_id())
    WITH CHECK (shop_id = public.current_user_shop_id());

NOTIFY pgrst, 'reload schema';
