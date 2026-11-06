-- ============================================================================
-- KURO HYBRID PERSONAL ASSISTANT & SMART ROBOT PET
-- DATABASE UPGRADE MIGRATION: PHASE 9 (POSTGRESQL 15+ PRODUCTION RELEASE)
-- ============================================================================
-- Architecture Baseline:
--   - Authoritative identity root: auth.users(id).
--   - Profile cache: public.users(id) (optional application cache).
--   - Multi-tenant boundary: Composite foreign keys (user_id, id) + RLS.
--   - Container integrity: ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
--     prevents accidental deletion of populated projects/boards while allowing
--     clean cascading user account deletion.
-- ============================================================================
-- Wrapped in an atomic transaction block. Any failure reverts all operations.
-- Fully compatible with fresh installations, partial installations, and reruns.
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
    IF v_type <> 'uuid' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.id must be uuid NOT NULL (found type %, nullable %).', v_type, v_nullable;
    END IF;

    -- 0.3 public.tasks.user_id (must be uuid, NOT NULL)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'user_id';
    IF v_type <> 'uuid' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.user_id must be uuid NOT NULL (found type %, nullable %).', v_type, v_nullable;
    END IF;

    -- 0.4 public.tasks.completed (must be boolean, NOT NULL)
    SELECT data_type, is_nullable INTO v_type, v_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'completed';
    IF v_type IS NULL THEN
        RAISE EXCEPTION 'Pre-check failed: baseline column public.tasks.completed does not exist.';
    ELSIF v_type <> 'boolean' THEN
        RAISE EXCEPTION 'Pre-check failed: public.tasks.completed has incompatible type % (expected boolean).', v_type;
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
    IF v_type <> 'uuid' OR v_nullable <> 'NO' THEN
        RAISE EXCEPTION 'Pre-check failed: public.user_preferences.user_id must be uuid NOT NULL (found type %, nullable %).', v_type, v_nullable;
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

-- Exclusion constraint on completed time entries (non-overlapping active intervals)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exclude_overlapping_completed_intervals' AND conrelid = 'public.time_entries'::regclass
    ) THEN
        ALTER TABLE public.time_entries ADD CONSTRAINT exclude_overlapping_completed_intervals 
            EXCLUDE USING gist (
                user_id WITH =,
                tstzrange(started_at, ended_at, '[)') WITH &&
            ) WHERE (state = 'completed');
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

-- 3.9 Computer Activity Events Table
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
          AND (t.project_id IS NULL OR t.board_id IS NULL OR t.column_id IS NULL);
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
SET search_path = public, pg_temp
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

-- 7.2 Bidirectional Time Entry Overlap Validator
CREATE OR REPLACE FUNCTION public.fn_validate_time_entry_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_overlap_id UUID;
    v_open_pause_count INTEGER;
BEGIN
    -- Concurrency serialization per user
    PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || NEW.user_id::text));

    -- Immutability check: cannot reopen a completed timer
    IF TG_OP = 'UPDATE' AND OLD.state = 'completed' AND NEW.state <> 'completed' THEN
        RAISE EXCEPTION 'Cannot reopen a completed time entry (ID: %). Create a new time entry instead.', OLD.id;
    END IF;

    -- Chronology check
    IF NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at THEN
        RAISE EXCEPTION 'Invalid time entry chronology: ended_at (%) cannot precede started_at (%).', 
            NEW.ended_at, NEW.started_at;
    END IF;

    -- Validate state vs open pause intervals
    IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_open_pause_count
        FROM public.time_entry_pauses
        WHERE time_entry_id = NEW.id AND resumed_at IS NULL;

        IF NEW.state IN ('running', 'completed') AND v_open_pause_count > 0 THEN
            RAISE EXCEPTION 'Invalid timer state %: cannot have an open pause interval.', NEW.state;
        END IF;
    END IF;

    -- Running or paused timer overlap validation against completed intervals
    IF NEW.state IN ('running', 'paused') THEN
        SELECT id INTO v_overlap_id
        FROM public.time_entries
        WHERE user_id = NEW.user_id
          AND state = 'completed'
          AND (NEW.id IS NULL OR id <> NEW.id)
          AND tstzrange(started_at, ended_at, '[)') && tstzrange(NEW.started_at, COALESCE(NEW.ended_at, now()), '[)')
        LIMIT 1;

        IF v_overlap_id IS NOT NULL THEN
            RAISE EXCEPTION 'Active/paused timer conflicts with existing completed time entry %.', v_overlap_id;
        END IF;
    END IF;

    -- Running timer overlap validation against active periods of paused timers
    IF NEW.state = 'running' THEN
        SELECT te.id INTO v_overlap_id
        FROM public.time_entries te
        JOIN public.time_entry_pauses tep ON tep.time_entry_id = te.id AND tep.resumed_at IS NULL
        WHERE te.user_id = NEW.user_id
          AND te.state = 'paused'
          AND (NEW.id IS NULL OR te.id <> NEW.id)
          AND tstzrange(te.started_at, tep.paused_at, '[)') && tstzrange(NEW.started_at, COALESCE(NEW.ended_at, now()), '[)')
        LIMIT 1;

        IF v_overlap_id IS NOT NULL THEN
            RAISE EXCEPTION 'Running timer conflicts with active period of paused timer %.', v_overlap_id;
        END IF;
    END IF;

    -- Completed timer validation against running timers and paused timer active periods
    IF NEW.state = 'completed' THEN
        SELECT id INTO v_overlap_id
        FROM public.time_entries
        WHERE user_id = NEW.user_id
          AND state = 'running'
          AND (NEW.id IS NULL OR id <> NEW.id)
          AND tstzrange(started_at, COALESCE(ended_at, now()), '[)') && tstzrange(NEW.started_at, NEW.ended_at, '[)')
        LIMIT 1;

        IF v_overlap_id IS NOT NULL THEN
            RAISE EXCEPTION 'Completed timer interval conflicts with active running timer %.', v_overlap_id;
        END IF;

        SELECT te.id INTO v_overlap_id
        FROM public.time_entries te
        JOIN public.time_entry_pauses tep ON tep.time_entry_id = te.id AND tep.resumed_at IS NULL
        WHERE te.user_id = NEW.user_id
          AND te.state = 'paused'
          AND (NEW.id IS NULL OR te.id <> NEW.id)
          AND tstzrange(te.started_at, tep.paused_at, '[)') && tstzrange(NEW.started_at, NEW.ended_at, '[)')
        LIMIT 1;

        IF v_overlap_id IS NOT NULL THEN
            RAISE EXCEPTION 'Completed timer interval conflicts with active period of paused timer %.', v_overlap_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_time_entry_interval ON public.time_entries;
