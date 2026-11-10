-- ============================================================================
-- URGENT REPAIR: function permissions removed by production_security_hardening.sql
-- Safe to re-run. Run it now, and again after any re-run of the hardening script.
--
-- production_security_hardening.sql grants current_user_shop_id() & co. (line ~48)
-- and then runs  REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM ... anon ...
-- (line ~97), re-granting only 11 named functions. Every row-level-security policy
-- calls current_user_shop_id(), so afterwards EVERY query on sales, products,
-- customers, whatsapp_queue, ... fails with
--   42501 permission denied for function current_user_shop_id
-- for customers and logged-in staff alike (the app always uses the anon role with
-- a session header). Functions such as process_phone_exchange were blocked too.
--
-- This script grants EXECUTE (to anon, authenticated) on:
--   1. the session helpers the RLS policies call;
--   2. every function the app calls that is safe to expose:
--        - SECURITY INVOKER functions (RLS still applies), or
--        - SECURITY DEFINER functions that check the caller's session
--          (current_user_shop_id / is_valid_session / current_session_token), or
--        - the reviewed public entry points (login, public bill, etc.).
-- It deliberately does NOT grant the platform-wide analytics functions
-- (get_top_performing_shops, get_inactive_shops, get_global_growth_stats): they read
-- every shop's data and are served to superadmin through the server.
-- Any other SECURITY DEFINER function without a session check is listed in a NOTICE
-- for review instead of being granted.
-- ============================================================================

DO $$
DECLARE
    r RECORD;
    v_granted TEXT[] := '{}';
    v_held TEXT[] := '{}';
    v_missing TEXT[];
    v_session_helpers TEXT[] := ARRAY['current_session_token', 'current_user_shop_id', 'is_valid_session'];
    -- Every function the app calls (src/ and superadmin/src/, Nov 2026), plus helpers
    v_app_functions TEXT[] := ARRAY[
        'secure_login', 'switch_tenant_context', 'get_shop_status', 'get_shop_config', 'update_shop_settings',
        'open_cash_session', 'close_cash_session', 'issue_phone_custody', 'return_phone_custody',
        'process_phone_sale', 'record_phone_purchase', 'process_phone_exchange', 'void_phone_exchange',
        'get_public_invoice', 'edgex_try_jsonb', 'edgex_num',
        'allocate_sale_line_fifo', 'return_sale_item_batches', 'adjust_batch_stock', 'adjust_batch_cost',
        'void_purchase_batches', 'check_purchase_batches_before_void', 'get_fifo_inventory_valuation',
        'convert_product_to_batch_tracking', 'preview_product_batch_conversion', 'revert_product_batch_conversion',
        'reconcile_product_batches', 'update_product_stock',
        'get_dashboard_stats', 'get_top_products', 'get_revenue_trend', 'get_daily_sales_summary',
        'adjust_product_stock', 'adjust_customer_balance', 'adjust_supplier_balance', 'mark_phone_sold',
        'process_pos_sale', 'receive_purchase_stock', 'edit_bank_transaction'
    ];
    -- Reviewed entry points that are meant to be callable without/before a shop session
    -- (they were already in the hardening script's own re-grant list, or are the public bill)
    v_reviewed_public TEXT[] := ARRAY[
        'secure_login', 'switch_tenant_context', 'get_shop_status', 'get_shop_config', 'update_shop_settings',
        'open_cash_session', 'close_cash_session', 'issue_phone_custody', 'return_phone_custody',
        'process_phone_sale', 'record_phone_purchase', 'get_public_invoice', 'edgex_try_jsonb', 'edgex_num'
    ];
    v_admin_only TEXT[] := ARRAY['get_top_performing_shops', 'get_inactive_shops', 'get_global_growth_stats'];
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig, p.proname, p.prosecdef, p.prosrc
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname = ANY (v_session_helpers) OR p.proname = ANY (v_app_functions))
        ORDER BY p.proname
    LOOP
        IF r.proname = ANY (v_admin_only) THEN
            CONTINUE;
        ELSIF r.proname = ANY (v_session_helpers)
           OR r.proname = ANY (v_reviewed_public)
           OR NOT r.prosecdef
           OR r.prosrc ~ '(current_user_shop_id|is_valid_session|current_session_token)' THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
            v_granted := v_granted || r.sig::text;
        ELSE
            v_held := v_held || r.sig::text;
        END IF;
    END LOOP;

    SELECT array_agg(f ORDER BY f) INTO v_missing
    FROM unnest(v_session_helpers || v_app_functions) AS f
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = f
    );

    RAISE NOTICE 'Granted EXECUTE (% functions): %', coalesce(array_length(v_granted, 1), 0), array_to_string(v_granted, ', ');
    IF array_length(v_held, 1) > 0 THEN
        RAISE NOTICE 'NOT granted, review first (SECURITY DEFINER without a shop-session check): %', array_to_string(v_held, ', ');
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE NOTICE 'Not present in this database (app features using them will not work): %', array_to_string(v_missing, ', ');
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
