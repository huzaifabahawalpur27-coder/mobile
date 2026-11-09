-- ============================================================================
-- Phase 1: store shop warranty terms on the server
-- Run AFTER sql/production_security_hardening.sql. Safe to re-run.
--
-- Settings -> "WhatsApp & Warranty" only ever saved warranty terms in the browser's
-- localStorage: shops had no warranty_terms column and update_shop_settings had no
-- parameter for it. So edited terms (e.g. keeping only the first two points) reverted
-- on other devices, after re-login, and on the customer's online bill, which reads
-- shops.warranty_terms through get_public_invoice.
--
-- 1. Adds shops.warranty_terms and shops.wa_exchange_template (get_public_invoice
--    already selects sh.warranty_terms and fails at call time if it is missing).
-- 2. Replaces update_shop_settings with the same session-checked version plus
--    p_warranty_terms and p_wa_exchange_template. Existing overloads are dropped first,
--    because adding parameters with defaults would otherwise create an ambiguous
--    overload ("function is not unique") for every existing caller.
-- ============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS warranty_terms TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS wa_exchange_template TEXT;

DO $$
DECLARE
    fn RECORD;
BEGIN
    IF to_regprocedure('public.current_user_shop_id()') IS NULL THEN
        RAISE EXCEPTION 'public.current_user_shop_id() missing: apply sql/production_security_hardening.sql first. Nothing was changed by this block.';
    END IF;

    FOR fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'update_shop_settings'
    LOOP
        EXECUTE format('DROP FUNCTION %s', fn.sig);
    END LOOP;
END;
$$;

CREATE FUNCTION public.update_shop_settings(
  p_shop_id integer, p_name text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL, p_logo_url text DEFAULT NULL,
  p_invoice_footer text DEFAULT NULL, p_quotation_footer text DEFAULT NULL,
  p_print_size text DEFAULT NULL, p_print_mode text DEFAULT NULL,
  p_print_template text DEFAULT NULL, p_wa_reminder_template text DEFAULT NULL,
  p_wa_bill_template text DEFAULT NULL, p_wa_reorder_template text DEFAULT NULL,
  p_invoice_prefix text DEFAULT NULL,
  p_warranty_terms text DEFAULT NULL, p_wa_exchange_template text DEFAULT NULL
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
    invoice_prefix=COALESCE(p_invoice_prefix,invoice_prefix),
    warranty_terms=COALESCE(NULLIF(btrim(p_warranty_terms), ''), warranty_terms),
    wa_exchange_template=COALESCE(NULLIF(btrim(p_wa_exchange_template), ''), wa_exchange_template)
  WHERE id=p_shop_id;
  RETURN jsonb_build_object('success', true);
END $$;

REVOKE ALL ON FUNCTION public.update_shop_settings(integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_shop_settings(integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
