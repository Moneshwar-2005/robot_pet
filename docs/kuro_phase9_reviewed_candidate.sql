-- ============================================================================
-- KURO HYBRID PERSONAL ASSISTANT & SMART ROBOT PET
-- DATABASE UPGRADE MIGRATION: PHASE 9 (REVISION 15 — FINAL DOCUMENTATION CORRECTIONS ONLY)
-- ============================================================================
-- Architecture Baseline:
--   - Authoritative identity root: auth.users(id).
--   - Profile cache: public.users(id) (optional application cache).
--   - Multi-tenant boundary: Composite foreign keys (user_id, id) + RLS.
--   - Container integrity: ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
--     prevents accidental deletion of populated projects/boards while allowing
--     clean cascading user account deletion.
--   - Temporal Model: Active Work Multirange model (tstzmultirange).
--     Pauses strictly carved out of elapsed time; non-overlapping active work
--     verified across all timer states with per-user transaction serialization.
-- ============================================================================
-- Wrapped in an atomic transaction block. Any failure reverts all operations.
-- Status: APPROVED FOR STAGING DEPLOYMENT (requires multi-account RLS validation in staging).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 0: EXHAUSTIVE STRUCTURAL COMPATIBILITY PRE-CHECKS (FAIL-FAST DEFENSE)
-- ----------------------------------------------------------------------------
-- Validates baseline tables, required columns, data types, nullability, RLS,
-- baseline columns used in migration, and authoritative identity ownership.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    v_type TEXT;
    v_nullable TEXT;
    v_rls_tasks BOOLEAN;
    v_rls_prefs BOOLEAN;
    v_orphan_count BIGINT;
BEGIN
    -- 0.1 Baseline table public.tasks existence
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tasks') THEN
        RAISE EXCEPTION 'Pre-check failed: baseline table public.tasks does not exist.';
    END IF;

    -- 0.2 public.tasks.id (must be uuid, NOT NULL)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'id';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.tasks.id does not exist.';
    ELSIF v_type <> 'uuid' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.id must be uuid NOT NULL (found type %, nullable %).', v_type, v_nullable;
    END IF;

    -- 0.3 public.tasks.user_id (must be uuid, NOT NULL)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'user_id';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.tasks.user_id does not exist.';
    ELSIF v_type <> 'uuid' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.user_id must be uuid NOT NULL (found type %, nullable %).', v_type, v_nullable;
    END IF;

    -- 0.4 public.tasks.completed (must be boolean, NOT NULL)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'completed';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.tasks.completed does not exist.';
    ELSIF v_type <> 'boolean' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.completed must be boolean NOT NULL (found type %, nullable %).', v_type, v_nullable;
    END IF;

    -- 0.4a public.tasks.title (must exist, text or varchar)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'title';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.tasks.title does not exist.';
    ELSIF v_type NOT IN ('text', 'character varying') THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.title has incompatible type % (expected text or varchar).', v_type;
    END IF;

    -- 0.5 public.tasks.updated_at (must exist, timestamptz/timestamp)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'updated_at';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.tasks.updated_at does not exist.';
    ELSIF v_type NOT IN ('timestamp with time zone', 'timestamp without time zone') THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.updated_at has incompatible type % (expected timestamptz).', v_type;
    END IF;

    -- 0.6 Baseline table public.user_preferences existence
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_preferences') THEN
        RAISE EXCEPTION 'Pre-check failed: baseline table public.user_preferences does not exist.';
    END IF;

    -- 0.7 public.user_preferences.user_id (must be uuid, NOT NULL)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'user_preferences' AND column_name = 'user_id';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.user_preferences.user_id does not exist.';
    ELSIF v_type <> 'uuid' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.user_preferences.user_id must be uuid NOT NULL (found type %, nullable %).', v_type, v_nullable;
    END IF;

    -- 0.7a public.user_preferences.theme (must exist, text or varchar)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'user_preferences' AND column_name = 'theme';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.user_preferences.theme does not exist.';
    ELSIF v_type NOT IN ('text', 'character varying') THEN
        RAISE EXCEPTION 'Pre-check failed: public.user_preferences.theme has incompatible type % (expected text or varchar).', v_type;
    END IF;

    -- 0.8 RLS active on baseline public.tasks
    SELECT relrowsecurity INTO v_rls_tasks FROM pg_class WHERE oid = 'public.tasks'::regclass;
    IF NOT v_rls_tasks THEN
        RAISE EXCEPTION 'Pre-check failed: Row Level Security is not enabled on public.tasks.';
    END IF;

    -- 0.9 RLS active on baseline public.user_preferences
    SELECT relrowsecurity INTO v_rls_prefs FROM pg_class WHERE oid = 'public.user_preferences'::regclass;
    IF NOT v_rls_prefs THEN
        RAISE EXCEPTION 'Pre-check failed: Row Level Security is not enabled on public.user_preferences.';
    END IF;

    -- 0.10 Existing Phase 9 columns on public.tasks (defensive type check)
    SELECT data_type INTO v_type FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'project_id';
    IF v_type IS NOT NULL AND v_type <> 'uuid' THEN
        RAISE EXCEPTION 'Pre-check failed: existing public.tasks.project_id has incompatible type % (expected uuid).', v_type;
    END IF;

    SELECT data_type INTO v_type FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'board_id';
    IF v_type IS NOT NULL AND v_type <> 'uuid' THEN
        RAISE EXCEPTION 'Pre-check failed: existing public.tasks.board_id has incompatible type % (expected uuid).', v_type;
    END IF;

    SELECT data_type INTO v_type FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'column_id';
    IF v_type IS NOT NULL AND v_type <> 'uuid' THEN
        RAISE EXCEPTION 'Pre-check failed: existing public.tasks.column_id has incompatible type % (expected uuid).', v_type;
    END IF;

    -- 0.11 Authoritative identity verification before reconciliation
    SELECT COUNT(*) INTO v_orphan_count 
    FROM public.tasks t
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id);
    IF v_orphan_count > 0 THEN
        RAISE EXCEPTION 'Pre-check failed: found % orphaned tasks whose user_id does not exist in auth.users.', v_orphan_count;
    END IF;

    SELECT COUNT(*) INTO v_orphan_count 
    FROM public.user_preferences p
    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id);
    IF v_orphan_count > 0 THEN
        RAISE EXCEPTION 'Pre-check failed: found % orphaned user_preferences whose user_id does not exist in auth.users.', v_orphan_count;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 1: EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ----------------------------------------------------------------------------
-- STEP 2: BASELINE TABLE ADDITIVE EXTENSIONS
-- ----------------------------------------------------------------------------

-- 2.1 Additive columns on public.tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS board_id UUID;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS column_id UUID;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'todo';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER DEFAULT 0;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure composite uniqueness on tasks for foreign key targets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tasks_user_id_id_unique' AND conrelid = 'public.tasks'::regclass
    ) THEN
        ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_id_id_unique UNIQUE (user_id, id);
    END IF;
END $$;

-- 2.2 Additive columns on public.user_preferences (Privacy defaults: false)
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS activity_tracking_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS idle_threshold_seconds INTEGER DEFAULT 300;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS auto_reports_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS daily_report_time TIME DEFAULT '18:00:00';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS telemetry_retention_days INTEGER DEFAULT 30;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS tracking_include_window_titles BOOLEAN DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS tracking_include_process_names BOOLEAN DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS music_reaction_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS auto_break_reminders BOOLEAN DEFAULT true;

-- ----------------------------------------------------------------------------
-- STEP 3: NEW APPLICATION TABLES & NORMALIZED TIME TRACKING
-- ----------------------------------------------------------------------------

-- 3.1 Projects Table
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    color VARCHAR(30) DEFAULT 'cyan',
    icon VARCHAR(60) DEFAULT 'folder',
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT projects_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT chk_project_name_not_empty CHECK (char_length(trim(name)) > 0)
);

