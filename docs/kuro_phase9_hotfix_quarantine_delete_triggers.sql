-- ============================================================================
-- KURO PHASE 9 -- HOTFIX: SQLSTATE 42501 IN QUARANTINE DELETE TRIGGERS
-- Functions:
--   1. public.fn_validate_time_entry_interval()
--   2. public.fn_validate_time_entry_pause()
--   3. public.fn_validate_time_entry_idle()
--
-- Target Issue:
--   During Supabase acceptance test execution of Test 10.6H/10.6L under
--   'authenticated' and 'service_role', the database engine raised:
--     "ERROR: SQLSTATE 42501: permission denied for table users"
--
-- Root Cause:
--   These three functions are SECURITY INVOKER. In their BEFORE DELETE
--   handlers, they inspected `EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)`
--   to distinguish direct deletion of quarantined records from account-deletion
--   cascades originating from auth.users.
--   In Supabase, neither client roles ('authenticated', 'anon') nor the API
--   'service_role' have SELECT privileges on the private auth.users table.
--   When any of these roles attempts a direct DELETE on a quarantined timer or
--   child pause/idle, PostgreSQL rejects the query against auth.users with 42501
--   before the trigger can raise the expected P0001 quarantine immutability exception.
--
-- Cascade Context & Resolution:
--   1. In Supabase, account deletions from auth.users (via GoTrue / Admin API / migrations)
--      execute under trusted administrative roles: `supabase_admin`, `supabase_auth_admin`,
--      or `postgres`. These roles own/manage auth.users and possess full SELECT rights.
--   2. Ordinary client and API roles ('authenticated', 'anon', 'service_role') can NEVER
--      initiate an account cascade directly. Any DELETE on a quarantined record
--      invoked by these roles is guaranteed to be an unauthorized direct deletion.
--   3. By checking `current_user IN ('authenticated', 'anon', 'service_role')` first,
--      the triggers immediately raise SQLSTATE P0001 without querying auth.users.
--   4. For trusted administrative roles (postgres, supabase_admin, supabase_auth_admin),
--      the trigger queries auth.users:
--      - If the account still exists, it is a direct deletion and raises P0001.
--      - If the account has been deleted, it is a legitimate foreign-key CASCADE,
--        and the trigger returns OLD cleanly.
--   5. No permissions on auth.users are granted to authenticated, anon, or service_role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Parent Time Entry Validator
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_time_entry_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_overlap_id UUID;
    v_open_pause_count INTEGER;
    v_open_idle_count INTEGER;
    v_candidate_active tstzmultirange;
