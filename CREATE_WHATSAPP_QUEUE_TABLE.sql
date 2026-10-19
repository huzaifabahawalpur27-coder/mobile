-- ==============================================================================
-- Migration: Create whatsapp_queue table for mobile dispatch
-- Allows desktop POS to enqueue WhatsApp receipts/memos, and mobile phone to send.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NULL,
    recipient_name TEXT NULL,
    recipient_phone TEXT NOT NULL,
    message_type TEXT DEFAULT 'phone_sale_receipt',
    reference_id TEXT NULL,
    reference_data JSONB NULL,
    message_text TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'dismissed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ NULL,
    created_by UUID NULL
);

-- Indices for rapid querying
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_shop_status ON public.whatsapp_queue(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_created ON public.whatsapp_queue(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.whatsapp_queue ENABLE ROW LEVEL SECURITY;

-- Permissive policy for authenticated tenant shop access
DROP POLICY IF EXISTS "whatsapp_queue_shop_isolation" ON public.whatsapp_queue;
CREATE POLICY "whatsapp_queue_shop_isolation" ON public.whatsapp_queue
    FOR ALL
    USING (true)
    WITH CHECK (true);