-- 3.2 Project Boards Table
CREATE TABLE IF NOT EXISTS public.project_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    board_type VARCHAR(30) NOT NULL DEFAULT 'kanban',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_boards_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT fk_boards_project FOREIGN KEY (user_id, project_id)
        REFERENCES public.projects(user_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_board_type CHECK (board_type IN ('kanban', 'scrum'))
);

-- 3.3 Board Columns Table
CREATE TABLE IF NOT EXISTS public.board_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    board_id UUID NOT NULL,
    name VARCHAR(60) NOT NULL,
    status_category VARCHAR(30) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    wip_limit INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT board_columns_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT fk_columns_board FOREIGN KEY (user_id, board_id)
        REFERENCES public.project_boards(user_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_column_status_category CHECK (status_category IN ('backlog', 'todo', 'in_progress', 'done', 'cancelled')),
    CONSTRAINT chk_column_wip_limit CHECK (wip_limit >= 0)
);

-- Single column per status category per board
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_board_status_category' AND conrelid = 'public.board_columns'::regclass
    ) THEN
        ALTER TABLE public.board_columns ADD CONSTRAINT uq_board_status_category UNIQUE (board_id, status_category);
    END IF;
END $$;

-- 3.4 Task Labels Table
CREATE TABLE IF NOT EXISTS public.task_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID,
    name VARCHAR(60) NOT NULL,
    color VARCHAR(30) NOT NULL DEFAULT 'blue',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_labels_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT fk_task_labels_project FOREIGN KEY (user_id, project_id)
        REFERENCES public.projects(user_id, id) ON DELETE CASCADE
);

-- 3.5 Task Label Assignments
CREATE TABLE IF NOT EXISTS public.task_label_assignments (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    label_id UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, label_id),
    CONSTRAINT fk_label_assign_task FOREIGN KEY (user_id, task_id)
        REFERENCES public.tasks(user_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_label_assign_label FOREIGN KEY (user_id, label_id)
        REFERENCES public.task_labels(user_id, id) ON DELETE CASCADE
);

-- 3.6 Task Status History Audit Log (Immutable System Ledger)
CREATE TABLE IF NOT EXISTS public.task_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    from_column_id UUID,
    to_column_id UUID,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_history_task FOREIGN KEY (user_id, task_id)
        REFERENCES public.tasks(user_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_history_to_col FOREIGN KEY (user_id, to_column_id)
        REFERENCES public.board_columns(user_id, id) ON DELETE SET NULL (to_column_id)
);

-- 3.7 Time Entries Table (Granular Lifecycle)
CREATE TABLE IF NOT EXISTS public.time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID,
    project_id UUID,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    active_duration_seconds INTEGER NOT NULL DEFAULT 0,
    idle_duration_seconds INTEGER NOT NULL DEFAULT 0,
    tracking_source VARCHAR(30) NOT NULL DEFAULT 'manual',
    state VARCHAR(20) NOT NULL DEFAULT 'running',
    is_recovered BOOLEAN NOT NULL DEFAULT false,
    recovery_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT time_entries_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT fk_time_entry_task FOREIGN KEY (user_id, task_id)
        REFERENCES public.tasks(user_id, id) ON DELETE SET NULL (task_id),
    CONSTRAINT fk_time_entry_project FOREIGN KEY (user_id, project_id)
        REFERENCES public.projects(user_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT chk_time_entry_state CHECK (state IN ('running', 'paused', 'completed', 'quarantined')),
    CONSTRAINT chk_time_entry_source CHECK (tracking_source IN ('manual', 'companion', 'pomodoro')),
    CONSTRAINT chk_time_entry_chronology CHECK (ended_at IS NULL OR ended_at >= started_at),
    CONSTRAINT chk_time_entry_completed_has_end CHECK (state <> 'completed' OR ended_at IS NOT NULL),
    CONSTRAINT chk_time_entry_durations_non_negative CHECK (active_duration_seconds >= 0 AND idle_duration_seconds >= 0)
);

-- Guarded additive columns for partial Phase 9 migration compatibility
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS is_recovered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS recovery_reason TEXT;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS idle_duration_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS active_duration_seconds INTEGER NOT NULL DEFAULT 0;

-- Exactly one running timer per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_running_timer_per_user 
    ON public.time_entries(user_id) 
    WHERE (state = 'running');

-- Bounding range GiST index for ultra-fast active interval conflict lookups
CREATE INDEX IF NOT EXISTS idx_time_entries_user_range 
    ON public.time_entries USING gist (
        user_id, 
        tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)')
    ) WHERE (state IN ('running', 'paused', 'completed'));

-- Drop legacy bounding-box exclusion constraint if present, because bounding-box
-- comparison incorrectly rejects timers whose active intervals do not overlap (e.g.
-- when one timer is active while another timer is paused). Active intervals are
-- strictly enforced by public.fn_validate_time_entry_interval().
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exclude_overlapping_completed_intervals' AND conrelid = 'public.time_entries'::regclass
    ) THEN
        ALTER TABLE public.time_entries DROP CONSTRAINT exclude_overlapping_completed_intervals;
    END IF;
END $$;

-- 3.8 Normalized Time Entry Pauses Table (Multiple Pause/Resume Cycles)
CREATE TABLE IF NOT EXISTS public.time_entry_pauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    time_entry_id UUID NOT NULL,
    paused_at TIMESTAMPTZ NOT NULL,
    resumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT time_entry_pauses_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT fk_pause_time_entry FOREIGN KEY (user_id, time_entry_id)
        REFERENCES public.time_entries(user_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_pause_chronology CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

-- At most one open pause per time entry
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_pause_per_entry 
    ON public.time_entry_pauses(time_entry_id) 
    WHERE (resumed_at IS NULL);

-- Exclusion constraint on closed pauses belonging to the same timer
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exclude_overlapping_timer_pauses' AND conrelid = 'public.time_entry_pauses'::regclass
    ) THEN
        ALTER TABLE public.time_entry_pauses ADD CONSTRAINT exclude_overlapping_timer_pauses
            EXCLUDE USING gist (
                time_entry_id WITH =,
                tstzrange(paused_at, resumed_at, '[)') WITH &&
            ) WHERE (resumed_at IS NOT NULL);
    END IF;
END $$;

-- 3.9 Normalized Time Entry Idle Intervals Table (Granular AFK / Idle Periods)
CREATE TABLE IF NOT EXISTS public.time_entry_idles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    time_entry_id UUID NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT time_entry_idles_user_id_id_unique UNIQUE (user_id, id),
    CONSTRAINT fk_idle_time_entry FOREIGN KEY (user_id, time_entry_id)
        REFERENCES public.time_entries(user_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_idle_chronology CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- At most one open idle interval per time entry
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_idle_per_entry 
    ON public.time_entry_idles(time_entry_id) 
    WHERE (ended_at IS NULL);

-- Exclusion constraint on closed idle intervals belonging to the same timer
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exclude_overlapping_timer_idles' AND conrelid = 'public.time_entry_idles'::regclass
    ) THEN
        ALTER TABLE public.time_entry_idles ADD CONSTRAINT exclude_overlapping_timer_idles
            EXCLUDE USING gist (
                time_entry_id WITH =,
                tstzrange(started_at, ended_at, '[)') WITH &&
            ) WHERE (ended_at IS NOT NULL);
    END IF;
END $$;

