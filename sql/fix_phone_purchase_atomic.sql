-- ============================================================================
-- record_phone_purchase: all-or-nothing, buy-backs included. Safe to re-run.
-- Replaces the version in fix_phone_repurchase_buyback.sql.
--
-- Why: the old version created the purchase first and then, when a later phone
-- was already in stock, did  RETURN jsonb_build_object('success', false, ...).
-- A RETURN does not undo anything, so the purchase and the phones before it
-- stayed saved; the app then saved the purchase again in another way.
--
-- Now:
--   * every phone is checked BEFORE anything is written (IMEI 1 and IMEI 2,
--     against stock and against the other phones in the same purchase);
--   * any problem RAISEs, so the whole purchase is rolled back;
--   * a phone the shop sold or returned earlier (buy-back) re-uses its record,
--     matched on either IMEI, so the app no longer needs its own buy-back path;
--   * the branch must belong to the caller's shop.
-- The supplier balance is still updated by the app (adjust_supplier_balance).
-- ============================================================================

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
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID;
    v_shop_id INTEGER;
    v_branch_id INTEGER;
    v_purchase_id INTEGER;
    v_phone JSONB;
    v_phone_id INTEGER;
    v_imei1 TEXT;
    v_imei2 TEXT;
    v_existing_id INTEGER;
    v_existing_status TEXT;
    v_seen TEXT[] := '{}';
    v_count INTEGER := 0;
