-- ============================================================================
-- Phase 1b: put the customer's name and phone back on bills that lost them
-- Safe to re-run. Run after sql/phase0_invoice_link_and_outbox_fix.sql.
--
-- Some process_phone_sale versions (and POS's fallback call) never stored
-- sales.customer_name / customer_phone, so walk-in customers' online bills showed
-- "Valued Customer / Walk-in". The WhatsApp outbox always has the recipient's name
-- and number, so fill them in from there. Only empty or placeholder values
-- ("Walk-in Customer", "Valued Customer", "Customer") are replaced; real names stay.
-- The app does the same for outbox items that exist only on shop devices
-- (backfillBillCustomersFromQueue in src/services/whatsappQueueService.js).
-- ============================================================================

DO $$
DECLARE
    v_sales_phone BOOLEAN;
    v_ex_name BOOLEAN;
    v_ex_phone BOOLEAN;
BEGIN
    IF to_regclass('public.whatsapp_queue') IS NULL THEN
        RAISE NOTICE 'whatsapp_queue missing; nothing to backfill';
        RETURN;
    END IF;

    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'customer_phone') INTO v_sales_phone;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'exchanges' AND column_name = 'customer_name') INTO v_ex_name;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'exchanges' AND column_name = 'customer_phone') INTO v_ex_phone;

    -- Latest outbox recipient per bill
    CREATE TEMP TABLE _bill_recipients ON COMMIT DROP AS
    SELECT DISTINCT ON (kind, bill_id) kind, bill_id, name, phone
    FROM (
        SELECT
            CASE WHEN COALESCE((w.reference_data->>'is_exchange')::BOOLEAN, FALSE) OR w.message_type ILIKE '%exchange%' THEN 'exchange' ELSE 'sale' END AS kind,
            CASE WHEN COALESCE((w.reference_data->>'is_exchange')::BOOLEAN, FALSE) OR w.message_type ILIKE '%exchange%'
                 THEN NULLIF(w.reference_data->>'exchange_id', '')
                 ELSE NULLIF(w.reference_data->>'sale_id', '') END AS bill_ref,
            CASE WHEN lower(btrim(COALESCE(w.recipient_name, ''))) IN ('', 'customer', 'valued customer', 'walk-in customer', 'walk-in')
                 THEN NULL ELSE btrim(w.recipient_name) END AS name,
            NULLIF(regexp_replace(COALESCE(w.recipient_phone, ''), '[^0-9]', '', 'g'), '') AS phone,
            w.created_at
        FROM public.whatsapp_queue w
        WHERE w.reference_data IS NOT NULL
    ) r
    CROSS JOIN LATERAL (SELECT CASE WHEN r.bill_ref ~ '^[0-9]+$' THEN r.bill_ref::BIGINT END AS bill_id) b
    WHERE b.bill_id IS NOT NULL AND (r.name IS NOT NULL OR length(r.phone) >= 10)
    ORDER BY kind, bill_id, created_at DESC;

    -- Sales
    UPDATE public.sales s
    SET customer_name = q.name
    FROM _bill_recipients q
    WHERE q.kind = 'sale' AND s.id = q.bill_id AND q.name IS NOT NULL
      AND lower(btrim(COALESCE(s.customer_name, ''))) IN ('', 'customer', 'valued customer', 'walk-in customer', 'walk-in');

    IF v_sales_phone THEN
        UPDATE public.sales s
        SET customer_phone = q.phone
        FROM _bill_recipients q
        WHERE q.kind = 'sale' AND s.id = q.bill_id AND length(q.phone) >= 10
          AND btrim(COALESCE(s.customer_phone, '')) = '';
    END IF;

    -- Exchanges
    IF v_ex_name THEN
        UPDATE public.exchanges e
        SET customer_name = q.name
        FROM _bill_recipients q
        WHERE q.kind = 'exchange' AND e.id = q.bill_id AND q.name IS NOT NULL
          AND lower(btrim(COALESCE(e.customer_name, ''))) IN ('', 'customer', 'valued customer', 'walk-in customer', 'walk-in');
    END IF;
    IF v_ex_phone THEN
        UPDATE public.exchanges e
        SET customer_phone = q.phone
        FROM _bill_recipients q
        WHERE q.kind = 'exchange' AND e.id = q.bill_id AND length(q.phone) >= 10
          AND btrim(COALESCE(e.customer_phone, '')) = '';
    END IF;
END;
$$;