-- 3.10 Computer Activity Events Table
CREATE TABLE IF NOT EXISTS public.computer_activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID,
    project_id UUID,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_seconds INTEGER NOT NULL,
    application_name VARCHAR(120) NOT NULL,
    window_title VARCHAR(255),
    activity_category VARCHAR(60) NOT NULL DEFAULT 'general',
    is_idle BOOLEAN NOT NULL DEFAULT false,
    dedup_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_activity_task FOREIGN KEY (user_id, task_id)
        REFERENCES public.tasks(user_id, id) ON DELETE SET NULL (task_id),
    CONSTRAINT fk_activity_project FOREIGN KEY (user_id, project_id)
        REFERENCES public.projects(user_id, id) ON DELETE SET NULL (project_id),
    CONSTRAINT uq_activity_dedup UNIQUE (user_id, dedup_hash),
    CONSTRAINT chk_activity_duration CHECK (duration_seconds > 0),
    CONSTRAINT chk_activity_window_title_privacy CHECK (
        window_title IS NULL OR (
            window_title !~* '(password|secret|bearer|auth[_-]?token|credential|private[_-]?key)'
        )
    )
);

-- 3.10 Pet Reaction Logs Table
CREATE TABLE IF NOT EXISTS public.pet_reaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID,
    reaction_type VARCHAR(60) NOT NULL,
    trigger_event VARCHAR(60) NOT NULL,
    emotion_displayed VARCHAR(30) NOT NULL,
    dialogue_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_reaction_task FOREIGN KEY (user_id, task_id)
        REFERENCES public.tasks(user_id, id) ON DELETE SET NULL (task_id)
);

-- 3.11 Daily Reports Table
CREATE TABLE IF NOT EXISTS public.daily_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_date DATE NOT NULL,
    total_focus_seconds INTEGER NOT NULL DEFAULT 0,
    total_idle_seconds INTEGER NOT NULL DEFAULT 0,
    tasks_completed_count INTEGER NOT NULL DEFAULT 0,
    tasks_created_count INTEGER NOT NULL DEFAULT 0,
    project_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    application_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_narrative TEXT,
    actionable_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    generation_status VARCHAR(30) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_report_user_date UNIQUE (user_id, report_date),
    CONSTRAINT chk_report_generation_status CHECK (generation_status IN ('pending', 'generating', 'completed', 'failed'))
);

-- ----------------------------------------------------------------------------
-- STEP 4: EXISTING DATA RECONCILIATION & CONTAINER SETUP
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    u_rec RECORD;
    v_project_id UUID;
    v_board_id UUID;
    v_backlog_col_id UUID;
    v_todo_col_id UUID;
    v_in_progress_col_id UUID;
    v_done_col_id UUID;
    v_cancelled_col_id UUID;
BEGIN
    FOR u_rec IN 
        SELECT DISTINCT user_id FROM public.tasks
        UNION
        SELECT DISTINCT user_id FROM public.projects
    LOOP
        -- 1. Locate or create canonical default project
        SELECT id INTO v_project_id 
        FROM public.projects 
        WHERE user_id = u_rec.user_id AND is_archived = false
        ORDER BY created_at ASC 
        LIMIT 1;

        IF v_project_id IS NULL THEN
            INSERT INTO public.projects (user_id, name, description, color, icon)
            VALUES (u_rec.user_id, 'General', 'Default workspace project for unassigned tasks', 'cyan', 'folder')
            RETURNING id INTO v_project_id;
        END IF;

        -- 2. Locate or create default board
        SELECT id INTO v_board_id 
        FROM public.project_boards 
        WHERE user_id = u_rec.user_id AND project_id = v_project_id
        ORDER BY position ASC, created_at ASC 
        LIMIT 1;

        IF v_board_id IS NULL THEN
            INSERT INTO public.project_boards (user_id, project_id, name, board_type, position)
            VALUES (u_rec.user_id, v_project_id, 'Main Board', 'kanban', 0)
            RETURNING id INTO v_board_id;
        END IF;

        -- 3. Ensure all 5 canonical workflow columns exist on the board
        SELECT id INTO v_backlog_col_id FROM public.board_columns 
        WHERE board_id = v_board_id AND status_category = 'backlog' LIMIT 1;
        IF v_backlog_col_id IS NULL THEN
            INSERT INTO public.board_columns (user_id, board_id, name, status_category, position)
            VALUES (u_rec.user_id, v_board_id, 'Backlog', 'backlog', 0)
            RETURNING id INTO v_backlog_col_id;
        END IF;

        SELECT id INTO v_todo_col_id FROM public.board_columns 
        WHERE board_id = v_board_id AND status_category = 'todo' LIMIT 1;
        IF v_todo_col_id IS NULL THEN
            INSERT INTO public.board_columns (user_id, board_id, name, status_category, position)
            VALUES (u_rec.user_id, v_board_id, 'To Do', 'todo', 1)
            RETURNING id INTO v_todo_col_id;
        END IF;

        SELECT id INTO v_in_progress_col_id FROM public.board_columns 
        WHERE board_id = v_board_id AND status_category = 'in_progress' LIMIT 1;
        IF v_in_progress_col_id IS NULL THEN
            INSERT INTO public.board_columns (user_id, board_id, name, status_category, position)
            VALUES (u_rec.user_id, v_board_id, 'In Progress', 'in_progress', 2)
            RETURNING id INTO v_in_progress_col_id;
        END IF;

        SELECT id INTO v_done_col_id FROM public.board_columns 
        WHERE board_id = v_board_id AND status_category = 'done' LIMIT 1;
        IF v_done_col_id IS NULL THEN
            INSERT INTO public.board_columns (user_id, board_id, name, status_category, position)
            VALUES (u_rec.user_id, v_board_id, 'Done', 'done', 3)
            RETURNING id INTO v_done_col_id;
        END IF;

        SELECT id INTO v_cancelled_col_id FROM public.board_columns 
        WHERE board_id = v_board_id AND status_category = 'cancelled' LIMIT 1;
        IF v_cancelled_col_id IS NULL THEN
            INSERT INTO public.board_columns (user_id, board_id, name, status_category, position)
            VALUES (u_rec.user_id, v_board_id, 'Cancelled', 'cancelled', 4)
            RETURNING id INTO v_cancelled_col_id;
        END IF;

        -- 4. Reconcile existing tasks lacking valid assignments
        UPDATE public.tasks t
        SET 
            project_id = v_project_id,
            board_id = v_board_id,
            column_id = CASE 
                WHEN t.completed = true THEN v_done_col_id
                WHEN t.status = 'backlog' THEN v_backlog_col_id
                WHEN t.status = 'in_progress' THEN v_in_progress_col_id
                WHEN t.status = 'cancelled' THEN v_cancelled_col_id
                ELSE v_todo_col_id
            END,
            status = CASE 
                WHEN t.completed = true THEN 'done'
                WHEN t.status = 'backlog' THEN 'backlog'
                WHEN t.status = 'in_progress' THEN 'in_progress'
                WHEN t.status = 'cancelled' THEN 'cancelled'
                ELSE 'todo'
            END,
            completed_at = CASE 
                WHEN t.completed = true AND t.completed_at IS NULL THEN t.updated_at
                WHEN t.completed = false THEN NULL
                ELSE t.completed_at
            END,
            status_updated_at = COALESCE(t.status_updated_at, t.updated_at, now())
        WHERE t.user_id = u_rec.user_id
          AND (
                t.project_id IS NULL OR t.board_id IS NULL OR t.column_id IS NULL
                OR NOT EXISTS (
                    SELECT 1
                    FROM public.project_boards pb
                    WHERE pb.id = t.board_id
                      AND pb.user_id = t.user_id
                      AND pb.project_id = t.project_id
                )
                OR NOT EXISTS (
                    SELECT 1
                    FROM public.board_columns bc
                    WHERE bc.id = t.column_id
                      AND bc.user_id = t.user_id
                      AND bc.board_id = t.board_id
                )
          );
    END LOOP;
END $$;

-- 4.1 Ensure every existing board has the five canonical workflow categories.
-- The previous block creates/repairs these only on the user's default board.
DO $$
DECLARE
    b_rec RECORD;
    v_category TEXT;
    v_name TEXT;
    v_position INTEGER;
