-- ============================================================
-- SQL MIGRATION: ADD MISSING COLUMNS TO CATEGORIES & SUPPLIERS
-- Run this script in the Supabase SQL Editor.
-- ============================================================

-- 1. Ensure categories table has description and low_stock_threshold columns
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 10;

-- 2. Ensure suppliers table has custom details and balance columns
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS product_type TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS other_details TEXT;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(15,2) DEFAULT 0;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0;

-- 3. Notify PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';
