-- Complete SuperAdmin Billing & Subscription Schema Fix
-- Run this in your Supabase SQL Editor to enable all billing, dates, and plan features permanently:

-- 1. Add all missing columns to shops table
ALTER TABLE IF EXISTS public.shops 
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS subscription_fee NUMERIC(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_billing_date DATE,
ADD COLUMN IF NOT EXISTS plan_id INTEGER,
ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Add limits to subscription_plans
ALTER TABLE IF EXISTS public.subscription_plans 
ADD COLUMN IF NOT EXISTS max_products INT DEFAULT 999999,
ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 999999;

-- 3. Create shop_payments table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.shop_payments (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES public.shops(id) ON DELETE CASCADE,
    amount NUMERIC(15,2) NOT NULL,
    payment_type TEXT DEFAULT 'bank_transfer',
    payment_date DATE DEFAULT CURRENT_DATE,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