BEGIN
    FOR b_rec IN
        SELECT id, user_id
        FROM public.project_boards
    LOOP
        FOR v_category, v_name, v_position IN
            SELECT * FROM (VALUES
                ('backlog'::TEXT, 'Backlog'::TEXT, 0),
                ('todo'::TEXT, 'To Do'::TEXT, 1),
                ('in_progress'::TEXT, 'In Progress'::TEXT, 2),
                ('done'::TEXT, 'Done'::TEXT, 3),
                ('cancelled'::TEXT, 'Cancelled'::TEXT, 4)
            ) AS categories(category, display_name, sort_position)
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM public.board_columns bc
                WHERE bc.user_id = b_rec.user_id
                  AND bc.board_id = b_rec.id
                  AND bc.status_category = v_category
            ) THEN
                INSERT INTO public.board_columns
                    (user_id, board_id, name, status_category, position)
                VALUES
                    (b_rec.user_id, b_rec.id, v_name, v_category, v_position);
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 5: PRE-VALIDATION CHECK BEFORE FOREIGN KEY INSTALLATION
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_unassigned_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_unassigned_count 
    FROM public.tasks 
    WHERE project_id IS NULL OR board_id IS NULL OR column_id IS NULL;

    IF v_unassigned_count > 0 THEN
        RAISE EXCEPTION 'Integrity validation failed: found % tasks without project/board/column assignments.', v_unassigned_count;
    END IF;

    SELECT COUNT(*) INTO v_unassigned_count
    FROM public.tasks t
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.project_boards pb
        WHERE pb.id = t.board_id
          AND pb.user_id = t.user_id
          AND pb.project_id = t.project_id
    )
    OR NOT EXISTS (
        SELECT 1
        FROM public.board_columns bc
        WHERE bc.id = t.column_id
          AND bc.user_id = t.user_id
          AND bc.board_id = t.board_id
    );

    IF v_unassigned_count > 0 THEN
        RAISE EXCEPTION 'Integrity validation failed: % tasks have inconsistent project/board/column hierarchy after reconciliation.', v_unassigned_count;
    END IF;

    SELECT COUNT(*) INTO v_unassigned_count
    FROM public.tasks child
    LEFT JOIN public.tasks parent
      ON parent.id = child.parent_task_id
     AND parent.user_id = child.user_id
    WHERE child.parent_task_id IS NOT NULL
      AND (parent.id IS NULL OR parent.project_id IS DISTINCT FROM child.project_id);

    IF v_unassigned_count > 0 THEN
        RAISE EXCEPTION 'Integrity validation failed: % tasks have missing, cross-user, or cross-project parent references.', v_unassigned_count;
    END IF;
END $$;

-- Enforce NOT NULL on tasks relationship columns
ALTER TABLE public.tasks ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN board_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN column_id SET NOT NULL;

-- ----------------------------------------------------------------------------
-- STEP 6: COMPOSITE FOREIGN KEYS ON TASKS TABLE
-- ----------------------------------------------------------------------------
-- Deferrable NO ACTION allows clean user deletion cascade without race conditions.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_project' AND conrelid = 'public.tasks'::regclass) THEN
        ALTER TABLE public.tasks ADD CONSTRAINT fk_tasks_project 
            FOREIGN KEY (user_id, project_id) REFERENCES public.projects(user_id, id) 
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_board' AND conrelid = 'public.tasks'::regclass) THEN
        ALTER TABLE public.tasks ADD CONSTRAINT fk_tasks_board 
            FOREIGN KEY (user_id, board_id) REFERENCES public.project_boards(user_id, id) 
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_column' AND conrelid = 'public.tasks'::regclass) THEN
        ALTER TABLE public.tasks ADD CONSTRAINT fk_tasks_column 
            FOREIGN KEY (user_id, column_id) REFERENCES public.board_columns(user_id, id) 
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_parent_task' AND conrelid = 'public.tasks'::regclass) THEN
        ALTER TABLE public.tasks ADD CONSTRAINT fk_tasks_parent_task 
            FOREIGN KEY (user_id, parent_task_id) REFERENCES public.tasks(user_id, id) 
            ON DELETE SET NULL (parent_task_id);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 7: TRIGGERS & VALIDATION FUNCTIONS
-- ----------------------------------------------------------------------------

-- 7.1 Generic updated_at timestamp synchronizer
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_boards_updated_at ON public.project_boards;
CREATE TRIGGER trg_boards_updated_at BEFORE UPDATE ON public.project_boards
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_columns_updated_at ON public.board_columns;
CREATE TRIGGER trg_columns_updated_at BEFORE UPDATE ON public.board_columns
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON public.time_entries;
CREATE TRIGGER trg_time_entries_updated_at BEFORE UPDATE ON public.time_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_reports_updated_at ON public.daily_reports;
CREATE TRIGGER trg_daily_reports_updated_at BEFORE UPDATE ON public.daily_reports
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 7.2.1 Calculate Active Work Intervals for a Timer (Multirange Model)
-- Decomposes a timer's elapsed range into genuinely active work segments by subtracting
-- all overlapping pause intervals (from time_entry_pauses) AND all idle intervals
-- (from time_entry_idles). Empty ranges return an empty multirange.
-- NOTE: Declared VOLATILE (not STABLE) because it is invoked inside trigger validations
-- after acquiring per-user transaction advisory locks. Under PostgreSQL READ COMMITTED mode,
-- VOLATILE forces the query planner to evaluate table scans against a fresh command snapshot
-- rather than reusing an earlier statement snapshot, guaranteeing immediate visibility of
-- intervals committed by concurrent transactions while waiting on the advisory lock.
CREATE OR REPLACE FUNCTION public.fn_calculate_timer_active_multirange(
    p_timer_id UUID,
    p_started_at TIMESTAMPTZ,
    p_ended_at TIMESTAMPTZ,
    p_exclude_pause_id UUID DEFAULT NULL,
    p_exclude_idle_id UUID DEFAULT NULL
)
RETURNS tstzmultirange
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_end TIMESTAMPTZ;
    v_bounds tstzrange;
    v_pause_multi tstzmultirange;
    v_idle_multi tstzmultirange;
    v_inactive_multi tstzmultirange;
BEGIN
    v_end := COALESCE(p_ended_at, now());
    IF v_end <= p_started_at THEN
        RETURN tstzmultirange();
    END IF;

    v_bounds := tstzrange(p_started_at, v_end, '[)');

    -- Aggregate all valid pauses for this timer into a multirange
    SELECT COALESCE(
        range_agg(
            tstzrange(
                GREATEST(p_started_at, paused_at),
                LEAST(v_end, COALESCE(resumed_at, v_end)),
                '[)'
            )
        ),
        tstzmultirange()
    )
    INTO v_pause_multi
    FROM public.time_entry_pauses
    WHERE time_entry_id = p_timer_id
      AND (p_exclude_pause_id IS NULL OR id <> p_exclude_pause_id)
      AND GREATEST(p_started_at, paused_at) < LEAST(v_end, COALESCE(resumed_at, v_end));

    -- Aggregate all valid idle intervals for this timer into a multirange
    SELECT COALESCE(
        range_agg(
            tstzrange(
                GREATEST(p_started_at, started_at),
                LEAST(v_end, COALESCE(ended_at, v_end)),
                '[)'
            )
        ),
        tstzmultirange()
    )
    INTO v_idle_multi
    FROM public.time_entry_idles
    WHERE time_entry_id = p_timer_id
      AND (p_exclude_idle_id IS NULL OR id <> p_exclude_idle_id)
      AND GREATEST(p_started_at, started_at) < LEAST(v_end, COALESCE(ended_at, v_end));

    -- Combined inactive intervals (pauses + idles)
    v_inactive_multi := v_pause_multi + v_idle_multi;

    -- Truly active multirange is bounding interval minus all pauses and idles
    RETURN tstzmultirange(v_bounds) - v_inactive_multi;
