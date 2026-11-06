-- ============================================================================
-- KURO PHASE 9 — HOTFIX: POSTGRESQL ERROR 42702 RESOLUTION
-- Function: public.reconcile_stale_time_entries(INTERVAL)
--
-- Target Issue:
--   During Supabase acceptance test execution of Test 9, the runtime engine
--   raised: "ERROR: 42702: column reference 'started_at' is ambiguous".
--
-- Root Cause:
--   The function signature defines `RETURNS TABLE (...)` with output columns:
--     - user_id UUID
--     - started_at TIMESTAMPTZ
--     - ended_at TIMESTAMPTZ
--     - recovery_reason TEXT
--   In PL/pgSQL, output parameters of a RETURNS TABLE function are automatically
--   registered as variables within the function's scope. When SQL statements
--   inside the body reference table columns without qualifying aliases, PostgreSQL
--   encounters ambiguity between the table column and the PL/pgSQL variable.
--
-- Hotfix Scope:
--   1. Qualify all table column references with explicit table aliases:
--      - `public.time_entries te`
--      - `public.time_entry_pauses p`
--      - `public.time_entry_idles i`
--   2. Explicitly qualify candidate selection, eligibility checks, child FOR UPDATE
--      locking, pause/idle duration sums, MIN/MAX bounds checks, inactive
--      multirange aggregation, and parent/child UPDATE statements.
--   3. Preserve all Revision 8-15 architectural guarantees: canonical per-user
--      advisory lock ordering, FOR UPDATE SKIP LOCKED, child NOWAIT deadlock
--      elimination, child bound checks, active multirange conflict detection,
--      unclosed child forensic preservation under quarantine, and service_role
--      restricted execution under SECURITY INVOKER.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_stale_time_entries(
    p_max_age INTERVAL DEFAULT INTERVAL '12 hours'
)
RETURNS TABLE (
    recovered_entry_id UUID,
    user_id UUID,
    original_state VARCHAR,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    active_seconds INTEGER,
    idle_seconds INTEGER,
    recovery_reason TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_candidate RECORD;
    r RECORD;
    v_open_pause RECORD;
    v_open_idle RECORD;
    v_total_paused INTEGER;
    v_total_idle INTEGER;
    v_target_ended_at TIMESTAMPTZ;
    v_target_elapsed INTEGER;
    v_available_elapsed INTEGER;
    v_final_idle INTEGER;
    v_final_active INTEGER;
    v_reason TEXT;
    v_conflict_id UUID;
    v_candidate_active tstzmultirange;
    v_inactive_multi tstzmultirange;
    v_min_pause_ts TIMESTAMPTZ;
    v_max_pause_ts TIMESTAMPTZ;
    v_min_idle_ts TIMESTAMPTZ;
    v_max_idle_ts TIMESTAMPTZ;
BEGIN
    -- Select stale candidate IDs and user IDs WITHOUT holding row locks
    FOR v_candidate IN
        SELECT te.id, te.user_id
        FROM public.time_entries te
        WHERE te.state IN ('running', 'paused')
          AND (te.updated_at < (now() - p_max_age) OR te.started_at < (now() - p_max_age))
        ORDER BY te.started_at ASC
    LOOP
        -- Step A: Acquire per-user advisory lock FIRST (aligns with all other timer transactions)
        PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || v_candidate.user_id::text));

        -- Step B: Row-lock and recheck eligibility under the advisory lock using FOR UPDATE SKIP LOCKED
        SELECT te.* INTO r
        FROM public.time_entries te
        WHERE te.id = v_candidate.id
          AND te.state IN ('running', 'paused')
          AND (te.updated_at < (now() - p_max_age) OR te.started_at < (now() - p_max_age))
        FOR UPDATE SKIP LOCKED;

        -- If already completed, deleted, or processed by a concurrent recovery worker, skip cleanly
        IF r.id IS NULL THEN
            CONTINUE;
        END IF;

        -- Step C: Deadlock-free child row locking via FOR UPDATE NOWAIT.
        -- If any child pause or idle interval is currently locked by a concurrent user transaction
        -- (which may be waiting on our advisory lock), NOWAIT immediately raises lock_not_available.
        -- We catch this in a subtransaction and cleanly skip/defer recovery of this candidate,
        -- completely eliminating child row lock inversion deadlocks.
        BEGIN
            PERFORM p.id
            FROM public.time_entry_pauses p
            WHERE p.time_entry_id = r.id
            FOR UPDATE NOWAIT;

            PERFORM i.id
            FROM public.time_entry_idles i
            WHERE i.time_entry_id = r.id
            FOR UPDATE NOWAIT;
        EXCEPTION WHEN lock_not_available THEN
            -- Child interval is locked by a concurrent transaction; safely defer recovery of this timer
            CONTINUE;
        END;

        -- 1. Quarantine corrupt entries with future start timestamps
        IF r.started_at > now() THEN
            UPDATE public.time_entries te
            SET state = 'quarantined',
                is_recovered = true,
                recovery_reason = format('Quarantined: started_at is in the future (%s).', r.started_at),
                updated_at = now()
            WHERE te.id = r.id;

            recovered_entry_id := r.id;
            user_id := r.user_id;
            original_state := r.state;
            started_at := r.started_at;
            ended_at := NULL;
            active_seconds := 0;
            idle_seconds := 0;
            recovery_reason := format('Quarantined: started_at is in the future (%s).', r.started_at);
            RETURN NEXT;
            CONTINUE;
        END IF;

        -- 2. Inspect open pause and open idle records
        SELECT p.* INTO v_open_pause
        FROM public.time_entry_pauses p
        WHERE p.time_entry_id = r.id AND p.resumed_at IS NULL
        LIMIT 1;

        SELECT i.* INTO v_open_idle
        FROM public.time_entry_idles i
        WHERE i.time_entry_id = r.id AND i.ended_at IS NULL
        LIMIT 1;

        -- 4. Sum all closed pause intervals
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (p.resumed_at - p.paused_at)))::INTEGER, 0)
        INTO v_total_paused
        FROM public.time_entry_pauses p
        WHERE p.time_entry_id = r.id AND p.resumed_at IS NOT NULL;

        -- 5. Sum all closed idle intervals (or preserve existing scalar if no interval rows)
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (i.ended_at - i.started_at)))::INTEGER, 0)
        INTO v_total_idle
        FROM public.time_entry_idles i
        WHERE i.time_entry_id = r.id AND i.ended_at IS NOT NULL;

        IF v_total_idle = 0 AND r.idle_duration_seconds > 0 THEN
            v_total_idle := r.idle_duration_seconds;
        END IF;

        -- 6. Calculate verified elapsed target duration
        v_final_active := COALESCE(r.active_duration_seconds, 0);
        v_final_idle := v_total_idle;
        v_target_elapsed := v_total_paused + v_final_idle + v_final_active;

        IF v_target_elapsed > 0 THEN
            v_target_ended_at := r.started_at + (v_target_elapsed * INTERVAL '1 second');
            v_reason := format('Crash recovery: closed abandoned %s timer using verified elapsed duration (%s seconds).', 
                               r.state, v_target_elapsed);
        ELSE
            -- 0 verified active/idle duration: set ended_at = started_at (empty range [t, t), 0s duration)
            v_target_ended_at := r.started_at;
            v_final_active := 0;
            v_final_idle := 0;
            v_reason := format('Crash recovery: closed abandoned %s timer with zero verified activity as 0s productive duration.', 
                               r.state);
        END IF;

        -- 7. Guard against clock desynchronization or future timestamps
        IF v_target_ended_at > now() THEN
            v_target_ended_at := now();
            v_available_elapsed := EXTRACT(EPOCH FROM (v_target_ended_at - r.started_at))::INTEGER - v_total_paused;
            IF v_available_elapsed <= 0 THEN
                v_final_active := 0;
                v_final_idle := 0;
            ELSIF v_final_idle > v_available_elapsed THEN
                v_final_idle := 0;
                v_final_active := GREATEST(0, v_available_elapsed);
            ELSE
                v_final_active := LEAST(v_final_active, v_available_elapsed - v_final_idle);
            END IF;
            v_reason := v_reason || ' (Clamped to current timestamp to prevent future intervals).';
        END IF;

        -- 7.5. Verify that all recorded pause and idle intervals chronologically fit inside proposed timeline
        SELECT 
            MIN(p.paused_at),
            MAX(COALESCE(p.resumed_at, p.paused_at))
        INTO v_min_pause_ts, v_max_pause_ts
        FROM public.time_entry_pauses p
        WHERE p.time_entry_id = r.id;

        SELECT 
            MIN(i.started_at),
            MAX(COALESCE(i.ended_at, i.started_at))
        INTO v_min_idle_ts, v_max_idle_ts
        FROM public.time_entry_idles i
        WHERE i.time_entry_id = r.id;

        IF (v_min_pause_ts IS NOT NULL AND v_min_pause_ts < r.started_at) OR 
           (v_min_idle_ts IS NOT NULL AND v_min_idle_ts < r.started_at) OR
           (v_max_pause_ts IS NOT NULL AND v_max_pause_ts > v_target_ended_at) OR
           (v_max_idle_ts IS NOT NULL AND v_max_idle_ts > v_target_ended_at) THEN
            
            UPDATE public.time_entries te
            SET state = 'quarantined',
                ended_at = v_target_ended_at,
                active_duration_seconds = 0,
                idle_duration_seconds = 0,
                is_recovered = true,
                recovery_reason = format('Quarantined during crash recovery: child interval timestamps exceed calculated recovery bounds [%s, %s].',
                    r.started_at, v_target_ended_at),
                updated_at = now()
            WHERE te.id = r.id;

            recovered_entry_id := r.id;
            user_id := r.user_id;
            original_state := r.state;
            started_at := r.started_at;
            ended_at := v_target_ended_at;
            active_seconds := 0;
            idle_seconds := 0;
            recovery_reason := format('Quarantined during crash recovery: child interval timestamps exceed calculated recovery bounds [%s, %s].',
                r.started_at, v_target_ended_at);
            RETURN NEXT;
            CONTINUE;
        END IF;

        -- 8. Check for active interval conflicts with existing timers (subtracting pauses and idles)
        SELECT COALESCE(
            range_agg(
                tstzrange(
                    GREATEST(r.started_at, p.paused_at),
                    LEAST(v_target_ended_at, p.resumed_at),
                    '[)'
                )
            ),
            tstzmultirange()
        )
        INTO v_inactive_multi
        FROM public.time_entry_pauses p
        WHERE p.time_entry_id = r.id
          AND p.resumed_at IS NOT NULL
          AND GREATEST(r.started_at, p.paused_at) < LEAST(v_target_ended_at, p.resumed_at);

        SELECT v_inactive_multi + COALESCE(
            range_agg(
                tstzrange(
                    GREATEST(r.started_at, i.started_at),
                    LEAST(v_target_ended_at, i.ended_at),
                    '[)'
                )
            ),
            tstzmultirange()
        )
        INTO v_inactive_multi
        FROM public.time_entry_idles i
        WHERE i.time_entry_id = r.id
          AND i.ended_at IS NOT NULL
          AND GREATEST(r.started_at, i.started_at) < LEAST(v_target_ended_at, i.ended_at);

        IF v_target_ended_at > r.started_at THEN
            v_candidate_active := tstzmultirange(tstzrange(r.started_at, v_target_ended_at, '[)')) - v_inactive_multi;
        ELSE
            v_candidate_active := tstzmultirange();
        END IF;

        v_conflict_id := public.fn_check_active_interval_conflict(
            r.user_id, 
            r.id, 
            v_candidate_active
        );

        IF v_conflict_id IS NOT NULL THEN
            -- Safely quarantine instead of failing the entire recovery process
            UPDATE public.time_entries te
            SET state = 'quarantined',
                ended_at = v_target_ended_at,
                active_duration_seconds = 0,
                idle_duration_seconds = 0,
                is_recovered = true,
                recovery_reason = format('Quarantined during crash recovery: active interval conflicts with time entry %s.', v_conflict_id),
                updated_at = now()
            WHERE te.id = r.id;

            recovered_entry_id := r.id;
            user_id := r.user_id;
            original_state := r.state;
            started_at := r.started_at;
            ended_at := v_target_ended_at;
            active_seconds := 0;
            idle_seconds := 0;
            recovery_reason := format('Quarantined during crash recovery: active interval conflicts with time entry %s.', v_conflict_id);
            RETURN NEXT;
            CONTINUE;
        END IF;

        -- 9. Normal Recovery Path (No Bounds Mismatch, No Conflict)
        -- Set ended_at on the parent timer first so child interval validators evaluate within [started_at, v_target_ended_at]
        UPDATE public.time_entries te
        SET ended_at = v_target_ended_at
        WHERE te.id = r.id;

        -- Close any open pause interval at its paused_at timestamp (0s duration added)
        IF v_open_pause.id IS NOT NULL THEN
            UPDATE public.time_entry_pauses p
            SET resumed_at = p.paused_at
            WHERE p.id = v_open_pause.id;
        END IF;

        -- Close any open idle interval at its started_at timestamp (0s duration added)
        IF v_open_idle.id IS NOT NULL THEN
            UPDATE public.time_entry_idles i
            SET ended_at = i.started_at
            WHERE i.id = v_open_idle.id;
        END IF;

        -- Commit recovery updates
        UPDATE public.time_entries te
        SET state = 'completed',
            active_duration_seconds = v_final_active,
            idle_duration_seconds = v_final_idle,
            is_recovered = true,
            recovery_reason = v_reason,
            updated_at = now()
        WHERE te.id = r.id;

        recovered_entry_id := r.id;
        user_id := r.user_id;
        original_state := r.state;
        started_at := r.started_at;
        ended_at := v_target_ended_at;
        active_seconds := v_final_active;
        idle_seconds := v_final_idle;
        recovery_reason := v_reason;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Ensure execute permissions match Kuro Phase 9 security specification:
-- Restricted to service_role (background recovery worker / pg_cron), revoked from authenticated & anon.
REVOKE ALL ON FUNCTION public.reconcile_stale_time_entries(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_time_entries(INTERVAL) TO service_role;

COMMIT;

