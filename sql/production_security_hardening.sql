-- ============================================================================
-- PRODUCTION SECURITY HARDENING MIGRATION (OPERATIONAL-SAFE)
-- Apply this migration in the Supabase Dashboard -> SQL Editor.
-- It establishes strict Row Level Security (RLS) tenant isolation while
-- ensuring POS checkout, phone procurement, banners, and app updates remain fully functional.
-- ============================================================================

-- 1. Helper to safely extract session token from PostgREST headers
CREATE OR REPLACE FUNCTION public.current_session_token()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE headers jsonb; raw_token text;
BEGIN
  BEGIN headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  raw_token := COALESCE(headers->>'x-session-token', headers->>'X-Session-Token');
  IF raw_token IS NULL OR raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  RETURN raw_token::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- 2. Resilient tenant resolver (handles TEXT/UUID token, NULL expiration, NULL is_active)
CREATE OR REPLACE FUNCTION public.current_user_shop_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.shop_id
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id AND COALESCE(u.is_active, true) = true
  WHERE s.token::text = public.current_session_token()::text
    AND (s.expires_at IS NULL OR s.expires_at > now())
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_valid_session(p_shop_id integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_shop_id IS NOT NULL AND p_shop_id = public.current_user_shop_id()
$$;

GRANT EXECUTE ON FUNCTION public.current_session_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_shop_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_session(integer) TO anon, authenticated;

-- 3. Tenant-scoped RPCs
CREATE OR REPLACE FUNCTION public.get_shop_status(p_shop_id integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT s.status FROM public.shops s
     WHERE s.id = p_shop_id AND p_shop_id = public.current_user_shop_id() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.get_shop_config(p_shop_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT jsonb_build_object(
       'status', s.status, 'plan_name', COALESCE(sp.name, s.subscription_plan, 'TRIAL'),
       'product_limit', COALESCE(sp.product_limit, 500), 'user_limit', COALESCE(sp.user_limit, 5),
       'features', COALESCE(sp.features, '{}'::jsonb), 'subscription_fee', COALESCE(s.subscription_fee, 0),
       'next_billing_date', s.next_billing_date, 'shop_name', s.name, 'logo_url', s.logo_url
     ) FROM public.shops s LEFT JOIN public.subscription_plans sp ON sp.id = s.plan_id
     WHERE s.id = p_shop_id AND p_shop_id = public.current_user_shop_id() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.update_shop_settings(
  p_shop_id integer, p_name text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL, p_logo_url text DEFAULT NULL,
  p_invoice_footer text DEFAULT NULL, p_quotation_footer text DEFAULT NULL,
  p_print_size text DEFAULT NULL, p_print_mode text DEFAULT NULL,
  p_print_template text DEFAULT NULL, p_wa_reminder_template text DEFAULT NULL,
  p_wa_bill_template text DEFAULT NULL, p_wa_reorder_template text DEFAULT NULL,
  p_invoice_prefix text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <> public.current_user_shop_id() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;
  UPDATE public.shops SET
    name=COALESCE(p_name,name), phone=COALESCE(p_phone,phone), address=COALESCE(p_address,address),
    logo_url=COALESCE(p_logo_url,logo_url), invoice_footer=COALESCE(p_invoice_footer,invoice_footer),
    quotation_footer=COALESCE(p_quotation_footer,quotation_footer), print_size=COALESCE(p_print_size,print_size),
    print_mode=COALESCE(p_print_mode,print_mode), print_template=COALESCE(p_print_template,print_template),
    wa_reminder_template=COALESCE(p_wa_reminder_template,wa_reminder_template),
    wa_bill_template=COALESCE(p_wa_bill_template,wa_bill_template),
    wa_reorder_template=COALESCE(p_wa_reorder_template,wa_reorder_template),
    invoice_prefix=COALESCE(p_invoice_prefix,invoice_prefix)
  WHERE id=p_shop_id;
  RETURN jsonb_build_object('success', true);
END $$;

-- 4. Reset legacy grants
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 5. Global read-only tables (system_configs & subscription_plans)
DO $$ BEGIN
  IF to_regclass('public.system_configs') IS NOT NULL THEN
    ALTER TABLE public.system_configs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS system_configs_read ON public.system_configs;
    CREATE POLICY system_configs_read ON public.system_configs FOR SELECT TO anon, authenticated USING (true);
    GRANT SELECT ON public.system_configs TO anon, authenticated;
  END IF;
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS subscription_plans_read ON public.subscription_plans;
    CREATE POLICY subscription_plans_read ON public.subscription_plans FOR SELECT TO anon, authenticated USING (true);
    GRANT SELECT ON public.subscription_plans TO anon, authenticated;
  END IF;
END $$;

-- 6. Sessions security (accessible only via SECURITY DEFINER login/logout)
DO $$ BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
    EXECUTE 'DROP POLICY IF EXISTS "Sessions Open Access" ON public.sessions';
    EXECUTE 'DROP POLICY IF EXISTS "Sessions Access" ON public.sessions';
    EXECUTE 'DROP POLICY IF EXISTS "Sessions Open Read" ON public.sessions';
    REVOKE ALL ON public.sessions FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 7. Strict tenant isolation on all tables with shop_id
DO $$
DECLARE t record; p record; seq_name text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col ON col.table_schema = n.nspname AND col.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND col.column_name = 'shop_id'
      AND c.relname NOT IN ('sessions', 'shops')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t.relname LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t.relname);
    END LOOP;
    EXECUTE format('CREATE POLICY tenant_session_scope ON public.%I FOR ALL TO anon, authenticated USING (shop_id = public.current_user_shop_id()) WITH CHECK (shop_id = public.current_user_shop_id())', t.relname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t.relname);
    seq_name := pg_get_serial_sequence(format('public.%I', t.relname), 'id');
    IF seq_name IS NOT NULL THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq_name); END IF;
  END LOOP;
END $$;

-- 8. Child table inheritance (sale_items & purchase_items)
DO $$ DECLARE p record; seq_name text; BEGIN
  IF to_regclass('public.sale_items') IS NOT NULL AND to_regclass('public.sales') IS NOT NULL THEN
    ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='sale_items' LOOP
      EXECUTE format('DROP POLICY %I ON public.sale_items', p.policyname);
    END LOOP;
    CREATE POLICY sale_items_tenant_scope ON public.sale_items FOR ALL TO anon, authenticated
      USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id AND s.shop_id = public.current_user_shop_id()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id AND s.shop_id = public.current_user_shop_id()));
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO anon, authenticated;
    seq_name := pg_get_serial_sequence('public.sale_items', 'id');
    IF seq_name IS NOT NULL THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq_name); END IF;
  END IF;
  IF to_regclass('public.purchase_items') IS NOT NULL AND to_regclass('public.purchases') IS NOT NULL THEN
    ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='purchase_items' LOOP
      EXECUTE format('DROP POLICY %I ON public.purchase_items', p.policyname);
    END LOOP;
    CREATE POLICY purchase_items_tenant_scope ON public.purchase_items FOR ALL TO anon, authenticated
      USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_items.purchase_id AND p.shop_id = public.current_user_shop_id()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_items.purchase_id AND p.shop_id = public.current_user_shop_id()));
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO anon, authenticated;
    seq_name := pg_get_serial_sequence('public.purchase_items', 'id');
    IF seq_name IS NOT NULL THEN EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO anon, authenticated', seq_name); END IF;
  END IF;