END;
$$;

-- 7.2.2 Check for Active Interval Overlap Conflicts Across User's Timers
-- Uses bounding box pre-filter for index optimization, then tests multirange intersection.
-- NOTE: Declared VOLATILE (not STABLE) because it is invoked inside trigger validations
-- after acquiring per-user transaction advisory locks. Under PostgreSQL READ COMMITTED mode,
-- VOLATILE forces the query planner to evaluate table scans against a fresh command snapshot
-- rather than reusing an earlier statement snapshot, guaranteeing immediate visibility of
-- intervals committed by concurrent transactions while waiting on the advisory lock.
CREATE OR REPLACE FUNCTION public.fn_check_active_interval_conflict(
    p_user_id UUID,
    p_timer_id UUID,
    p_candidate_active tstzmultirange
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_conflict_id UUID;
BEGIN
    IF p_candidate_active IS NULL OR isempty(p_candidate_active) THEN
        RETURN NULL;
    END IF;

    SELECT te.id INTO v_conflict_id
    FROM public.time_entries te
    WHERE te.user_id = p_user_id
      AND (p_timer_id IS NULL OR te.id <> p_timer_id)
      AND te.state IN ('running', 'paused', 'completed')
      -- Bounding box pre-filter for GiST/B-tree index pruning
      AND tstzrange(te.started_at, COALESCE(te.ended_at, now()), '[)') && range_merge(p_candidate_active)
      -- Precise active interval intersection (excluding pauses and idles)
      AND public.fn_calculate_timer_active_multirange(te.id, te.started_at, te.ended_at) && p_candidate_active
    LIMIT 1;

    RETURN v_conflict_id;
END;
$$;

-- 7.2.3 Comprehensive Time Entry Interval Validator (Active Intervals Model)
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

DROP TRIGGER IF EXISTS trg_validate_time_entry_interval ON public.time_entries;
CREATE TRIGGER trg_validate_time_entry_interval
    BEFORE INSERT OR UPDATE OR DELETE ON public.time_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_time_entry_interval();

-- 7.3 Time Entry Pause Validator (BEFORE INSERT OR UPDATE OR DELETE)
-- Ensures temporal validity of pause intervals, prevents overlap with idle intervals
-- of the same timer, protects quarantined timer child records from modification/deletion,
-- and prevents modifications/deletions that would expand active work intervals into collisions.
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

DROP TRIGGER IF EXISTS trg_validate_time_entry_pause ON public.time_entry_pauses;
CREATE TRIGGER trg_validate_time_entry_pause
    BEFORE INSERT OR UPDATE OR DELETE ON public.time_entry_pauses
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_time_entry_pause();

-- 7.4 Pause Duration Recalculator (AFTER INSERT OR UPDATE OR DELETE)
-- Recalculates both OLD and NEW time entries if a pause is moved between timers.
-- Safely aligns uncompleted timer state to 'paused' or 'running'.
CREATE OR REPLACE FUNCTION public.fn_sync_time_entry_duration_on_pause()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_timer_ids UUID[] := ARRAY[]::UUID[];
    v_tid UUID;
    v_timer RECORD;
    v_open_pause RECORD;
    v_open_idle RECORD;
    v_closed_paused INTEGER;
    v_total_paused INTEGER;
    v_closed_idle INTEGER;
    v_total_idle INTEGER;
    v_elapsed INTEGER;
    v_active INTEGER;
    v_new_state VARCHAR(20);
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_timer_ids := ARRAY[NEW.time_entry_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_timer_ids := ARRAY[OLD.time_entry_id];
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.time_entry_id IS DISTINCT FROM NEW.time_entry_id THEN
            v_timer_ids := ARRAY[OLD.time_entry_id, NEW.time_entry_id];
        ELSE
            v_timer_ids := ARRAY[NEW.time_entry_id];
        END IF;
    END IF;

    FOREACH v_tid IN ARRAY v_timer_ids
    LOOP
        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = v_tid;

        IF v_timer.id IS NOT NULL AND v_timer.state <> 'quarantined' THEN
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (resumed_at - paused_at)))::INTEGER, 0)
            INTO v_closed_paused
            FROM public.time_entry_pauses
            WHERE time_entry_id = v_tid AND resumed_at IS NOT NULL;

            SELECT * INTO v_open_pause
            FROM public.time_entry_pauses
            WHERE time_entry_id = v_tid AND resumed_at IS NULL
            LIMIT 1;

            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))::INTEGER, 0)
            INTO v_closed_idle
            FROM public.time_entry_idles
            WHERE time_entry_id = v_tid AND ended_at IS NOT NULL;

            SELECT * INTO v_open_idle
            FROM public.time_entry_idles
            WHERE time_entry_id = v_tid AND ended_at IS NULL
            LIMIT 1;

            IF v_timer.ended_at IS NOT NULL THEN
                v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (v_timer.ended_at - v_timer.started_at))::INTEGER);
                v_total_paused := v_closed_paused;
                v_total_idle := CASE 
                    WHEN EXISTS (SELECT 1 FROM public.time_entry_idles WHERE time_entry_id = v_tid) THEN v_closed_idle
                    ELSE COALESCE(v_timer.idle_duration_seconds, 0)
                END;
                v_new_state := v_timer.state;
            ELSE
                v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_timer.started_at))::INTEGER);
                IF v_open_pause.id IS NOT NULL THEN
                    v_total_paused := v_closed_paused + GREATEST(0, EXTRACT(EPOCH FROM (now() - v_open_pause.paused_at))::INTEGER);
                    v_new_state := 'paused';
                ELSE
                    v_total_paused := v_closed_paused;
                    IF v_timer.state = 'paused' THEN
                        v_new_state := 'running';
                    ELSE
                        v_new_state := v_timer.state;
                    END IF;
                END IF;

                v_total_idle := CASE 
                    WHEN EXISTS (SELECT 1 FROM public.time_entry_idles WHERE time_entry_id = v_tid) THEN 
                        v_closed_idle + CASE WHEN v_open_idle.id IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - v_open_idle.started_at))::INTEGER) ELSE 0 END
                    ELSE COALESCE(v_timer.idle_duration_seconds, 0)
                END;
            END IF;

            v_total_paused := LEAST(v_total_paused, v_elapsed);
            v_total_idle := LEAST(v_total_idle, v_elapsed - v_total_paused);
            v_active := GREATEST(0, (v_elapsed - v_total_paused) - v_total_idle);

            IF v_timer.active_duration_seconds IS DISTINCT FROM v_active 
               OR v_timer.idle_duration_seconds IS DISTINCT FROM v_total_idle 
               OR v_timer.state IS DISTINCT FROM v_new_state THEN
                UPDATE public.time_entries
                SET active_duration_seconds = v_active,
                    idle_duration_seconds = v_total_idle,
                    state = v_new_state,
                    updated_at = now()
                WHERE id = v_tid;
            END IF;
        END IF;
    END LOOP;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_time_entry_duration_on_pause ON public.time_entry_pauses;
CREATE TRIGGER trg_sync_time_entry_duration_on_pause
    AFTER INSERT OR UPDATE OR DELETE ON public.time_entry_pauses
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_time_entry_duration_on_pause();

-- 7.5 Time Entry Idle Interval Validator (BEFORE INSERT OR UPDATE OR DELETE)
-- Ensures temporal validity of idle intervals, prevents overlap with pauses of the
-- same timer, protects quarantined timer child records from modification/deletion,
-- and prevents idle modifications/deletions that would expand active work intervals into collisions.
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

DROP TRIGGER IF EXISTS trg_validate_time_entry_idle ON public.time_entry_idles;
CREATE TRIGGER trg_validate_time_entry_idle
    BEFORE INSERT OR UPDATE OR DELETE ON public.time_entry_idles
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_time_entry_idle();