CREATE TRIGGER trg_validate_time_entry_interval
    BEFORE INSERT OR UPDATE ON public.time_entries
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_time_entry_interval();

-- 7.3 Time Entry Pause Validator (BEFORE Trigger)
CREATE OR REPLACE FUNCTION public.fn_validate_time_entry_pause()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_timer RECORD;
    v_overlap_id UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || NEW.user_id::text));

    SELECT * INTO v_timer 
    FROM public.time_entries 
    WHERE id = NEW.time_entry_id;

    IF v_timer.id IS NULL THEN
        RAISE EXCEPTION 'Pause record references non-existent time entry %.', NEW.time_entry_id;
    END IF;

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

    -- Validate pause interval does not overlap completed sessions of OTHER timers
    SELECT id INTO v_overlap_id
    FROM public.time_entries
    WHERE user_id = NEW.user_id
      AND id <> NEW.time_entry_id
      AND state = 'completed'
      AND tstzrange(started_at, ended_at, '[)') && tstzrange(NEW.paused_at, COALESCE(NEW.resumed_at, now()), '[)')
    LIMIT 1;

    IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'Pause interval conflicts with existing completed timer %.', v_overlap_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_time_entry_pause ON public.time_entry_pauses;
CREATE TRIGGER trg_validate_time_entry_pause
    BEFORE INSERT OR UPDATE ON public.time_entry_pauses
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_time_entry_pause();

-- 7.4 Pause Duration Recalculator (AFTER Trigger)
-- Recalculates both OLD and NEW time entries if a pause is moved between timers.
CREATE OR REPLACE FUNCTION public.fn_sync_time_entry_duration_on_pause()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_timer_ids UUID[] := ARRAY[]::UUID[];
    v_tid UUID;
    v_timer RECORD;
    v_open_pause RECORD;
    v_closed_paused INTEGER;
    v_total_paused INTEGER;
    v_elapsed INTEGER;
    v_idle INTEGER;
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

        IF v_timer.id IS NOT NULL THEN
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (resumed_at - paused_at)))::INTEGER, 0)
            INTO v_closed_paused
            FROM public.time_entry_pauses
            WHERE time_entry_id = v_tid AND resumed_at IS NOT NULL;

            SELECT * INTO v_open_pause
            FROM public.time_entry_pauses
            WHERE time_entry_id = v_tid AND resumed_at IS NULL
            LIMIT 1;

            IF v_timer.ended_at IS NOT NULL THEN
                v_elapsed := EXTRACT(EPOCH FROM (v_timer.ended_at - v_timer.started_at))::INTEGER;
                v_total_paused := v_closed_paused;
            ELSE
                v_elapsed := EXTRACT(EPOCH FROM (now() - v_timer.started_at))::INTEGER;
                IF v_open_pause.id IS NOT NULL THEN
                    v_total_paused := v_closed_paused + EXTRACT(EPOCH FROM (now() - v_open_pause.paused_at))::INTEGER;
                ELSE
                    v_total_paused := v_closed_paused;
                END IF;
            END IF;

            v_total_paused := LEAST(v_total_paused, v_elapsed);
            v_idle := COALESCE(v_timer.idle_duration_seconds, 0);

            IF v_idle > (v_elapsed - v_total_paused) THEN
                v_active := 0;
            ELSE
                v_active := (v_elapsed - v_total_paused) - v_idle;
            END IF;

            IF v_timer.active_duration_seconds IS DISTINCT FROM v_active THEN
                UPDATE public.time_entries
                SET active_duration_seconds = v_active,
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

