-- ============================================================
-- PHASE 8: BATCH-BASED FIFO INVENTORY COSTING
-- Part 1: Schema Tables, Constraints, Indexes & RLS
-- ============================================================

-- 0. Ensure Session & Multi-Tenancy Helpers Exist
CREATE OR REPLACE FUNCTION public.current_session_token()
RETURNS uuid
LANGUAGE plpgsql STABLE
AS $token$
DECLARE
  raw_token text;
BEGIN
  raw_token := COALESCE(
    current_setting('request.headers', true)::json->>'x-session-token',
    current_setting('request.headers', true)::json->>'x-auth-token'
  );
  IF raw_token IS NULL OR raw_token = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw_token::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$token$;

CREATE OR REPLACE FUNCTION public.current_user_shop_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $shop$
  SELECT s.shop_id
  FROM public.sessions s
  JOIN public.users u ON u.id = s.user_id AND COALESCE(u.is_active, true) = true
  WHERE s.token::text = public.current_session_token()::text
    AND (s.expires_at IS NULL OR s.expires_at > now())
  LIMIT 1
$shop$;

GRANT EXECUTE ON FUNCTION public.current_session_token() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.current_user_shop_id() TO anon, authenticated, public;

-- 1. Extend shops Table (Tenant-Level Feature Flag & Costing Method)
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS batch_costing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS costing_method TEXT NOT NULL DEFAULT 'fifo';

-- 2. Extend products Table (Per-Product Inventory Tracking Mode)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'non_batch';

-- Ensure constraint exists idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_inventory_mode'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT chk_products_inventory_mode
      CHECK (inventory_mode IN ('non_batch', 'batch_tracked', 'serialized'));
  END IF;
END $$;

-- Safe initial classification: Products in phone/mobile categories become 'serialized'; all others remain 'non_batch'
UPDATE public.products
SET inventory_mode = 'serialized'
WHERE inventory_mode = 'non_batch'
  AND category_id IN (
    SELECT id FROM public.categories 
    WHERE lower(name) LIKE '%phone%' OR lower(name) LIKE '%mobile%'
  );