-- 7.6 Idle Duration Recalculator (AFTER INSERT OR UPDATE OR DELETE)
-- Recalculates both idle_duration_seconds and active_duration_seconds on time_entries.
CREATE OR REPLACE FUNCTION public.fn_sync_time_entry_duration_on_idle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_timer_ids UUID[] := ARRAY[]::UUID[];
    v_tid UUID;
    v_timer RECORD;
    v_open_pause RECORD;
    v_open_idle RECORD;
    v_closed_paused INTEGER;
    v_total_paused INTEGER;
    v_closed_idle INTEGER;
    v_total_idle INTEGER;
    v_elapsed INTEGER;
    v_active INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_timer_ids := ARRAY[NEW.time_entry_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_timer_ids := ARRAY[OLD.time_entry_id];
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.time_entry_id IS DISTINCT FROM NEW.time_entry_id THEN
            v_timer_ids := ARRAY[OLD.time_entry_id, NEW.time_entry_id];
        ELSE
            v_timer_ids := ARRAY[NEW.time_entry_id];
        END IF;
    END IF;

    FOREACH v_tid IN ARRAY v_timer_ids
    LOOP
        SELECT * INTO v_timer 
        FROM public.time_entries 
        WHERE id = v_tid;

        IF v_timer.id IS NOT NULL AND v_timer.state <> 'quarantined' THEN
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (resumed_at - paused_at)))::INTEGER, 0)
            INTO v_closed_paused
            FROM public.time_entry_pauses
            WHERE time_entry_id = v_tid AND resumed_at IS NOT NULL;

            SELECT * INTO v_open_pause
            FROM public.time_entry_pauses
            WHERE time_entry_id = v_tid AND resumed_at IS NULL
            LIMIT 1;

            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))::INTEGER, 0)
            INTO v_closed_idle
            FROM public.time_entry_idles
            WHERE time_entry_id = v_tid AND ended_at IS NOT NULL;

            SELECT * INTO v_open_idle
            FROM public.time_entry_idles
            WHERE time_entry_id = v_tid AND ended_at IS NULL
            LIMIT 1;

            IF v_timer.ended_at IS NOT NULL THEN
                v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (v_timer.ended_at - v_timer.started_at))::INTEGER);
                v_total_paused := v_closed_paused;
                v_total_idle := v_closed_idle;
            ELSE
                v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_timer.started_at))::INTEGER);
                v_total_paused := v_closed_paused + CASE WHEN v_open_pause.id IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - v_open_pause.paused_at))::INTEGER) ELSE 0 END;
                v_total_idle := v_closed_idle + CASE WHEN v_open_idle.id IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - v_open_idle.started_at))::INTEGER) ELSE 0 END;
            END IF;

            v_total_paused := LEAST(v_total_paused, v_elapsed);
            v_total_idle := LEAST(v_total_idle, v_elapsed - v_total_paused);
            v_active := GREATEST(0, (v_elapsed - v_total_paused) - v_total_idle);

            IF v_timer.active_duration_seconds IS DISTINCT FROM v_active OR v_timer.idle_duration_seconds IS DISTINCT FROM v_total_idle THEN
                UPDATE public.time_entries
                SET active_duration_seconds = v_active,
                    idle_duration_seconds = v_total_idle,
                    updated_at = now()
                WHERE id = v_tid;
            END IF;
        END IF;
    END LOOP;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_time_entry_duration_on_idle ON public.time_entry_idles;
CREATE TRIGGER trg_sync_time_entry_duration_on_idle
    AFTER INSERT OR UPDATE OR DELETE ON public.time_entry_idles
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_time_entry_duration_on_idle();

-- 7.7 Task Duration Rollup Synchronizer
CREATE OR REPLACE FUNCTION public.fn_sync_task_actual_duration_on_time_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_old_task_id UUID;
    v_new_task_id UUID;
BEGIN
    v_old_task_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.task_id ELSE NULL END;
    v_new_task_id := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.task_id ELSE NULL END;

    IF v_old_task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET actual_duration_minutes = COALESCE((
            SELECT CEIL(SUM(active_duration_seconds)::NUMERIC / 60.0)::INTEGER
            FROM public.time_entries
            WHERE task_id = v_old_task_id AND state = 'completed'
        ), 0),
        updated_at = now()
        WHERE id = v_old_task_id;
    END IF;

    IF v_new_task_id IS NOT NULL AND (v_old_task_id IS NULL OR v_new_task_id <> v_old_task_id) THEN
        UPDATE public.tasks
        SET actual_duration_minutes = COALESCE((
            SELECT CEIL(SUM(active_duration_seconds)::NUMERIC / 60.0)::INTEGER
            FROM public.time_entries
            WHERE task_id = v_new_task_id AND state = 'completed'
        ), 0),
        updated_at = now()
        WHERE id = v_new_task_id;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_task_actual_duration ON public.time_entries;
CREATE TRIGGER trg_sync_task_actual_duration
    AFTER INSERT OR UPDATE OF active_duration_seconds, state, task_id OR DELETE ON public.time_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_task_actual_duration_on_time_entry();

-- 7.8 Task Hierarchy & Board Consistency Validator
CREATE OR REPLACE FUNCTION public.fn_validate_task_board_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_board_project_id UUID;
    v_col_board_id UUID;
    v_parent_user_id UUID;
    v_parent_project_id UUID;
    v_cycle_detected BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tasks_hierarchy_' || NEW.user_id::text));

    SELECT project_id INTO v_board_project_id 
    FROM public.project_boards 
    WHERE id = NEW.board_id AND user_id = NEW.user_id;

    IF v_board_project_id IS NULL OR v_board_project_id <> NEW.project_id THEN
        RAISE EXCEPTION 'Hierarchy violation: board % does not belong to project %.', 
            NEW.board_id, NEW.project_id;
    END IF;

    SELECT board_id INTO v_col_board_id 
    FROM public.board_columns 
    WHERE id = NEW.column_id AND user_id = NEW.user_id;

    IF v_col_board_id IS NULL OR v_col_board_id <> NEW.board_id THEN
        RAISE EXCEPTION 'Hierarchy violation: column % does not belong to board %.', 
            NEW.column_id, NEW.board_id;
    END IF;

    IF NEW.parent_task_id IS NOT NULL THEN
        IF NEW.parent_task_id = NEW.id THEN
            RAISE EXCEPTION 'Self-referencing cycle: task % cannot be its own parent.', NEW.id;
        END IF;

        SELECT user_id, project_id INTO v_parent_user_id, v_parent_project_id 
        FROM public.tasks 
        WHERE id = NEW.parent_task_id;

        IF v_parent_user_id IS NULL OR v_parent_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Security violation: parent task % belongs to another user or does not exist.', 
                NEW.parent_task_id;
        END IF;

        IF v_parent_project_id <> NEW.project_id THEN
            RAISE EXCEPTION 'Cross-project hierarchy violation: parent task % is in project %, child is in %.', 
                NEW.parent_task_id, v_parent_project_id, NEW.project_id;
        END IF;

        WITH RECURSIVE task_ancestors AS (
            SELECT id, parent_task_id, ARRAY[id] AS visited_ids
            FROM public.tasks
            WHERE id = NEW.parent_task_id
            UNION ALL
            SELECT t.id, t.parent_task_id, ta.visited_ids || t.id
            FROM public.tasks t
            JOIN task_ancestors ta ON t.id = ta.parent_task_id
            WHERE NOT (t.id = ANY(ta.visited_ids))
        )
        SELECT true INTO v_cycle_detected
        FROM task_ancestors
        WHERE id = NEW.id
        LIMIT 1;

        IF v_cycle_detected THEN
            RAISE EXCEPTION 'Cyclic task dependency detected: assigning parent % to task % creates a loop.', 
                NEW.parent_task_id, NEW.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_task_board_hierarchy ON public.tasks;