BEGIN
    v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

    -- Concurrency serialization per user across all timer operations
    PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || v_user_id::text));

    -- Handle DELETE: Direct deletion on quarantined timers is forbidden (terminal forensic evidence).
    -- Cascade deletion is permitted ONLY if the parent account in auth.users is being deleted.
    IF TG_OP = 'DELETE' THEN
        IF OLD.state = 'quarantined' THEN
            -- Check current_user before querying auth.users to prevent SQLSTATE 42501 for unprivileged & API roles
            IF current_user IN ('authenticated', 'anon', 'service_role') THEN
                RAISE EXCEPTION 'Quarantined time entry records are terminal forensic evidence and cannot be deleted directly (Timer ID: %).', 
                    OLD.id
                    USING ERRCODE = 'P0001';
            END IF;

            -- For trusted administrative roles (e.g. postgres, supabase_admin, supabase_auth_admin),
            -- distinguish direct deletion from legitimate foreign-key account-deletion cascades
            IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
                RAISE EXCEPTION 'Quarantined time entry records are terminal forensic evidence and cannot be deleted directly (Timer ID: %).', 
                    OLD.id
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    -- Immutability check: cannot reopen a completed timer
    IF TG_OP = 'UPDATE' AND OLD.state = 'completed' AND NEW.state <> 'completed' THEN
        RAISE EXCEPTION 'Cannot reopen a completed time entry (ID: %). Create a new time entry instead.', OLD.id;
    END IF;

    -- Quarantined record immutability: block authenticated tampering, prevent direct state transitions, and lock core fields
    IF TG_OP = 'UPDATE' AND OLD.state = 'quarantined' THEN
        IF auth.role() = 'authenticated' THEN
            RAISE EXCEPTION 'Security violation: quarantined time entry (ID: %) is immutable and cannot be modified by authenticated clients.', OLD.id;
        END IF;

        -- Quarantine state is terminal against ordinary direct table UPDATEs: prevent accidental reopening by service_role or admin
        IF NEW.state IS DISTINCT FROM OLD.state THEN
            RAISE EXCEPTION 'Quarantined record state violation: state of quarantined time entry (ID: %) cannot be changed through direct table UPDATE (target state: %). Quarantined records are terminal forensic records.', OLD.id, NEW.state;
        END IF;

        IF NEW.started_at IS DISTINCT FROM OLD.started_at
           OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
           OR NEW.active_duration_seconds IS DISTINCT FROM OLD.active_duration_seconds
           OR NEW.idle_duration_seconds IS DISTINCT FROM OLD.idle_duration_seconds
           OR NEW.task_id IS DISTINCT FROM OLD.task_id
           OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.is_recovered IS DISTINCT FROM OLD.is_recovered
           OR NEW.recovery_reason IS DISTINCT FROM OLD.recovery_reason THEN
            RAISE EXCEPTION 'Quarantined record immutability violation: start/end timestamps, durations (must remain 0), task ownership, and recovery metadata cannot be modified on quarantined time entry %.', OLD.id;
        END IF;
    END IF;

    -- Chronology check
    IF NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at THEN
        RAISE EXCEPTION 'Invalid time entry chronology: ended_at (%) cannot precede started_at (%).', 
            NEW.ended_at, NEW.started_at;
    END IF;

    -- Validate state vs open pause and open idle intervals
    IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_open_pause_count
        FROM public.time_entry_pauses
        WHERE time_entry_id = NEW.id AND resumed_at IS NULL;

        SELECT COUNT(*) INTO v_open_idle_count
        FROM public.time_entry_idles
        WHERE time_entry_id = NEW.id AND ended_at IS NULL;

        IF NEW.state = 'completed' AND (v_open_pause_count > 0 OR v_open_idle_count > 0) THEN
            RAISE EXCEPTION 'Invalid timer state completed: cannot complete a timer that has an open pause or idle interval.';
        END IF;

        IF NEW.state = 'running' AND v_open_pause_count > 0 THEN
            NEW.state := 'paused';
        END IF;
    END IF;

    -- Active interval validation across all non-quarantined states
    IF NEW.state IN ('running', 'paused', 'completed') THEN
        IF TG_OP = 'INSERT' OR NEW.id IS NULL THEN
            IF COALESCE(NEW.ended_at, now()) > NEW.started_at THEN
                v_candidate_active := tstzmultirange(tstzrange(NEW.started_at, COALESCE(NEW.ended_at, now()), '[)'));
            ELSE
                v_candidate_active := tstzmultirange();
            END IF;
        ELSE
            v_candidate_active := public.fn_calculate_timer_active_multirange(
                NEW.id, 
                NEW.started_at, 
                NEW.ended_at
            );
        END IF;

        v_overlap_id := public.fn_check_active_interval_conflict(
            NEW.user_id, 
            NEW.id, 
            v_candidate_active
        );

        IF v_overlap_id IS NOT NULL THEN
            RAISE EXCEPTION 'Active work interval conflicts with existing time entry % for user %.', 
                v_overlap_id, NEW.user_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Child Pause Interval Validator
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_time_entry_pause()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_timer RECORD;
    v_old_timer RECORD;
    v_expanded_active tstzmultirange;
    v_overlap_id UUID;
    v_new_pause_multi tstzmultirange;
