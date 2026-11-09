-- ============================================================================
-- Phase 0b: keep links already shared with customers working
-- Run AFTER sql/phase0_invoice_link_and_outbox_fix.sql. Safe to re-run.
--
-- Before Phase 0, phone-sale and exchange WhatsApp links carried a token generated
-- in the browser that the server never stored, so every such link showed
-- "Invoice not found". Those tokens survive in sent outbox messages. This file:
--   1. adds legacy_invoice_tokens TEXT[] to sales and exchanges,
--   2. backfills it from whatsapp_queue rows on the server, and
--   3. (in sql/get_public_invoice.sql) get_public_invoice resolves a legacy token (still token-only; the
--      8+ character unguessable-reference guard is unchanged).
-- The app also uploads legacy tokens that exist only on shop devices
-- (registerLegacyInvoiceTokens in src/services/whatsappQueueService.js) when the
-- WhatsApp outbox is opened.
-- ============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS legacy_invoice_tokens TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.exchanges ADD COLUMN IF NOT EXISTS legacy_invoice_tokens TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sales_legacy_invoice_tokens ON public.sales USING GIN (legacy_invoice_tokens);
CREATE INDEX IF NOT EXISTS idx_exchanges_legacy_invoice_tokens ON public.exchanges USING GIN (legacy_invoice_tokens);

-- Backfill from server-side outbox rows (only well-formed, non-numeric 8+ char tokens).
DO $$
BEGIN
    IF to_regclass('public.whatsapp_queue') IS NULL THEN
        RAISE NOTICE 'whatsapp_queue missing; skipping backfill';
        RETURN;
    END IF;

    WITH q AS (
        SELECT (w.reference_data->>'sale_id')::BIGINT AS row_id,
               array_agg(DISTINCT upper(regexp_replace(t.tok, '^(INV-|EXC-)', '', 'i'))) AS toks
        FROM public.whatsapp_queue w
        CROSS JOIN LATERAL (
            SELECT w.reference_data->>'invoice_token' AS tok
            UNION ALL
            SELECT jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(w.reference_data->'legacy_invoice_tokens') = 'array'
                     THEN w.reference_data->'legacy_invoice_tokens' ELSE '[]'::jsonb END)
        ) t
        WHERE (w.reference_data->>'sale_id') ~ '^[0-9]+$'
          AND t.tok IS NOT NULL
          AND NOT COALESCE((w.reference_data->>'is_exchange')::BOOLEAN, FALSE)
        GROUP BY 1
    )
    UPDATE public.sales t
    SET legacy_invoice_tokens = ARRAY(
        SELECT DISTINCT x FROM unnest(t.legacy_invoice_tokens || q.toks) AS x
        WHERE x ~ '^[A-Z0-9]{8,64}$' AND x !~ '^[0-9]+$'
          AND x <> upper(COALESCE(t.invoice_token, ''))
        ORDER BY x
    )
    FROM q
    WHERE t.id = q.row_id;

    WITH q AS (
        SELECT (w.reference_data->>'exchange_id')::BIGINT AS row_id,
               array_agg(DISTINCT upper(regexp_replace(t.tok, '^(INV-|EXC-)', '', 'i'))) AS toks
        FROM public.whatsapp_queue w
        CROSS JOIN LATERAL (
            SELECT w.reference_data->>'invoice_token' AS tok
            UNION ALL
            SELECT jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(w.reference_data->'legacy_invoice_tokens') = 'array'
                     THEN w.reference_data->'legacy_invoice_tokens' ELSE '[]'::jsonb END)
        ) t
        WHERE (w.reference_data->>'exchange_id') ~ '^[0-9]+$'
          AND t.tok IS NOT NULL
        GROUP BY 1
    )
    UPDATE public.exchanges t
    SET legacy_invoice_tokens = ARRAY(
        SELECT DISTINCT x FROM unnest(t.legacy_invoice_tokens || q.toks) AS x
        WHERE x ~ '^[A-Z0-9]{8,64}$' AND x !~ '^[0-9]+$'
          AND x <> upper(COALESCE(t.invoice_token, ''))
        ORDER BY x
    )
    FROM q
    WHERE t.id = q.row_id;
END;
$$;

-- get_public_invoice is defined ONLY in sql/get_public_invoice.sql (run it last).
-- Earlier copies here assumed sale_items.imei_snapshot was JSONB and crashed with
-- "operator does not exist: text ->> unknown" on databases where it is TEXT.
NOTIFY pgrst, 'reload schema';
