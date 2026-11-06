-- ============================================================================
-- KURO PHASE 9 POST-DEPLOYMENT VERIFICATION & INTEGRITY TEST QUERIES
-- ============================================================================
-- READ-ONLY DIAGNOSTIC SCRIPT
-- Execute in Supabase SQL Editor after running kuro_phase9_final_migration.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. VERIFY ALL 11 NEW TABLES EXIST
-- ----------------------------------------------------------------------------
SELECT 
    table_name, 
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'projects', 
    'project_boards', 
    'board_columns', 
    'task_labels', 
    'task_label_assignments', 
    'task_status_history', 
    'time_entries', 
    'time_entry_pauses', 
    'computer_activity_events', 
    'pet_reaction_logs', 
    'daily_reports'
  )
ORDER BY table_name;
-- Expected: Exactly 11 rows returned.

-- ----------------------------------------------------------------------------
-- 2. VERIFY REQUIRED COLUMNS ON BASELINE AND NEW TABLES
-- ----------------------------------------------------------------------------
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'tasks' AND column_name IN ('project_id', 'board_id', 'column_id', 'status', 'position', 'parent_task_id', 'actual_duration_minutes', 'started_at', 'completed_at', 'status_updated_at'))
    OR (table_name = 'user_preferences' AND column_name IN ('activity_tracking_enabled', 'idle_threshold_seconds', 'auto_reports_enabled', 'daily_report_time', 'telemetry_retention_days', 'tracking_include_window_titles', 'tracking_include_process_names'))
    OR (table_name = 'time_entries' AND column_name IN ('state', 'active_duration_seconds', 'idle_duration_seconds', 'is_recovered', 'recovery_reason'))
  )
ORDER BY table_name, column_name;

-- ----------------------------------------------------------------------------
-- 3. VERIFY PRIVACY-FIRST DEFAULTS ON USER PREFERENCES
-- ----------------------------------------------------------------------------
-- Verifies that tracking, window titles, and process names default to false.
SELECT 
    column_name, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_preferences'
  AND column_name IN (
    'activity_tracking_enabled', 
    'auto_reports_enabled', 
    'tracking_include_window_titles', 
    'tracking_include_process_names'
  );
-- Expected: All four columns must show column_default = 'false'.

-- ----------------------------------------------------------------------------
-- 4. VERIFY ROW LEVEL SECURITY (RLS) & FORCED STATUS
-- ----------------------------------------------------------------------------
SELECT 
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'projects', 
    'project_boards', 
    'board_columns', 
    'task_labels', 
    'task_label_assignments', 
    'task_status_history', 
    'time_entries', 
    'time_entry_pauses', 
    'computer_activity_events', 
    'pet_reaction_logs', 
    'daily_reports'
  )
ORDER BY c.relname;
-- Expected: All 11 tables show rls_enabled = true.
-- 10 user tables show rls_forced = true.
-- task_status_history shows rls_forced = false (standard ENABLE so SECURITY DEFINER trigger can write).

-- ----------------------------------------------------------------------------
-- 5. VERIFY TASK STATUS HISTORY PERMISSIONS (IMMUTABLE AUDIT LEDGER)
-- ----------------------------------------------------------------------------
-- Confirms that authenticated users ONLY have SELECT permission, zero INSERT/UPDATE/DELETE.
SELECT 
    polname AS policy_name,
    polcmd AS policy_command,
    polroles::text AS target_roles
FROM pg_policy
WHERE polrelid = 'public.task_status_history'::regclass;
-- Expected: Exactly 1 row for SELECT ("Users can view own task history"). Zero INSERT/UPDATE/DELETE policies.

-- ----------------------------------------------------------------------------
-- 6. VERIFY ZERO UNASSIGNED TASKS
-- ----------------------------------------------------------------------------
SELECT 
    COUNT(*) AS unassigned_tasks_count
FROM public.tasks
WHERE project_id IS NULL 
   OR board_id IS NULL 
   OR column_id IS NULL;
-- Expected: Exactly 0.

-- ----------------------------------------------------------------------------
-- 7. VERIFY CANONICAL 5-COLUMN WORKFLOWS ON ALL BOARDS
-- ----------------------------------------------------------------------------
SELECT 
    p.name AS project_name,
    pb.name AS board_name,
    COUNT(bc.id) AS column_count,
    STRING_AGG(bc.status_category, ', ' ORDER BY bc.position) AS categories
FROM public.projects p
JOIN public.project_boards pb ON pb.project_id = p.id
JOIN public.board_columns bc ON bc.board_id = pb.id
GROUP BY p.name, pb.name, pb.id;
-- Expected: Every board must have exactly 5 columns: 'backlog, todo, in_progress, done, cancelled'.

-- ----------------------------------------------------------------------------
-- 8. VERIFY FOREIGN KEY CONSTRAINTS AND DEFERRED NO ACTION
-- ----------------------------------------------------------------------------
SELECT 
    tc.table_name,
    tc.constraint_name,
    rc.delete_rule,
    tc.is_deferrable,
    tc.initially_deferred
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc 
    ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'tasks'
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.constraint_name;
-- Expected:
-- fk_tasks_project: NO ACTION, YES, YES
-- fk_tasks_board: NO ACTION, YES, YES
-- fk_tasks_column: NO ACTION, YES, YES
-- fk_tasks_parent_task: SET NULL, NO, NO

-- ----------------------------------------------------------------------------
-- 9. VERIFY TIMER EXCLUSION AND UNIQUE CONSTRAINTS
-- ----------------------------------------------------------------------------
-- 9.1 Completed interval GiST exclusion constraint
SELECT 
    conname, 
    contype, 
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.time_entries'::regclass
  AND conname = 'exclude_overlapping_completed_intervals';
-- Expected: EXCLUDE USING gist (user_id WITH =, tstzrange(started_at, ended_at, '[)'::text) WITH &&) WHERE (state::text = 'completed'::text)

-- 9.2 Running timer unique partial index
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'time_entries'
  AND indexname = 'idx_unique_running_timer_per_user';
-- Expected: CREATE UNIQUE INDEX idx_unique_running_timer_per_user ON public.time_entries USING btree (user_id) WHERE ((state)::text = 'running'::text)

-- 9.3 Open pause unique partial index
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'time_entry_pauses'
  AND indexname = 'idx_unique_open_pause_per_entry';
-- Expected: CREATE UNIQUE INDEX idx_unique_open_pause_per_entry ON public.time_entry_pauses USING btree (time_entry_id) WHERE (resumed_at IS NULL)

-- ----------------------------------------------------------------------------
-- 10. VERIFY ALL TRIGGERS INSTALLED AND ACTIVE
-- ----------------------------------------------------------------------------
SELECT 
    event_object_table AS target_table,
    trigger_name,
    action_timing,
    event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('tasks', 'time_entries', 'time_entry_pauses', 'project_boards', 'board_columns', 'projects')
ORDER BY event_object_table, trigger_name;
-- Expected:
-- tasks: trg_log_task_status_history, trg_sync_task_status_and_completion, trg_validate_task_board_hierarchy
-- time_entries: trg_sync_task_actual_duration, trg_time_entries_updated_at, trg_validate_time_entry_interval
-- time_entry_pauses: trg_sync_time_entry_duration_on_pause, trg_validate_time_entry_pause
-- projects / boards / columns: trg_*_updated_at