-- 7.5 Task Duration Rollup Synchronizer
CREATE OR REPLACE FUNCTION public.fn_sync_task_actual_duration_on_time_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
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

-- 7.6 Task Hierarchy & Board Consistency Validator
CREATE OR REPLACE FUNCTION public.fn_validate_task_board_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
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

-- 7.7 Task Lifecycle & Completion Synchronizer
CREATE OR REPLACE FUNCTION public.fn_sync_task_status_and_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
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

-- 7.8 Task Status History Audit Logger
-- SECURITY DEFINER allows inserting to task_status_history while client INSERT is denied.
CREATE OR REPLACE FUNCTION public.fn_log_task_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
SET search_path = public, pg_temp
AS $$
DECLARE
    r RECORD;
    v_open_pause RECORD;
    v_total_paused INTEGER;
    v_target_ended_at TIMESTAMPTZ;
    v_target_elapsed INTEGER;
    v_available_elapsed INTEGER;
    v_final_idle INTEGER;
    v_final_active INTEGER;
    v_reason TEXT;
BEGIN
    FOR r IN
        SELECT te.*
        FROM public.time_entries te
        WHERE te.state IN ('running', 'paused')
          AND (te.updated_at < (now() - p_max_age) OR te.started_at < (now() - p_max_age))
        ORDER BY te.started_at ASC
        FOR UPDATE
    LOOP
        -- 1. Quarantine corrupt entries with future start timestamps
        IF r.started_at > now() THEN
            UPDATE public.time_entries
            SET state = 'quarantined',
                is_recovered = true,
                recovery_reason = format('Quarantined: started_at is in the future (%s).', r.started_at),
                updated_at = now()
            WHERE id = r.id;

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

        -- 2. Close any open pause interval at its paused_at timestamp (0s duration added)
        SELECT * INTO v_open_pause
        FROM public.time_entry_pauses
        WHERE time_entry_id = r.id AND resumed_at IS NULL
        LIMIT 1;

        IF v_open_pause.id IS NOT NULL THEN
            UPDATE public.time_entry_pauses
            SET resumed_at = paused_at
            WHERE id = v_open_pause.id;
        END IF;

        -- 3. Sum all closed pause intervals
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (resumed_at - paused_at)))::INTEGER, 0)
        INTO v_total_paused
        FROM public.time_entry_pauses
        WHERE time_entry_id = r.id AND resumed_at IS NOT NULL;

        -- 4. Calculate verified elapsed target duration
        v_final_active := COALESCE(r.active_duration_seconds, 0);
        v_final_idle := COALESCE(r.idle_duration_seconds, 0);
        v_target_elapsed := v_total_paused + v_final_active + v_final_idle;

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

        -- 5. Guard against clock desynchronization or future timestamps
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

        -- 6. Commit recovery updates
        UPDATE public.time_entries
        SET state = 'completed',
            ended_at = v_target_ended_at,
            active_duration_seconds = v_final_active,
            idle_duration_seconds = v_final_idle,
            is_recovered = true,
            recovery_reason = v_reason,
            updated_at = now()
        WHERE id = r.id;

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
SET search_path = public, pg_temp
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
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own time entries" ON public.time_entries;
CREATE POLICY "Users can delete own time entries" ON public.time_entries
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

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

-- 9.9 Computer Activity Events RLS
DROP POLICY IF EXISTS "Users can view own activity events" ON public.computer_activity_events;
CREATE POLICY "Users can view own activity events" ON public.computer_activity_events
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own activity events" ON public.computer_activity_events;
CREATE POLICY "Users can insert own activity events" ON public.computer_activity_events
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own activity events" ON public.computer_activity_events;
CREATE POLICY "Users can delete own activity events" ON public.computer_activity_events
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9.10 Pet Reaction Logs RLS
DROP POLICY IF EXISTS "Users can view own pet reactions" ON public.pet_reaction_logs;
CREATE POLICY "Users can view own pet reactions" ON public.pet_reaction_logs
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own pet reactions" ON public.pet_reaction_logs;
CREATE POLICY "Users can insert own pet reactions" ON public.pet_reaction_logs
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 9.11 Daily Reports RLS
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
-- STEP 10: FUNCTION EXECUTION PRIVILEGES & HARDENING
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reconcile_stale_time_entries(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_time_entries(INTERVAL) TO authenticated;

REVOKE ALL ON FUNCTION public.purge_expired_activity_events(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_activity_events(INTEGER) TO authenticated;

COMMIT;