BEGIN
    v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

    -- Concurrency serialization per user
    PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || v_user_id::text));

    -- 1. Handle DELETE: check quarantined parent immutability and active expansion
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = OLD.time_entry_id;

        -- Prohibit direct DELETE on child pause records of quarantined timers.
        -- Allow cascade deletion ONLY if the user account itself is being deleted from auth.users.
        IF v_timer.id IS NOT NULL AND v_timer.state = 'quarantined' THEN
            -- Check current_user before querying auth.users to prevent SQLSTATE 42501 for unprivileged & API roles
            IF current_user IN ('authenticated', 'anon', 'service_role') THEN
                RAISE EXCEPTION 'Quarantined time entry child pause records are immutable and cannot be deleted directly (Timer ID: %, Pause ID: %).',
                    OLD.time_entry_id, OLD.id
                    USING ERRCODE = 'P0001';
            END IF;

            -- For trusted administrative roles (e.g. postgres, supabase_admin, supabase_auth_admin),
            -- distinguish direct deletion from legitimate foreign-key account-deletion cascades
            IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
                RAISE EXCEPTION 'Quarantined time entry child pause records are immutable and cannot be deleted directly (Timer ID: %, Pause ID: %).',
                    OLD.time_entry_id, OLD.id
                    USING ERRCODE = 'P0001';
            END IF;
            RETURN OLD;
        END IF;

        IF v_timer.id IS NOT NULL AND v_timer.state IN ('running', 'paused', 'completed') THEN
            v_expanded_active := public.fn_calculate_timer_active_multirange(
                OLD.time_entry_id, 
                v_timer.started_at, 
                v_timer.ended_at, 
                OLD.id
            );

            v_overlap_id := public.fn_check_active_interval_conflict(
                v_user_id, 
                OLD.time_entry_id, 
                v_expanded_active
            );

            IF v_overlap_id IS NOT NULL THEN
                RAISE EXCEPTION 'Cannot delete pause: expanding active work interval would conflict with time entry %.', 
                    v_overlap_id;
            END IF;
        END IF;

        RETURN OLD;
    END IF;

    -- 2. Handle UPDATE: IMMEDIATE QUARANTINE INTEGRITY CHECKS BEFORE ANY TIMING CHECKS
    IF TG_OP = 'UPDATE' THEN
        IF OLD.user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cannot change user ownership of a pause record.';
        END IF;

        -- Retrieve both old and new parent timers immediately
        SELECT * INTO v_old_timer 
        FROM public.time_entries 
        WHERE id = OLD.time_entry_id;

        IF v_old_timer.id IS NULL THEN
            RAISE EXCEPTION 'Pause record references non-existent previous time entry %.', OLD.time_entry_id;
        END IF;

        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = NEW.time_entry_id;

        IF v_timer.id IS NULL THEN
            RAISE EXCEPTION 'Pause record references non-existent time entry %.', NEW.time_entry_id;
        END IF;

        -- Prohibit modifying or moving pauses belonging to a quarantined timer
        IF v_old_timer.state = 'quarantined' THEN
            RAISE EXCEPTION 'Quarantined time entry child pause records are immutable and cannot be modified or moved (Timer ID: %, Pause ID: %).',
                OLD.time_entry_id, OLD.id
                USING ERRCODE = 'P0001';
        END IF;

        -- Prohibit moving a pause into a quarantined timer
        IF OLD.time_entry_id IS DISTINCT FROM NEW.time_entry_id AND v_timer.state = 'quarantined' THEN
            RAISE EXCEPTION 'Cannot move pause interval into quarantined time entry (Target Timer ID: %).',
                NEW.time_entry_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Handle INSERT: Immediate quarantine integrity check
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = NEW.time_entry_id;

        IF v_timer.id IS NULL THEN
            RAISE EXCEPTION 'Pause record references non-existent time entry %.', NEW.time_entry_id;
        END IF;

        IF v_timer.state = 'quarantined' THEN
            RAISE EXCEPTION 'Cannot insert pause interval into quarantined time entry (Timer ID: %). Quarantined records are immutable.', 
                NEW.time_entry_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 4. Shared Timing, Chronology, and Overlap Validations (Only for non-quarantined timers)
    IF v_timer.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Security violation: pause user_id (%) does not match timer user_id (%).', 
            NEW.user_id, v_timer.user_id;
    END IF;

    IF v_timer.state = 'completed' AND NEW.resumed_at IS NULL THEN
        RAISE EXCEPTION 'Invalid pause state: cannot add open pause to completed time entry %.', NEW.time_entry_id;
    END IF;

    IF NEW.paused_at < v_timer.started_at THEN
        RAISE EXCEPTION 'Invalid pause timeline: paused_at (%) cannot precede timer started_at (%).', 
            NEW.paused_at, v_timer.started_at;
    END IF;

    IF v_timer.ended_at IS NOT NULL AND NEW.paused_at > v_timer.ended_at THEN
        RAISE EXCEPTION 'Invalid pause timeline: paused_at (%) cannot occur after timer ended_at (%).', 
            NEW.paused_at, v_timer.ended_at;
    END IF;

    IF NEW.resumed_at IS NOT NULL THEN
        IF NEW.resumed_at < NEW.paused_at THEN
            RAISE EXCEPTION 'Invalid pause chronology: resumed_at (%) cannot precede paused_at (%).', 
                NEW.resumed_at, NEW.paused_at;
        END IF;
        IF v_timer.ended_at IS NOT NULL AND NEW.resumed_at > v_timer.ended_at THEN
            RAISE EXCEPTION 'Invalid pause timeline: resumed_at (%) cannot exceed timer ended_at (%).', 
                NEW.resumed_at, v_timer.ended_at;
        END IF;
    END IF;

    -- Ensure pause interval does not overlap any OTHER pause interval of the same timer (open or closed)
    -- Prevents an open pause from overlapping any closed pause interval,
    -- and prevents a closed pause from overlapping an existing open pause.
    SELECT id INTO v_overlap_id
    FROM public.time_entry_pauses
    WHERE time_entry_id = NEW.time_entry_id
      AND (TG_OP = 'INSERT' OR id <> NEW.id)
      AND tstzrange(paused_at, COALESCE(resumed_at, 'infinity'::timestamptz), '[)') &&
          tstzrange(NEW.paused_at, COALESCE(NEW.resumed_at, 'infinity'::timestamptz), '[)')
    LIMIT 1;

    IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'Pause interval [%, %) conflicts with existing pause interval % of the same timer.', 
            NEW.paused_at, COALESCE(NEW.resumed_at::text, 'open'), v_overlap_id;
    END IF;

    -- Ensure pause interval does not overlap any idle interval of the same timer (open or closed)
    SELECT id INTO v_overlap_id
    FROM public.time_entry_idles
    WHERE time_entry_id = NEW.time_entry_id
      AND tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') && 
          tstzrange(NEW.paused_at, COALESCE(NEW.resumed_at, 'infinity'::timestamptz), '[)')
    LIMIT 1;

    IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'Pause interval conflicts with idle interval % of the same timer.', v_overlap_id;
    END IF;

    -- 5. UPDATE Specific Active Interval Expansion Checks (for non-quarantined timers)
    IF TG_OP = 'UPDATE' THEN
        -- If pause moved between timers:
        IF OLD.time_entry_id IS DISTINCT FROM NEW.time_entry_id THEN
            IF v_old_timer.id IS NOT NULL AND v_old_timer.state IN ('running', 'paused', 'completed') THEN
                v_expanded_active := public.fn_calculate_timer_active_multirange(
                    OLD.time_entry_id, 
                    v_old_timer.started_at, 
                    v_old_timer.ended_at, 
                    OLD.id
                );

                v_overlap_id := public.fn_check_active_interval_conflict(
                    v_user_id, 
                    OLD.time_entry_id, 
                    v_expanded_active
                );

                IF v_overlap_id IS NOT NULL THEN
                    RAISE EXCEPTION 'Cannot move pause: expanding active work on previous time entry % conflicts with time entry %.', 
                        OLD.time_entry_id, v_overlap_id;
                END IF;
            END IF;
        ELSE
            -- Pause remained on same timer but timestamps changed: check if active intervals expanded
            IF v_timer.state IN ('running', 'paused', 'completed') THEN
                v_expanded_active := public.fn_calculate_timer_active_multirange(
                    NEW.time_entry_id, 
                    v_timer.started_at, 
                    v_timer.ended_at, 
                    OLD.id
                );
                v_new_pause_multi := tstzmultirange(tstzrange(
                    GREATEST(v_timer.started_at, NEW.paused_at),
                    LEAST(COALESCE(v_timer.ended_at, now()), COALESCE(NEW.resumed_at, COALESCE(v_timer.ended_at, now()))),
                    '[)'
                ));
                v_expanded_active := v_expanded_active - v_new_pause_multi;

                v_overlap_id := public.fn_check_active_interval_conflict(
                    v_user_id, 
                    NEW.time_entry_id, 
                    v_expanded_active
                );

                IF v_overlap_id IS NOT NULL THEN
                    RAISE EXCEPTION 'Modifying pause interval would create active work conflict with time entry %.', 
                        v_overlap_id;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Child Idle Interval Validator
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validate_time_entry_idle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_timer RECORD;
    v_old_timer RECORD;
    v_expanded_active tstzmultirange;
    v_overlap_id UUID;
    v_new_idle_multi tstzmultirange;
