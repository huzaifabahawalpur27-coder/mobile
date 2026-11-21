-- ============================================================================
-- FIX: ensure purchases always have net_amount populated.
-- Safe to re-run.
--
-- Why: Phone purchases recorded via record_phone_purchase RPC previously omitted
-- net_amount in the INSERT statement, causing net_amount to default to 0 even
-- when total_amount was > 0. The Dashboard then evaluated 0 ?? total_amount,
-- treating 0 as the net purchase cost and displaying Rs. 0.
-- ============================================================================

UPDATE public.purchases
   SET net_amount = total_amount - COALESCE(discount, 0)
 WHERE (net_amount = 0 OR net_amount IS NULL)
   AND total_amount > 0;

NOTIFY pgrst, 'reload schema';
