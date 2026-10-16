-- ==============================================================================
-- Schema Fix: supplier_payments
-- Adds missing columns (bill_number, details, payment_mode, transaction_ref, etc.)
-- and reloads PostgREST schema cache.
-- Run this in Supabase SQL Editor.
-- ==============================================================================

ALTER TABLE IF EXISTS supplier_payments
  ADD COLUMN IF NOT EXISTS bill_number TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS transaction_ref TEXT,
  ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'payment',
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Create index on supplier_id & shop_id for fast ledger queries
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_shop_id ON supplier_payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill_number ON supplier_payments(bill_number);

-- Notify PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';
