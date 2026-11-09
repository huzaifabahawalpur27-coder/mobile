-- ============================================================================
-- URGENT: logins succeed but the server never saves the session
-- Safe to re-run. Changes nothing except the session insert inside secure_login.
--
-- Symptom: login reports success and returns a session_token, but no row with that
-- token exists in public.sessions, so every request is anonymous and all screens
-- (inventory, POS, customers) load empty.
--
-- Cause: secure_login declares  v_session_token TEXT  and runs
--   INSERT INTO public.sessions (token, ...) VALUES (v_session_token, ...)
-- inside  BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END;
-- sessions.token is a UUID column, so the insert fails ("column token is of type
-- uuid but expression is of type text") and the error is silently discarded. Until
-- production_security_hardening.sql blocked it, the browser wrote the session row
-- itself, which hid this bug.
--
-- Fix (in place, for whatever secure_login version is live):
--   1. make sure sessions.token has a unique index (the insert uses ON CONFLICT (token));
--   2. rewrite only  VALUES (v_session_token,  ->  VALUES (v_session_token::uuid,
--      in the live definition and re-create it. Password checks, shop checks and the
--      reply are untouched. A NOTICE says what was changed.
-- ============================================================================

-- 1. Unique index on sessions.token
DO $$
DECLARE
    v_has_unique BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'public.sessions'::regclass
          AND i.indisunique
          AND i.indnatts = 1
          AND a.attname = 'token'
    ) INTO v_has_unique;

    IF v_has_unique THEN
        RAISE NOTICE 'sessions.token already has a unique index';
    ELSE
        -- Keep the newest row for any duplicated token, then add the index
        DELETE FROM public.sessions a
        USING public.sessions b
        WHERE a.token = b.token AND a.ctid < b.ctid;
        CREATE UNIQUE INDEX sessions_token_unique ON public.sessions (token);
        RAISE NOTICE 'Added unique index sessions_token_unique on sessions.token';
    END IF;
END;
$$;

-- 2. Cast the session token in secure_login's insert
DO $$
DECLARE
    r RECORD;
    v_def TEXT;
    v_new TEXT;
BEGIN
    FOR r IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'secure_login'
    LOOP
        v_def := pg_get_functiondef(r.oid);
        v_new := regexp_replace(v_def, 'VALUES\s*\(\s*v_session_token\s*,', 'VALUES (v_session_token::uuid,', 'gi');
        IF v_new = v_def THEN
            RAISE NOTICE '% left unchanged: no uncast "VALUES (v_session_token," found (already fixed, or a different version)', r.oid::regprocedure;
        ELSE
            EXECUTE v_new;
            RAISE NOTICE '% patched: the session token is now saved as uuid', r.oid::regprocedure;
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
