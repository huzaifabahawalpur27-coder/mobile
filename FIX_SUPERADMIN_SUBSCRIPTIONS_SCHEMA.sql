-- Fix schema for SuperAdmin Subscriptions & Plans
-- Run this in your Supabase SQL Editor (optional, since frontend now handles missing columns with full graceful fallbacks)

ALTER TABLE IF EXISTS public.shops 
ADD COLUMN IF NOT EXISTS subscription_fee NUMERIC(15,2) DEFAULT 0;

ALTER TABLE IF EXISTS public.subscription_plans 
ADD COLUMN IF NOT EXISTS max_products INT DEFAULT 999999;

ALTER TABLE IF EXISTS public.subscription_plans 
ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 999999;

-- Reload Supabase Schema Cache
NOTIFY pgrst, 'reload schema';
