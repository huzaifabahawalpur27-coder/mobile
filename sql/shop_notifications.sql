-- ============================================================================
-- Shop notifications (bell > Updates) pushed from the superadmin portal.
-- Safe to re-run. Needs current_session_token() / current_user_shop_id().
--
-- notification_campaigns   one row per push (what superadmin sent, to how many shops)
-- shop_notifications       one row per shop per push: the shop's own copy, so a shop
--                          deleting it (bell > X) removes it for that shop only
--
-- Shops (browser, anon role + session header):
--   get_shop_notifications(p_limit)          their own notifications, newest first
--   mark_shop_notifications_seen(p_ids)      the one-time popup has been shown
--   delete_shop_notification(p_id)           permanent; shop owner / admin only
-- Superadmin (ONLY through api-server.js with the service role, never the browser):
--   push_shop_notification(...)              create a push for all / chosen shops
--   list_notification_campaigns(p_limit)     sent list with seen / deleted counts
--   withdraw_notification_campaign(p_id)     remove a mistaken push from every shop
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_campaigns (
    id           BIGSERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    link_path    TEXT,
    module_label TEXT,
    category     TEXT NOT NULL DEFAULT 'feature',
    target       TEXT NOT NULL DEFAULT 'all',
    recipients   INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    withdrawn_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.shop_notifications (
    id           BIGSERIAL PRIMARY KEY,
    campaign_id  BIGINT REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
    shop_id      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    link_path    TEXT,
    module_label TEXT,
    category     TEXT NOT NULL DEFAULT 'feature',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_shop_notifications_shop ON public.shop_notifications (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_notifications_campaign ON public.shop_notifications (campaign_id);

-- No direct table access from the browser: everything goes through the functions below
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_campaigns FROM PUBLIC;
REVOKE ALL ON public.shop_notifications FROM PUBLIC;
DO $$ BEGIN
    EXECUTE 'REVOKE ALL ON public.notification_campaigns FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON public.shop_notifications FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Only internal paths of the shop app, e.g. /accounts or /reports?tab=daily
CREATE OR REPLACE FUNCTION public.edgex_clean_link(p_path TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT CASE WHEN p_path ~ '^/[A-Za-z0-9/_?=&.-]*$' AND p_path NOT LIKE '//%' THEN p_path END
$$;

-- ── Shop side ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_shop_notifications(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(to_jsonb(n) - 'shop_id' ORDER BY n.created_at DESC, n.id DESC)
        FROM (
            SELECT id, campaign_id, shop_id, title, body, link_path, module_label, category, created_at, seen_at
            FROM public.shop_notifications
            WHERE shop_id = v_shop
            ORDER BY created_at DESC, id DESC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
        ) n
    ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_shop_notifications_seen(p_ids BIGINT[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER := public.current_user_shop_id();
    v_rows INTEGER;
BEGIN
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    UPDATE public.shop_notifications SET seen_at = now()
     WHERE shop_id = v_shop AND id = ANY (COALESCE(p_ids, '{}')) AND seen_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Permanent delete of the shop's copy; only the shop owner / admin may do it
CREATE OR REPLACE FUNCTION public.delete_shop_notification(p_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_shop INTEGER;
    v_role TEXT;
BEGIN
    SELECT s.shop_id, u.role INTO v_shop, v_role
      FROM public.sessions s
      JOIN public.users u ON u.id = s.user_id
     WHERE s.token::text = public.current_session_token()::text
       AND (s.expires_at IS NULL OR s.expires_at > now())
     LIMIT 1;
    IF v_shop IS NULL THEN
        RAISE EXCEPTION 'No active shop session' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(v_role, '') NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only the shop owner can delete notifications' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.shop_notifications WHERE id = p_id AND shop_id = v_shop;
    RETURN FOUND;
END;
$$;

-- ── Superadmin side (service role only) ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.push_shop_notification(
    p_title TEXT,
    p_body TEXT,
    p_link_path TEXT DEFAULT NULL,
    p_module_label TEXT DEFAULT NULL,
    p_category TEXT DEFAULT 'feature',
    p_shop_ids INTEGER[] DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_campaign BIGINT;
    v_count INTEGER;
    v_link TEXT := public.edgex_clean_link(NULLIF(trim(COALESCE(p_link_path, '')), ''));
    v_cat TEXT := CASE WHEN p_category IN ('feature', 'fix', 'important') THEN p_category ELSE 'feature' END;
BEGIN
    IF NULLIF(trim(COALESCE(p_title, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Title is required';
    END IF;
    IF NULLIF(trim(COALESCE(p_link_path, '')), '') IS NOT NULL AND v_link IS NULL THEN
        RAISE EXCEPTION 'Link must be a page of the app, like /accounts';
    END IF;

    INSERT INTO public.notification_campaigns (title, body, link_path, module_label, category, target, created_by)
    VALUES (trim(p_title), COALESCE(trim(p_body), ''), v_link, NULLIF(trim(COALESCE(p_module_label, '')), ''), v_cat,
            CASE WHEN p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0 THEN 'all' ELSE 'selected' END, p_created_by)
    RETURNING id INTO v_campaign;

    -- One copy per shop: all shops that are not suspended / deleted, or the chosen ones
    INSERT INTO public.shop_notifications (campaign_id, shop_id, title, body, link_path, module_label, category)
    SELECT v_campaign, s.id, trim(p_title), COALESCE(trim(p_body), ''), v_link, NULLIF(trim(COALESCE(p_module_label, '')), ''), v_cat
      FROM public.shops s
     WHERE CASE WHEN p_shop_ids IS NULL OR cardinality(p_shop_ids) = 0
                THEN COALESCE(lower(to_jsonb(s)->>'status'), 'active') NOT IN ('suspended', 'deleted', 'inactive', 'cancelled')
                ELSE s.id = ANY (p_shop_ids) END;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE public.notification_campaigns SET recipients = v_count WHERE id = v_campaign;
    RETURN jsonb_build_object('success', true, 'campaign_id', v_campaign, 'recipients', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_notification_campaigns(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
    FROM (
        SELECT c.id, c.title, c.body, c.link_path, c.module_label, c.category, c.target, c.recipients,
               c.created_by, c.created_at, c.withdrawn_at,
               (SELECT count(*) FROM public.shop_notifications n WHERE n.campaign_id = c.id AND n.seen_at IS NOT NULL) AS seen,
               GREATEST(c.recipients - (SELECT count(*) FROM public.shop_notifications n WHERE n.campaign_id = c.id), 0) AS deleted
        FROM public.notification_campaigns c
        ORDER BY c.created_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) x
$$;

CREATE OR REPLACE FUNCTION public.withdraw_notification_campaign(p_campaign_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_removed INTEGER;
BEGIN
    DELETE FROM public.shop_notifications WHERE campaign_id = p_campaign_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    UPDATE public.notification_campaigns SET withdrawn_at = now() WHERE id = p_campaign_id AND withdrawn_at IS NULL;
    IF NOT FOUND AND v_removed = 0 THEN
        RAISE EXCEPTION 'Notification % not found or already withdrawn', p_campaign_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'removed', v_removed);
END;
$$;

-- Grants: shop functions to the browser roles; superadmin functions to the server only.
-- (Supabase grants new functions to anon/authenticated by default, so revoke explicitly.)
GRANT EXECUTE ON FUNCTION public.get_shop_notifications(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_shop_notifications_seen(BIGINT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shop_notification(BIGINT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.push_shop_notification(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_notification_campaigns(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_notification_campaign(BIGINT) FROM PUBLIC;
DO $$ BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.push_shop_notification(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER[], TEXT) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.list_notification_campaigns(INTEGER) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.withdraw_notification_campaign(BIGINT) FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.push_shop_notification(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER[], TEXT) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_notification_campaigns(INTEGER) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.withdraw_notification_campaign(BIGINT) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