END $$;

-- 9. Shops visibility
DO $$ DECLARE p record; BEGIN
  IF to_regclass('public.shops') IS NOT NULL THEN
    ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='shops' LOOP
      EXECUTE format('DROP POLICY %I ON public.shops', p.policyname);
    END LOOP;
    CREATE POLICY shop_session_scope ON public.shops FOR ALL TO anon, authenticated
      USING (id = public.current_user_shop_id()) WITH CHECK (id = public.current_user_shop_id());
    GRANT SELECT ON public.shops TO anon, authenticated;
  END IF;
END $$;

-- 10. Grant ALL overloads of client RPCs dynamically by name
-- (Step 4 revoked EXECUTE on every routine, including the session helpers granted in
-- step 1 that every RLS policy calls; they MUST be re-granted here, otherwise every
-- table query fails with "permission denied for function current_user_shop_id".
-- Then run sql/fix_function_grants.sql, which also covers functions defined only in
-- the live database.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS proc_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'current_session_token',
        'current_user_shop_id',
        'is_valid_session',
        'process_phone_exchange',
        'void_phone_exchange',
        'allocate_sale_line_fifo',
        'return_sale_item_batches',
        'adjust_batch_stock',
        'adjust_batch_cost',
        'void_purchase_batches',
        'check_purchase_batches_before_void',
        'get_fifo_inventory_valuation',
        'convert_product_to_batch_tracking',
        'preview_product_batch_conversion',
        'revert_product_batch_conversion',
        'reconcile_product_batches',
        'secure_login',
        'switch_tenant_context',
        'get_shop_status',
        'get_shop_config',
        'update_shop_settings',
        'open_cash_session',
        'close_cash_session',
        'issue_phone_custody',
        'return_phone_custody',
        'process_phone_sale',
        'record_phone_purchase'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.proc_name);
  END LOOP;
END $$;