CREATE TRIGGER trg_validate_task_board_hierarchy
    BEFORE INSERT OR UPDATE OF project_id, board_id, column_id, parent_task_id ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_task_board_hierarchy();

-- 7.9 Task Lifecycle & Completion Synchronizer
CREATE OR REPLACE FUNCTION public.fn_sync_task_status_and_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_col_category VARCHAR(30);
    v_target_col_id UUID;
BEGIN
    SELECT status_category INTO v_col_category
    FROM public.board_columns
    WHERE id = NEW.column_id;

    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'done' THEN
            NEW.completed = true;
            NEW.completed_at = COALESCE(NEW.completed_at, now());
        ELSIF NEW.status IN ('todo', 'backlog', 'in_progress', 'cancelled') THEN
            NEW.completed = false;
            NEW.completed_at = NULL;
            IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
                NEW.started_at = now();
            END IF;
        END IF;

        IF v_col_category IS DISTINCT FROM NEW.status THEN
            SELECT id INTO v_target_col_id
            FROM public.board_columns
            WHERE board_id = NEW.board_id AND status_category = NEW.status
            LIMIT 1;

            IF v_target_col_id IS NOT NULL THEN
                NEW.column_id = v_target_col_id;
            END IF;
        END IF;

    ELSIF NEW.column_id IS DISTINCT FROM OLD.column_id THEN
        IF v_col_category IS NOT NULL THEN
            NEW.status = v_col_category;
            IF v_col_category = 'done' THEN
                NEW.completed = true;
                NEW.completed_at = COALESCE(NEW.completed_at, now());
            ELSE
                NEW.completed = false;
                NEW.completed_at = NULL;
                IF v_col_category = 'in_progress' AND NEW.started_at IS NULL THEN
                    NEW.started_at = now();
                END IF;
            END IF;
        END IF;

    ELSIF NEW.completed IS DISTINCT FROM OLD.completed THEN
        IF NEW.completed = true THEN
            NEW.status = 'done';
            NEW.completed_at = COALESCE(NEW.completed_at, now());
            SELECT id INTO v_target_col_id FROM public.board_columns 
            WHERE board_id = NEW.board_id AND status_category = 'done' LIMIT 1;
            IF v_target_col_id IS NOT NULL THEN NEW.column_id = v_target_col_id; END IF;
        ELSE
            NEW.status = 'todo';
            NEW.completed_at = NULL;
            SELECT id INTO v_target_col_id FROM public.board_columns 
            WHERE board_id = NEW.board_id AND status_category = 'todo' LIMIT 1;
            IF v_target_col_id IS NOT NULL THEN NEW.column_id = v_target_col_id; END IF;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.column_id IS DISTINCT FROM OLD.column_id) THEN
        NEW.status_updated_at = now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_task_status_and_completion ON public.tasks;
CREATE TRIGGER trg_sync_task_status_and_completion
    BEFORE INSERT OR UPDATE OF status, column_id, completed ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_task_status_and_completion();