-- 3. Table: stock_batches (Core Lot / Batch Inventory Tracking)
CREATE TABLE IF NOT EXISTS public.stock_batches (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE SET NULL,
    purchase_id INTEGER REFERENCES public.purchases(id) ON DELETE SET NULL,
    purchase_item_id INTEGER REFERENCES public.purchase_items(id) ON DELETE SET NULL,
    batch_no TEXT NOT NULL,
    purchase_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    qty_received NUMERIC(15,2) NOT NULL CHECK (qty_received > 0),
    qty_remaining NUMERIC(15,2) NOT NULL CHECK (qty_remaining >= 0 AND qty_remaining <= qty_received),
    original_unit_cost NUMERIC(15,2) NOT NULL CHECK (original_unit_cost >= 0),
    current_unit_cost NUMERIC(15,2) NOT NULL CHECK (current_unit_cost >= 0),
    source TEXT NOT NULL CHECK (source IN ('purchase', 'opening_balance', 'return_restock', 'stock_adjustment')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'voided')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Table: sale_item_batches (Batch Consumption and Unit Cost Snapshot)
CREATE TABLE IF NOT EXISTS public.sale_item_batches (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    sale_item_id BIGINT NOT NULL REFERENCES public.sale_items(id) ON DELETE CASCADE,
    batch_id BIGINT NOT NULL REFERENCES public.stock_batches(id) ON DELETE RESTRICT,
    qty NUMERIC(15,2) NOT NULL CHECK (qty > 0),
    unit_cost_at_sale NUMERIC(15,2) NOT NULL CHECK (unit_cost_at_sale >= 0),
    reversed_qty NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (reversed_qty >= 0 AND reversed_qty <= qty),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Table: batch_cost_adjustments (Audit & COGS Impact for Cost Corrections)
CREATE TABLE IF NOT EXISTS public.batch_cost_adjustments (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    batch_id BIGINT NOT NULL REFERENCES public.stock_batches(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    old_cost NUMERIC(15,2) NOT NULL CHECK (old_cost >= 0),
    new_cost NUMERIC(15,2) NOT NULL CHECK (new_cost >= 0),
    qty_sold_at_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (qty_sold_at_adjustment >= 0),
    qty_remaining_at_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (qty_remaining_at_adjustment >= 0),
    cogs_impact NUMERIC(15,2) NOT NULL DEFAULT 0,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    adjusted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    adjusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Table: stock_adjustments (Damage, Loss, or Physical Audit Adjustments)
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    batch_id BIGINT REFERENCES public.stock_batches(id) ON DELETE SET NULL,
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    qty_change NUMERIC(15,2) NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Table: conversion_runs (Audit and Rollback History for Product Conversions)
CREATE TABLE IF NOT EXISTS public.conversion_runs (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    before_stock NUMERIC(15,2) NOT NULL,
    before_cost NUMERIC(15,2) NOT NULL,
    after_batch_qty NUMERIC(15,2) NOT NULL,
    after_batch_cost NUMERIC(15,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reverted')),
    converted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. High-Performance Indexes
CREATE INDEX IF NOT EXISTS idx_stock_batches_fifo 
  ON public.stock_batches (shop_id, product_id, purchase_date ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_stock_batches_active_remaining 
  ON public.stock_batches (shop_id, product_id) 
  WHERE qty_remaining > 0 AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_stock_batches_purchase 
  ON public.stock_batches (purchase_id);

CREATE INDEX IF NOT EXISTS idx_sale_item_batches_sale_item 
  ON public.sale_item_batches (shop_id, sale_item_id);

CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch 
  ON public.sale_item_batches (batch_id);

CREATE INDEX IF NOT EXISTS idx_batch_cost_adjustments_batch 
  ON public.batch_cost_adjustments (batch_id);

CREATE INDEX IF NOT EXISTS idx_batch_cost_adjustments_product 
  ON public.batch_cost_adjustments (shop_id, product_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product 
  ON public.stock_adjustments (shop_id, product_id);

CREATE INDEX IF NOT EXISTS idx_conversion_runs_product 
  ON public.conversion_runs (shop_id, product_id);

-- 9. Enable Row-Level Security (RLS) on all new tables
ALTER TABLE public.stock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_cost_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_runs ENABLE ROW LEVEL SECURITY;

-- 10. Multi-Tenant Shop Access Policies
DROP POLICY IF EXISTS stock_batches_shop_access ON public.stock_batches;
CREATE POLICY stock_batches_shop_access ON public.stock_batches
    FOR ALL USING (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL)
    WITH CHECK (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL);

DROP POLICY IF EXISTS sale_item_batches_shop_access ON public.sale_item_batches;
CREATE POLICY sale_item_batches_shop_access ON public.sale_item_batches
    FOR ALL USING (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL)
    WITH CHECK (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL);

DROP POLICY IF EXISTS batch_cost_adjustments_shop_access ON public.batch_cost_adjustments;
CREATE POLICY batch_cost_adjustments_shop_access ON public.batch_cost_adjustments
    FOR ALL USING (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL)
    WITH CHECK (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL);

DROP POLICY IF EXISTS stock_adjustments_shop_access ON public.stock_adjustments;
CREATE POLICY stock_adjustments_shop_access ON public.stock_adjustments
    FOR ALL USING (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL)
    WITH CHECK (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL);

DROP POLICY IF EXISTS conversion_runs_shop_access ON public.conversion_runs;
CREATE POLICY conversion_runs_shop_access ON public.conversion_runs
    FOR ALL USING (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL)
    WITH CHECK (shop_id = current_user_shop_id() OR current_user_shop_id() IS NULL);

-- 11. Role Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_batches TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_item_batches TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_cost_adjustments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversion_runs TO anon, authenticated, service_role;