BEGIN
    SELECT s.user_id, s.shop_id, s.branch_id
      INTO v_user_id, v_shop_id, v_branch_id
      FROM public.sessions s
     WHERE s.token::text = public.current_session_token()::text
       AND (s.expires_at IS NULL OR s.expires_at > now())
     LIMIT 1;
    IF v_shop_id IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;

    IF p_branch_id IS NOT NULL THEN
        IF to_regclass('public.branches') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND shop_id = v_shop_id) THEN
            RAISE EXCEPTION 'Branch % does not belong to this shop', p_branch_id;
        END IF;
        v_branch_id := p_branch_id;
    END IF;
    IF v_branch_id IS NULL AND to_regclass('public.branches') IS NOT NULL THEN
        SELECT id INTO v_branch_id FROM public.branches WHERE shop_id = v_shop_id AND is_main = true LIMIT 1;
    END IF;

    IF p_supplier_id IS NOT NULL THEN
        PERFORM 1 FROM public.suppliers WHERE id = p_supplier_id AND shop_id = v_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Supplier not found in this shop';
        END IF;
    END IF;

    IF p_phones IS NULL OR jsonb_typeof(p_phones) <> 'array' OR jsonb_array_length(p_phones) = 0 THEN
        RAISE EXCEPTION 'No phones provided in purchase cart';
    END IF;

    -- 1. Check every phone first; nothing is written until all are fine
    FOR v_phone IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
        v_imei1 := NULLIF(TRIM(COALESCE(v_phone->>'imei_1', '')), '');
        v_imei2 := NULLIF(TRIM(COALESCE(v_phone->>'imei_2', '')), '');
        IF v_imei1 IS NULL THEN
            RAISE EXCEPTION 'Every phone needs IMEI 1';
        END IF;
        IF v_imei1 = ANY (v_seen) OR (v_imei2 IS NOT NULL AND v_imei2 = ANY (v_seen)) THEN
            RAISE EXCEPTION 'IMEI % (or its second IMEI) appears twice in this purchase', v_imei1;
        END IF;
        v_seen := v_seen || v_imei1 || COALESCE(v_imei2, v_imei1);

        SELECT p.id, p.status INTO v_existing_id, v_existing_status
          FROM public.phones p
         WHERE p.shop_id = v_shop_id
           AND (p.imei_1 IN (v_imei1, v_imei2) OR p.imei_2 IN (v_imei1, v_imei2))
           AND p.status = 'in_stock'
         LIMIT 1;
        IF v_existing_id IS NOT NULL THEN
            RAISE EXCEPTION 'Phone with IMEI % is already in stock (phone #%)', v_imei1, v_existing_id USING ERRCODE = 'P0001';
        END IF;
    END LOOP;

    -- 2. Purchase header
    INSERT INTO public.purchases (shop_id, branch_id, user_id, supplier_id, total_amount, paid_amount, payment_method, remarks, created_at)
    VALUES (v_shop_id, v_branch_id, v_user_id, p_supplier_id, p_total_amount, p_paid_amount, p_payment_type, p_notes, now())
    RETURNING id INTO v_purchase_id;

    -- 3. Phones: re-use the record of a phone sold / returned earlier, else insert
    FOR v_phone IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
        v_imei1 := TRIM(v_phone->>'imei_1');
        v_imei2 := NULLIF(TRIM(COALESCE(v_phone->>'imei_2', '')), '');
        v_existing_id := NULL;
        SELECT p.id INTO v_existing_id
          FROM public.phones p
         WHERE p.shop_id = v_shop_id
           AND (p.imei_1 IN (v_imei1, v_imei2) OR p.imei_2 IN (v_imei1, v_imei2))
         ORDER BY (p.imei_1 = v_imei1) DESC, p.id DESC
         LIMIT 1
         FOR UPDATE;

        IF v_existing_id IS NOT NULL THEN
            UPDATE public.phones SET
                branch_id = v_branch_id,
                imei_2 = COALESCE(v_imei2, imei_2),
                brand = COALESCE(v_phone->>'brand', brand),
                model = COALESCE(v_phone->>'model', model),
                storage = COALESCE(v_phone->>'storage', storage),
                color = COALESCE(v_phone->>'color', color),
                condition = COALESCE(v_phone->>'condition', 'Used'),
                pta_status = COALESCE(v_phone->>'pta_status', pta_status),
                cost_price = COALESCE((v_phone->>'cost_price')::NUMERIC, cost_price),
                additional_costs = COALESCE((v_phone->>'additional_costs')::NUMERIC, 0),
                sale_price = COALESCE((v_phone->>'sale_price')::NUMERIC, sale_price),
                supplier_id = p_supplier_id,
                purchase_id = v_purchase_id,
                purchase_date = CURRENT_DATE,
                status = 'in_stock',
                sold_at = NULL,
                sale_id = NULL,
                notes = v_phone->>'notes',
                updated_at = now()
            WHERE id = v_existing_id
            RETURNING id INTO v_phone_id;
        ELSE
            INSERT INTO public.phones (
                shop_id, branch_id, imei_1, imei_2, brand, model, storage, color, condition, pta_status,
                cost_price, additional_costs, sale_price, supplier_id, purchase_id, purchase_date, status, notes
            ) VALUES (
                v_shop_id, v_branch_id, v_imei1, v_imei2,
                COALESCE(v_phone->>'brand', 'Unknown'), COALESCE(v_phone->>'model', 'Unknown Phone'),
                v_phone->>'storage', v_phone->>'color',
                COALESCE(v_phone->>'condition', 'Used'), COALESCE(v_phone->>'pta_status', 'PTA Approved'),
                COALESCE((v_phone->>'cost_price')::NUMERIC, 0), COALESCE((v_phone->>'additional_costs')::NUMERIC, 0),
                COALESCE((v_phone->>'sale_price')::NUMERIC, 0),
                p_supplier_id, v_purchase_id, CURRENT_DATE, 'in_stock', v_phone->>'notes'
            )
            RETURNING id INTO v_phone_id;
        END IF;

        INSERT INTO public.purchase_items (purchase_id, phone_id, quantity, unit_price, cost_price, total_price, subtotal)
        VALUES (v_purchase_id, v_phone_id, 1,
                COALESCE((v_phone->>'cost_price')::NUMERIC, 0), COALESCE((v_phone->>'cost_price')::NUMERIC, 0),
                COALESCE((v_phone->>'cost_price')::NUMERIC, 0), COALESCE((v_phone->>'cost_price')::NUMERIC, 0));
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'phones_count', v_count,
                              'total_amount', p_total_amount, 'paid_amount', p_paid_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_phone_purchase(INTEGER, INTEGER, JSONB, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
