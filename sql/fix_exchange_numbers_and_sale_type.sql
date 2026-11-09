-- ============================================================================
-- Exchange numbering per shop, trade-in resale price, sales.sale_type default
-- Safe to re-run. Each part prints a NOTICE saying what it changed.
--
-- 1. sales.sale_type: process_phone_sale and process_phone_exchange never set it.
--    Default it to 'sale' and fill in existing empty rows, so every screen that
--    filters on sale_type = 'sale' sees phone and exchange sales.
-- 2. process_phone_exchange (patched in place, whichever version is live):
--    a. exchange numbers were MAX(id) + 1 over ALL shops: two exchanges at once
--       could get the same number, and the number showed other shops' volume.
--       Now: next number within the shop, under a per-shop lock.
--    b. a traded-in phone went into stock with sale_price = trade-in value, so POS
--       offered it at cost. Now the resale price entered in the Exchange screen is
--       used; a bought-back phone without one keeps its previous price; otherwise
--       the trade-in value as before.
-- ============================================================================

-- 1. sale_type default + backfill
DO $$
DECLARE
    v_rows INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'sale_type') THEN
        RAISE NOTICE 'sales.sale_type does not exist: nothing to do';
        RETURN;
    END IF;
    EXECUTE 'ALTER TABLE public.sales ALTER COLUMN sale_type SET DEFAULT ''sale''';
    UPDATE public.sales SET sale_type = 'sale' WHERE sale_type IS NULL OR sale_type = '';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE 'sales.sale_type now defaults to ''sale''; % existing sale(s) without a type marked as sale', v_rows;
END;
$$;

-- 2. process_phone_exchange
DO $$
DECLARE
    r RECORD;
    v_def TEXT;
    v_new TEXT;
    v_changes TEXT[];
BEGIN
    FOR r IN
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'process_phone_exchange'
    LOOP
        v_def := pg_get_functiondef(r.oid);
        v_new := v_def;
        v_changes := '{}';

        -- a. per-shop exchange number
        IF v_new ~* 'SELECT\s+COALESCE\(\s*MAX\(\s*id\s*\)\s*,\s*0\s*\)\s*\+\s*1\s+INTO\s+v_seq_id\s+FROM\s+exchanges\s*;' THEN
            v_new := regexp_replace(v_new,
                'SELECT\s+COALESCE\(\s*MAX\(\s*id\s*\)\s*,\s*0\s*\)\s*\+\s*1\s+INTO\s+v_seq_id\s+FROM\s+exchanges\s*;',
                'PERFORM pg_advisory_xact_lock(hashtext(''edgex_exchange_number''), v_shop_id);
    SELECT COALESCE(MAX(NULLIF(regexp_replace(exchange_number, ''[^0-9]'', '''', ''g''), '''')::BIGINT), 0) + 1
      INTO v_seq_id FROM exchanges WHERE shop_id = v_shop_id;', 'i');
            v_changes := v_changes || 'per-shop exchange number'::TEXT;
        END IF;

        -- b1. buy-back of a known phone: resale price from the form, else keep the old one
        IF v_new ~* 'sale_price\s*=\s*v_unit_price\s*,' THEN
            v_new := regexp_replace(v_new, 'sale_price\s*=\s*v_unit_price\s*,',
                'sale_price = COALESCE(NULLIF(v_item->>''sale_price'', '''')::NUMERIC, NULLIF(sale_price, 0), v_unit_price),', 'gi');
            v_changes := v_changes || 'buy-back resale price'::TEXT;
        END IF;

        -- b2. new trade-in phone: values (... cost_price, additional_costs, sale_price ...)
        IF v_new ~* 'v_unit_price,(\s*)0,(\s*)v_unit_price,' THEN
            v_new := regexp_replace(v_new, 'v_unit_price,(\s*)0,(\s*)v_unit_price,',
                'v_unit_price,\1 0,\2 COALESCE(NULLIF(v_item->>''sale_price'', '''')::NUMERIC, v_unit_price),', 'i');
            v_changes := v_changes || 'new trade-in resale price'::TEXT;
        END IF;

        IF v_new = v_def THEN
            RAISE NOTICE '% left unchanged (already patched, or a different version)', r.oid::regprocedure;
        ELSE
            EXECUTE v_new;
            RAISE NOTICE '% patched: %', r.oid::regprocedure, array_to_string(v_changes, ', ');
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