-- 7.10 Task Status History Audit Logger (HARDENED SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.fn_log_task_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.column_id IS DISTINCT FROM OLD.column_id) THEN
        INSERT INTO public.task_status_history (
            user_id,
            task_id,
            old_status,
            new_status,
            from_column_id,
            to_column_id,
            changed_at
        ) VALUES (
            NEW.user_id,
            NEW.id,
            OLD.status,
            NEW.status,
            OLD.column_id,
            NEW.column_id,
            now()
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_task_status_history ON public.tasks;
CREATE TRIGGER trg_log_task_status_history
    AFTER UPDATE OF status, column_id ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.fn_log_task_status_history();

-- ----------------------------------------------------------------------------
-- STEP 8: CRASH RECOVERY & MAINTENANCE PROCEDURES
-- ----------------------------------------------------------------------------

-- 8.1 Complete Crash Recovery for All Timer States
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

-- 8.2 Bounded Computer Activity Retention Cleaner
CREATE OR REPLACE FUNCTION public.purge_expired_activity_events(
    p_batch_size INTEGER DEFAULT 5000
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_deleted_count BIGINT := 0;
BEGIN
    WITH candidate_events AS (
        SELECT cae.id
        FROM public.computer_activity_events cae
        JOIN public.user_preferences up ON up.user_id = cae.user_id
        WHERE cae.event_timestamp < (now() - (up.telemetry_retention_days * INTERVAL '1 day'))
        LIMIT p_batch_size
    )
    DELETE FROM public.computer_activity_events
    WHERE id IN (SELECT id FROM candidate_events);

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$;

-- ----------------------------------------------------------------------------
-- STEP 9: ROW LEVEL SECURITY POLICIES & FORCED SECURITY
-- ----------------------------------------------------------------------------

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

ALTER TABLE public.project_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_boards FORCE ROW LEVEL SECURITY;

ALTER TABLE public.board_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_columns FORCE ROW LEVEL SECURITY;

ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_labels FORCE ROW LEVEL SECURITY;

ALTER TABLE public.task_label_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_label_assignments FORCE ROW LEVEL SECURITY;

-- Standard ENABLE on audit ledger so SECURITY DEFINER trigger can write
ALTER TABLE public.task_status_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE public.time_entry_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entry_pauses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.time_entry_idles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entry_idles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.computer_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.computer_activity_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.pet_reaction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pet_reaction_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports FORCE ROW LEVEL SECURITY;

-- 9.1 Projects RLS
DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
CREATE POLICY "Users can view own projects" ON public.projects
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own projects" ON public.projects;
CREATE POLICY "Users can insert own projects" ON public.projects
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
CREATE POLICY "Users can update own projects" ON public.projects
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
CREATE POLICY "Users can delete own projects" ON public.projects
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.2 Project Boards RLS
DROP POLICY IF EXISTS "Users can view own boards" ON public.project_boards;
CREATE POLICY "Users can view own boards" ON public.project_boards
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own boards" ON public.project_boards;
CREATE POLICY "Users can insert own boards" ON public.project_boards
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own boards" ON public.project_boards;
CREATE POLICY "Users can update own boards" ON public.project_boards
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own boards" ON public.project_boards;
CREATE POLICY "Users can delete own boards" ON public.project_boards
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.3 Board Columns RLS
DROP POLICY IF EXISTS "Users can view own columns" ON public.board_columns;
CREATE POLICY "Users can view own columns" ON public.board_columns
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own columns" ON public.board_columns;
CREATE POLICY "Users can insert own columns" ON public.board_columns
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own columns" ON public.board_columns;
CREATE POLICY "Users can update own columns" ON public.board_columns
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own columns" ON public.board_columns;
CREATE POLICY "Users can delete own columns" ON public.board_columns
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.4 Task Labels RLS
DROP POLICY IF EXISTS "Users can view own labels" ON public.task_labels;
CREATE POLICY "Users can view own labels" ON public.task_labels
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own labels" ON public.task_labels;
CREATE POLICY "Users can insert own labels" ON public.task_labels
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own labels" ON public.task_labels;
CREATE POLICY "Users can update own labels" ON public.task_labels
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own labels" ON public.task_labels;
CREATE POLICY "Users can delete own labels" ON public.task_labels
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.5 Task Label Assignments RLS
DROP POLICY IF EXISTS "Users can view own label assignments" ON public.task_label_assignments;
CREATE POLICY "Users can view own label assignments" ON public.task_label_assignments
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own label assignments" ON public.task_label_assignments;
CREATE POLICY "Users can insert own label assignments" ON public.task_label_assignments
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own label assignments" ON public.task_label_assignments;
CREATE POLICY "Users can delete own label assignments" ON public.task_label_assignments
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.6 Task Status History RLS (Audit Ledger: Read-Only for Clients)
DROP POLICY IF EXISTS "Users can view own task history" ON public.task_status_history;
CREATE POLICY "Users can view own task history" ON public.task_status_history
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- No INSERT, UPDATE, or DELETE policies are granted to authenticated users.
-- Status history records can only be written by the SECURITY DEFINER trigger.

-- 9.7 Time Entries RLS
DROP POLICY IF EXISTS "Users can view own time entries" ON public.time_entries;
CREATE POLICY "Users can view own time entries" ON public.time_entries
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own time entries" ON public.time_entries;
CREATE POLICY "Users can insert own time entries" ON public.time_entries
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own time entries" ON public.time_entries;
CREATE POLICY "Users can update own time entries" ON public.time_entries
    FOR UPDATE TO authenticated 
    USING (auth.uid() = user_id AND state <> 'quarantined') 
    WITH CHECK (auth.uid() = user_id AND state <> 'quarantined');

DROP POLICY IF EXISTS "Users can delete own time entries" ON public.time_entries;
CREATE POLICY "Users can delete own time entries" ON public.time_entries
    FOR DELETE TO authenticated 
    USING (auth.uid() = user_id AND state <> 'quarantined');

-- 9.8 Time Entry Pauses RLS
DROP POLICY IF EXISTS "Users can view own timer pauses" ON public.time_entry_pauses;
CREATE POLICY "Users can view own timer pauses" ON public.time_entry_pauses
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own timer pauses" ON public.time_entry_pauses;
CREATE POLICY "Users can insert own timer pauses" ON public.time_entry_pauses
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own timer pauses" ON public.time_entry_pauses;
CREATE POLICY "Users can update own timer pauses" ON public.time_entry_pauses
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own timer pauses" ON public.time_entry_pauses;
CREATE POLICY "Users can delete own timer pauses" ON public.time_entry_pauses
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.9 Time Entry Idles RLS
DROP POLICY IF EXISTS "Users can view own timer idles" ON public.time_entry_idles;
CREATE POLICY "Users can view own timer idles" ON public.time_entry_idles
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own timer idles" ON public.time_entry_idles;
CREATE POLICY "Users can insert own timer idles" ON public.time_entry_idles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own timer idles" ON public.time_entry_idles;
CREATE POLICY "Users can update own timer idles" ON public.time_entry_idles
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own timer idles" ON public.time_entry_idles;
CREATE POLICY "Users can delete own timer idles" ON public.time_entry_idles
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.10 Computer Activity Events RLS
DROP POLICY IF EXISTS "Users can view own activity events" ON public.computer_activity_events;
CREATE POLICY "Users can view own activity events" ON public.computer_activity_events
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own activity events" ON public.computer_activity_events;
CREATE POLICY "Users can insert own activity events" ON public.computer_activity_events
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own activity events" ON public.computer_activity_events;
CREATE POLICY "Users can delete own activity events" ON public.computer_activity_events
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.11 Pet Reaction Logs RLS
DROP POLICY IF EXISTS "Users can view own pet reactions" ON public.pet_reaction_logs;
CREATE POLICY "Users can view own pet reactions" ON public.pet_reaction_logs
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own pet reactions" ON public.pet_reaction_logs;
CREATE POLICY "Users can insert own pet reactions" ON public.pet_reaction_logs
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 9.12 Daily Reports RLS
DROP POLICY IF EXISTS "Users can view own daily reports" ON public.daily_reports;
CREATE POLICY "Users can view own daily reports" ON public.daily_reports
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own daily reports" ON public.daily_reports;
CREATE POLICY "Users can insert own daily reports" ON public.daily_reports
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own daily reports" ON public.daily_reports;
CREATE POLICY "Users can update own daily reports" ON public.daily_reports
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own daily reports" ON public.daily_reports;
CREATE POLICY "Users can delete own daily reports" ON public.daily_reports
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- STEP 10: PRIVILEGE MATRIX & SECURITY HARDENING
-- ----------------------------------------------------------------------------
-- 10.1 Table-Level Grants: Explicitly restrict anon and PUBLIC on the 14 Phase 9 managed tables
REVOKE ALL ON TABLE 
    public.tasks,
    public.user_preferences,
    public.projects,
    public.project_boards,
    public.board_columns,
    public.task_labels,
    public.task_label_assignments,
    public.task_status_history,
    public.time_entries,
    public.time_entry_pauses,
    public.time_entry_idles,
    public.computer_activity_events,
    public.pet_reaction_logs,
    public.daily_reports
FROM anon, PUBLIC;

-- Authenticated users: Full DML on their own records (governed by RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON 
    public.projects,
    public.project_boards,
    public.board_columns,
    public.task_labels,
    public.task_label_assignments,
    public.time_entries,
    public.time_entry_pauses,
    public.time_entry_idles,
    public.computer_activity_events,
    public.pet_reaction_logs,
    public.daily_reports,
    public.tasks,
    public.user_preferences
TO authenticated;

-- Immutable audit ledger: Explicitly revoke ALL privileges from authenticated, then grant SELECT ONLY
REVOKE ALL ON TABLE public.task_status_history FROM authenticated;
GRANT SELECT ON public.task_status_history TO authenticated;

-- Service role: Administrative access explicitly on the 14 Phase 9 managed tables
GRANT ALL ON TABLE 
    public.tasks,
    public.user_preferences,
    public.projects,
    public.project_boards,
    public.board_columns,
    public.task_labels,
    public.task_label_assignments,
    public.task_status_history,
    public.time_entries,
    public.time_entry_pauses,
    public.time_entry_idles,
    public.computer_activity_events,
    public.pet_reaction_logs,
    public.daily_reports
TO service_role;

-- Close TRUNCATE privilege bypass on timer entities: Row-level triggers do NOT fire on TRUNCATE.
-- Explicitly revoke TRUNCATE from service_role on public.time_entries, public.time_entry_pauses, and public.time_entry_idles
-- to prevent wholesale deletion of active or quarantined forensic timer records, while retaining SELECT, INSERT, UPDATE, DELETE.
REVOKE TRUNCATE ON TABLE 
    public.time_entries,
    public.time_entry_pauses,
    public.time_entry_idles
FROM service_role;

-- 10.2 Function Execution Privileges: Complete Hardening for All 14 Phase 9 Functions
-- Step A: Explicitly revoke ALL privileges on all 14 functions from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_calculate_timer_active_multirange(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_check_active_interval_conflict(UUID, UUID, tstzmultirange) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_validate_time_entry_interval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_validate_time_entry_pause() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_time_entry_duration_on_pause() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_validate_time_entry_idle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_time_entry_duration_on_idle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_task_actual_duration_on_time_entry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_validate_task_board_hierarchy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_task_status_and_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_log_task_status_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_time_entries(INTERVAL) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_activity_events(INTEGER) FROM PUBLIC, anon, authenticated;

-- Step B: Grant service_role EXECUTE on all 14 Phase 9 functions
GRANT EXECUTE ON FUNCTION public.fn_set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_calculate_timer_active_multirange(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_check_active_interval_conflict(UUID, UUID, tstzmultirange) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_time_entry_interval() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_time_entry_pause() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_time_entry_duration_on_pause() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_time_entry_idle() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_time_entry_duration_on_idle() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_task_actual_duration_on_time_entry() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_task_board_hierarchy() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_task_status_and_completion() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_log_task_status_history() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_time_entries(INTERVAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_activity_events(INTEGER) TO service_role;

-- Step C: Grant authenticated EXECUTE ONLY on the three approved callable utility functions.
-- reconcile_stale_time_entries is an administrative maintenance procedure restricted strictly to service_role (worker/pg_cron).
-- All 10 internal trigger functions and administrative recovery procedures remain inaccessible to ordinary authenticated clients.
GRANT EXECUTE ON FUNCTION public.fn_calculate_timer_active_multirange(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_active_interval_conflict(UUID, UUID, tstzmultirange) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_activity_events(INTEGER) TO authenticated;

COMMIT;