BEGIN
    v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

    -- Concurrency serialization per user
    PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || v_user_id::text));

    -- 1. Handle DELETE: check quarantined parent immutability and active expansion
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = OLD.time_entry_id;

        -- Prohibit direct DELETE on child idle records of quarantined timers.
        -- Allow cascade deletion ONLY if the user account itself is being deleted from auth.users.
        IF v_timer.id IS NOT NULL AND v_timer.state = 'quarantined' THEN
            -- Check current_user before querying auth.users to prevent SQLSTATE 42501 for unprivileged & API roles
            IF current_user IN ('authenticated', 'anon', 'service_role') THEN
                RAISE EXCEPTION 'Quarantined time entry child idle records are immutable and cannot be deleted directly (Timer ID: %, Idle ID: %).',
                    OLD.time_entry_id, OLD.id
                    USING ERRCODE = 'P0001';
            END IF;

            -- For trusted administrative roles (e.g. postgres, supabase_admin, supabase_auth_admin),
            -- distinguish direct deletion from legitimate foreign-key account-deletion cascades
            IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
                RAISE EXCEPTION 'Quarantined time entry child idle records are immutable and cannot be deleted directly (Timer ID: %, Idle ID: %).',
                    OLD.time_entry_id, OLD.id
                    USING ERRCODE = 'P0001';
            END IF;
            RETURN OLD;
        END IF;

        IF v_timer.id IS NOT NULL AND v_timer.state IN ('running', 'paused', 'completed') THEN
            v_expanded_active := public.fn_calculate_timer_active_multirange(
                OLD.time_entry_id, 
                v_timer.started_at, 
                v_timer.ended_at, 
                NULL,
                OLD.id
            );

            v_overlap_id := public.fn_check_active_interval_conflict(
                v_user_id, 
                OLD.time_entry_id, 
                v_expanded_active
            );

            IF v_overlap_id IS NOT NULL THEN
                RAISE EXCEPTION 'Cannot delete idle interval: expanding active work interval would conflict with time entry %.', 
                    v_overlap_id;
            END IF;
        END IF;

        RETURN OLD;
    END IF;

    -- 2. Handle UPDATE: IMMEDIATE QUARANTINE INTEGRITY CHECKS BEFORE ANY TIMING CHECKS
    IF TG_OP = 'UPDATE' THEN
        IF OLD.user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Cannot change user ownership of an idle record.';
        END IF;

        -- Retrieve both old and new parent timers immediately
        SELECT * INTO v_old_timer 
        FROM public.time_entries 
        WHERE id = OLD.time_entry_id;

        IF v_old_timer.id IS NULL THEN
            RAISE EXCEPTION 'Idle record references non-existent previous time entry %.', OLD.time_entry_id;
        END IF;

        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = NEW.time_entry_id;

        IF v_timer.id IS NULL THEN
            RAISE EXCEPTION 'Idle record references non-existent time entry %.', NEW.time_entry_id;
        END IF;

        -- Prohibit modifying or moving idle intervals belonging to a quarantined timer
        IF v_old_timer.state = 'quarantined' THEN
            RAISE EXCEPTION 'Quarantined time entry child idle records are immutable and cannot be modified or moved (Timer ID: %, Idle ID: %).',
                OLD.time_entry_id, OLD.id
                USING ERRCODE = 'P0001';
        END IF;

        -- Prohibit moving an idle interval into a quarantined timer
        IF OLD.time_entry_id IS DISTINCT FROM NEW.time_entry_id AND v_timer.state = 'quarantined' THEN
            RAISE EXCEPTION 'Cannot move idle interval into quarantined time entry (Target Timer ID: %).',
                NEW.time_entry_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Handle INSERT: Immediate quarantine integrity check
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = NEW.time_entry_id;

        IF v_timer.id IS NULL THEN
            RAISE EXCEPTION 'Idle record references non-existent time entry %.', NEW.time_entry_id;
        END IF;

        IF v_timer.state = 'quarantined' THEN
            RAISE EXCEPTION 'Cannot insert idle interval into quarantined time entry (Timer ID: %). Quarantined records are immutable.', 
                NEW.time_entry_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 4. Shared Timing, Chronology, and Overlap Validations (Only for non-quarantined timers)
    IF v_timer.user_id <> NEW.user_id THEN
        RAISE EXCEPTION 'Security violation: idle user_id (%) does not match timer user_id (%).', 
            NEW.user_id, v_timer.user_id;
    END IF;

    IF v_timer.state = 'completed' AND NEW.ended_at IS NULL THEN
        RAISE EXCEPTION 'Invalid idle state: cannot add open idle interval to completed time entry %.', NEW.time_entry_id;
    END IF;

    IF NEW.started_at < v_timer.started_at THEN
        RAISE EXCEPTION 'Invalid idle timeline: started_at (%) cannot precede timer started_at (%).', 
            NEW.started_at, v_timer.started_at;
    END IF;

    IF v_timer.ended_at IS NOT NULL AND NEW.started_at > v_timer.ended_at THEN
        RAISE EXCEPTION 'Invalid idle timeline: started_at (%) cannot occur after timer ended_at (%).', 
            NEW.started_at, v_timer.ended_at;
    END IF;

    IF NEW.ended_at IS NOT NULL THEN
        IF NEW.ended_at < NEW.started_at THEN
            RAISE EXCEPTION 'Invalid idle chronology: ended_at (%) cannot precede started_at (%).', 
                NEW.ended_at, NEW.started_at;
        END IF;
        IF v_timer.ended_at IS NOT NULL AND NEW.ended_at > v_timer.ended_at THEN
            RAISE EXCEPTION 'Invalid idle timeline: ended_at (%) cannot exceed timer ended_at (%).', 
                NEW.ended_at, v_timer.ended_at;
        END IF;
    END IF;

    -- Ensure idle interval does not overlap any OTHER idle interval of the same timer (open or closed)
    -- Prevents an open idle interval from overlapping any closed idle interval belonging to the same timer,
    -- and prevents a closed interval from overlapping an existing open interval.
    SELECT id INTO v_overlap_id
    FROM public.time_entry_idles
    WHERE time_entry_id = NEW.time_entry_id
      AND (TG_OP = 'INSERT' OR id <> NEW.id)
      AND tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') &&
          tstzrange(NEW.started_at, COALESCE(NEW.ended_at, 'infinity'::timestamptz), '[)')
    LIMIT 1;

    IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'Idle interval [%, %) conflicts with existing idle interval % of the same timer.',
            NEW.started_at, COALESCE(NEW.ended_at::text, 'open'), v_overlap_id;
    END IF;

    -- Ensure idle interval does not overlap any pause interval of the same timer (open or closed)
    SELECT id INTO v_overlap_id
    FROM public.time_entry_pauses
    WHERE time_entry_id = NEW.time_entry_id
      AND tstzrange(paused_at, COALESCE(resumed_at, 'infinity'::timestamptz), '[)') && 
          tstzrange(NEW.started_at, COALESCE(NEW.ended_at, 'infinity'::timestamptz), '[)')
    LIMIT 1;

    IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'Idle interval conflicts with pause interval % of the same timer.', v_overlap_id;
    END IF;

    -- 5. UPDATE Specific Active Interval Expansion Checks (for non-quarantined timers)
    IF TG_OP = 'UPDATE' THEN
        -- If idle interval moved between timers:
        IF OLD.time_entry_id IS DISTINCT FROM NEW.time_entry_id THEN
            IF v_old_timer.id IS NOT NULL AND v_old_timer.state IN ('running', 'paused', 'completed') THEN
                v_expanded_active := public.fn_calculate_timer_active_multirange(
                    OLD.time_entry_id, 
                    v_old_timer.started_at, 
                    v_old_timer.ended_at, 
                    NULL,
                    OLD.id
                );

                v_overlap_id := public.fn_check_active_interval_conflict(
                    v_user_id, 
                    OLD.time_entry_id, 
                    v_expanded_active
                );

                IF v_overlap_id IS NOT NULL THEN
                    RAISE EXCEPTION 'Cannot move idle: expanding active work on previous time entry % conflicts with time entry %.', 
                        OLD.time_entry_id, v_overlap_id;
                END IF;
            END IF;
        ELSE
            -- Idle interval remained on same timer but timestamps changed: check if active intervals expanded
            IF v_timer.state IN ('running', 'paused', 'completed') THEN
                v_expanded_active := public.fn_calculate_timer_active_multirange(
                    NEW.time_entry_id, 
                    v_timer.started_at, 
                    v_timer.ended_at, 
                    NULL,
                    OLD.id
                );
                v_new_idle_multi := tstzmultirange(tstzrange(
                    GREATEST(v_timer.started_at, NEW.started_at),
                    LEAST(COALESCE(v_timer.ended_at, now()), COALESCE(NEW.ended_at, COALESCE(v_timer.ended_at, now()))),
                    '[)'
                ));
                v_expanded_active := v_expanded_active - v_new_idle_multi;

                v_overlap_id := public.fn_check_active_interval_conflict(
                    v_user_id, 
                    NEW.time_entry_id, 
                    v_expanded_active
                );

                IF v_overlap_id IS NOT NULL THEN
                    RAISE EXCEPTION 'Modifying idle interval would create active work conflict with time entry %.', 
                        v_overlap_id;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Permissions & Grants Hardening (Aligns with Phase 9 Specification)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_validate_time_entry_interval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_validate_time_entry_pause() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_validate_time_entry_idle() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_validate_time_entry_interval() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_time_entry_pause() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_time_entry_idle() TO service_role;

COMMIT;