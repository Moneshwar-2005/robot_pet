-- ============================================================================
-- KURO PHASE 9 POST-DEPLOYMENT VERIFICATION & INTEGRITY TEST QUERIES
-- REVISION 15 (FINAL DOCUMENTATION CORRECTIONS ONLY)
-- ============================================================================
-- READ-ONLY DIAGNOSTIC SCRIPT
-- Execute in Supabase SQL Editor after running kuro_phase9_reviewed_candidate.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. VERIFY ALL 12 NEW TABLES EXIST
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
    'time_entry_idles', 
    'computer_activity_events', 
    'pet_reaction_logs', 
    'daily_reports'
  )
ORDER BY table_name;
-- Expected: Exactly 12 rows returned.

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
    (table_name = 'tasks' AND column_name IN ('id', 'user_id', 'title', 'completed', 'project_id', 'board_id', 'column_id', 'status', 'position', 'parent_task_id', 'actual_duration_minutes', 'started_at', 'completed_at', 'status_updated_at'))
    OR (table_name = 'user_preferences' AND column_name IN ('id', 'user_id', 'theme', 'activity_tracking_enabled', 'idle_threshold_seconds', 'auto_reports_enabled', 'daily_report_time', 'telemetry_retention_days', 'tracking_include_window_titles', 'tracking_include_process_names'))
    OR (table_name = 'time_entries' AND column_name IN ('state', 'active_duration_seconds', 'idle_duration_seconds', 'is_recovered', 'recovery_reason'))
    OR (table_name = 'time_entry_idles' AND column_name IN ('id', 'user_id', 'time_entry_id', 'started_at', 'ended_at'))
    OR (table_name = 'pet_reaction_logs' AND column_name IN ('reaction_type', 'trigger_event', 'emotion_displayed'))
    OR (table_name = 'daily_reports' AND column_name IN ('report_date', 'total_focus_seconds', 'total_idle_seconds', 'generation_status'))
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
    'tasks',
    'user_preferences',
    'projects', 
    'project_boards', 
    'board_columns', 
    'task_labels', 
    'task_label_assignments', 
    'task_status_history', 
    'time_entries', 
    'time_entry_pauses', 
    'time_entry_idles', 
    'computer_activity_events', 
    'pet_reaction_logs', 
    'daily_reports'
  )
ORDER BY c.relname;
-- Expected: All 14 tables show rls_enabled = true.
-- Baseline tables (tasks, user_preferences): rls_enabled = true. Forced status reflects baseline environment (typically false unless FORCE ROW LEVEL SECURITY was configured in baseline).
-- 11 new user tables: rls_enabled = true, rls_forced = true (FORCE ROW LEVEL SECURITY active).
-- task_status_history: rls_enabled = true, rls_forced = false (standard ENABLE ROW LEVEL SECURITY so SECURITY DEFINER trigger can write).

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
-- 7. VERIFY CANONICAL 5-COLUMN WORKFLOWS ON ALL BOARDS (DETECTS BOARDS WITH 0 COLUMNS)
-- ----------------------------------------------------------------------------
SELECT 
    p.name AS project_name,
    pb.name AS board_name,
    COUNT(bc.id) AS column_count,
    COALESCE(STRING_AGG(bc.status_category, ', ' ORDER BY bc.position), 'NO COLUMNS') AS categories
FROM public.projects p
JOIN public.project_boards pb ON pb.project_id = p.id
LEFT JOIN public.board_columns bc ON bc.board_id = pb.id AND bc.user_id = pb.user_id
GROUP BY p.name, pb.name, pb.id;
-- Expected: Every board must have exactly 5 categories: 'backlog, todo, in_progress, done, cancelled'.
-- Any board with zero columns will explicitly display column_count = 0 and categories = 'NO COLUMNS'.

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
-- 9. VERIFY TIMER EXCLUSION, INDEXES, AND ACTIVE INTERVAL FUNCTIONS
-- ----------------------------------------------------------------------------
-- 9.1 Verify legacy bounding-box constraint is removed (superseded by active multirange model)
SELECT 
    conname, 
    contype, 
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.time_entries'::regclass
  AND conname = 'exclude_overlapping_completed_intervals';
-- Expected: 0 rows (dropped so non-overlapping active work during pauses is permitted).

-- 9.2 Bounding range GiST index on time entries
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'time_entries'
  AND indexname = 'idx_time_entries_user_range';
-- Expected: 1 row showing GiST index on (user_id, tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)'::text))

-- 9.3 Running timer unique partial index
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'time_entries'
  AND indexname = 'idx_unique_running_timer_per_user';
-- Expected: CREATE UNIQUE INDEX idx_unique_running_timer_per_user ON public.time_entries USING btree (user_id) WHERE ((state)::text = 'running'::text)

-- 9.4 Open pause unique partial index
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'time_entry_pauses'
  AND indexname = 'idx_unique_open_pause_per_entry';
-- Expected: CREATE UNIQUE INDEX idx_unique_open_pause_per_entry ON public.time_entry_pauses USING btree (time_entry_id) WHERE (resumed_at IS NULL)

-- 9.5 Open idle unique partial index
SELECT 
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'time_entry_idles'
  AND indexname = 'idx_unique_open_idle_per_entry';
-- Expected: CREATE UNIQUE INDEX idx_unique_open_idle_per_entry ON public.time_entry_idles USING btree (time_entry_id) WHERE (ended_at IS NULL)

-- 9.6 Exclusion constraint on pauses of the same timer
SELECT 
    conname, 
    contype, 
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.time_entry_pauses'::regclass
  AND conname = 'exclude_overlapping_timer_pauses';
-- Expected: 1 row showing GiST exclusion constraint on (time_entry_id WITH =, tstzrange(paused_at, resumed_at, '[)'::text) WITH &&)

-- 9.7 Exclusion constraint on idle intervals of the same timer
SELECT 
    conname, 
    contype, 
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.time_entry_idles'::regclass
  AND conname = 'exclude_overlapping_timer_idles';
-- Expected: 1 row showing GiST exclusion constraint on (time_entry_id WITH =, tstzrange(started_at, ended_at, '[)'::text) WITH &&)

-- 9.8 Verify active interval calculation and conflict functions exist and are VOLATILE (fresh snapshot guarantee)
SELECT 
    proname, 
    prosecdef AS security_definer, 
    provolatile AS volatility_category
FROM pg_proc
WHERE proname IN ('fn_calculate_timer_active_multirange', 'fn_check_active_interval_conflict', 'reconcile_stale_time_entries')
ORDER BY proname;
-- Expected: 3 rows returned. All MUST have provolatile = 'v' (VOLATILE) to ensure
-- fresh database command snapshots are obtained after transaction advisory lock acquisition.

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
  AND event_object_table IN ('tasks', 'time_entries', 'time_entry_pauses', 'time_entry_idles', 'project_boards', 'board_columns', 'projects')
ORDER BY event_object_table, trigger_name, event_manipulation;
-- Expected:
-- tasks: trg_log_task_status_history, trg_sync_task_status_and_completion, trg_validate_task_board_hierarchy
-- time_entries: trg_sync_task_actual_duration, trg_time_entries_updated_at, trg_validate_time_entry_interval
-- time_entry_pauses: trg_sync_time_entry_duration_on_pause, trg_validate_time_entry_pause (handling INSERT, UPDATE, DELETE)
-- time_entry_idles: trg_sync_time_entry_duration_on_idle, trg_validate_time_entry_idle (handling INSERT, UPDATE, DELETE)
-- projects / boards / columns: trg_*_updated_at

-- ----------------------------------------------------------------------------
-- 11. VERIFY PROJECT -> BOARD -> COLUMN HIERARCHY (MUST RETURN ZERO)
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS invalid_task_hierarchy_count
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
-- Expected: 0.

-- ----------------------------------------------------------------------------
-- 12. VERIFY PARENT TASK OWNERSHIP AND PROJECT (MUST RETURN ZERO)
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS invalid_parent_task_count
FROM public.tasks child
LEFT JOIN public.tasks parent
  ON parent.id = child.parent_task_id
 AND parent.user_id = child.user_id
WHERE child.parent_task_id IS NOT NULL
  AND (parent.id IS NULL OR parent.project_id IS DISTINCT FROM child.project_id);
-- Expected: 0.

-- ----------------------------------------------------------------------------
-- 13. VERIFY EVERY BOARD HAS ALL FIVE WORKFLOW CATEGORIES
-- ----------------------------------------------------------------------------
SELECT
    pb.id AS board_id,
    pb.name AS board_name,
    COUNT(bc.id) AS column_count,
    COUNT(DISTINCT bc.status_category) AS distinct_category_count,
    COALESCE(STRING_AGG(DISTINCT bc.status_category, ', ' ORDER BY bc.status_category), 'NO COLUMNS') AS categories
FROM public.project_boards pb
LEFT JOIN public.board_columns bc
  ON bc.board_id = pb.id
 AND bc.user_id = pb.user_id
GROUP BY pb.id, pb.name
HAVING COUNT(bc.id) <> 5
    OR COUNT(DISTINCT bc.status_category) <> 5;
-- Expected: 0 rows (catches boards with 0 columns or missing categories).

-- ----------------------------------------------------------------------------
-- 14. TIMER, PAUSE & IDLE RUNTIME INTEGRITY AUDIT (MUST ALL RETURN ZERO)
-- ----------------------------------------------------------------------------

-- 14.1 Verify zero active interval conflicts exist across all timers of each user (accounting for pauses AND idles)
SELECT 
    t1.id AS timer_1_id,
    t2.id AS timer_2_id,
    t1.user_id,
    t1.state AS state_1,
    t2.state AS state_2
FROM public.time_entries t1
JOIN public.time_entries t2 
  ON t1.user_id = t2.user_id 
 AND t1.id < t2.id
WHERE t1.state IN ('running', 'paused', 'completed')
  AND t2.state IN ('running', 'paused', 'completed')
  AND tstzrange(t1.started_at, COALESCE(t1.ended_at, now()), '[)') && tstzrange(t2.started_at, COALESCE(t2.ended_at, now()), '[)')
  AND public.fn_calculate_timer_active_multirange(t1.id, t1.started_at, t1.ended_at) && 
      public.fn_calculate_timer_active_multirange(t2.id, t2.started_at, t2.ended_at);
-- Expected: 0 rows. (Zero active work intervals overlap for the same user).

-- 14.2 Verify zero pause chronology or bounds violations (Non-Quarantined Timers)
SELECT COUNT(*) AS invalid_pause_chronology_count
FROM public.time_entry_pauses p
JOIN public.time_entries t ON t.id = p.time_entry_id
WHERE t.state <> 'quarantined'
  AND (
      (p.resumed_at IS NOT NULL AND p.resumed_at < p.paused_at)
   OR p.paused_at < t.started_at
   OR (t.ended_at IS NOT NULL AND p.paused_at > t.ended_at)
   OR (t.ended_at IS NOT NULL AND p.resumed_at IS NOT NULL AND p.resumed_at > t.ended_at)
  );
-- Expected: 0.

-- 14.3 Verify zero idle interval chronology or bounds violations (Non-Quarantined Timers)
SELECT COUNT(*) AS invalid_idle_chronology_count
FROM public.time_entry_idles i
JOIN public.time_entries t ON t.id = i.time_entry_id
WHERE t.state <> 'quarantined'
  AND (
      (i.ended_at IS NOT NULL AND i.ended_at < i.started_at)
   OR i.started_at < t.started_at
   OR (t.ended_at IS NOT NULL AND i.started_at > t.ended_at)
   OR (t.ended_at IS NOT NULL AND i.ended_at IS NOT NULL AND i.ended_at > t.ended_at)
  );
-- Expected: 0.

-- 14.4 Verify zero overlap between pauses and idle intervals of the same timer (Non-Quarantined Timers)
SELECT COUNT(*) AS pause_idle_overlap_count
FROM public.time_entry_pauses p
JOIN public.time_entry_idles i ON i.time_entry_id = p.time_entry_id
JOIN public.time_entries t ON t.id = p.time_entry_id
WHERE t.state <> 'quarantined'
  AND tstzrange(p.paused_at, COALESCE(p.resumed_at, 'infinity'::timestamptz), '[)') &&
      tstzrange(i.started_at, COALESCE(i.ended_at, 'infinity'::timestamptz), '[)');
-- Expected: 0.

-- 14.5 Verify zero overlapping pause intervals on the same timer (Non-Quarantined Timers)
SELECT COUNT(*) AS overlapping_pauses_count
FROM public.time_entry_pauses p1
JOIN public.time_entry_pauses p2 
  ON p1.time_entry_id = p2.time_entry_id
 AND p1.id < p2.id
JOIN public.time_entries t ON t.id = p1.time_entry_id
WHERE t.state <> 'quarantined'
  AND tstzrange(p1.paused_at, COALESCE(p1.resumed_at, 'infinity'::timestamptz), '[)') &&
      tstzrange(p2.paused_at, COALESCE(p2.resumed_at, 'infinity'::timestamptz), '[)');
-- Expected: 0.

-- 14.6 Verify zero overlapping idle intervals on the same timer (Non-Quarantined Timers)
SELECT COUNT(*) AS overlapping_idles_count
FROM public.time_entry_idles i1
JOIN public.time_entry_idles i2 
  ON i1.time_entry_id = i2.time_entry_id
 AND i1.id < i2.id
JOIN public.time_entries t ON t.id = i1.time_entry_id
WHERE t.state <> 'quarantined'
  AND tstzrange(i1.started_at, COALESCE(i1.ended_at, 'infinity'::timestamptz), '[)') &&
      tstzrange(i2.started_at, COALESCE(i2.ended_at, 'infinity'::timestamptz), '[)');
-- Expected: 0.

-- 14.7 EXHAUSTIVE TIMER DURATION & INTERVAL CONSISTENCY AUDIT (NON-QUARANTINED)

-- 14.7.1 Verify zero negative or impossible durations (Non-Quarantined Timers)
SELECT COUNT(*) AS negative_or_impossible_duration_count
FROM public.time_entries te
WHERE te.state <> 'quarantined'
  AND (
      te.active_duration_seconds < 0
   OR te.idle_duration_seconds < 0
   OR (te.ended_at IS NOT NULL AND te.ended_at < te.started_at)
  );
-- Expected: 0.

-- 14.7.2 Verify stored idle_duration_seconds vs actual idle interval sum (Non-Quarantined Timers)
SELECT 
    te.id AS timer_id,
    te.idle_duration_seconds AS stored_idle,
    sub.interval_idle_sum,
    ABS(te.idle_duration_seconds - sub.interval_idle_sum) AS discrepancy_seconds
FROM public.time_entries te
JOIN (
    SELECT 
        time_entry_id, 
        SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::INTEGER) AS interval_idle_sum
    FROM public.time_entry_idles
    GROUP BY time_entry_id
) sub ON sub.time_entry_id = te.id
WHERE te.state <> 'quarantined'
  AND ABS(te.idle_duration_seconds - sub.interval_idle_sum) > 1;
-- Expected: 0 rows.

-- 14.7.3 Verify completed timer duration consistency (active + idle + pauses == elapsed duration +/- 2s)
-- Detects both under-counting and over-counting on completed sessions.
SELECT 
    te.id AS timer_id,
    te.started_at,
    te.ended_at,
    EXTRACT(EPOCH FROM (te.ended_at - te.started_at))::INTEGER AS elapsed_seconds,
    te.active_duration_seconds AS active_seconds,
    te.idle_duration_seconds AS idle_seconds,
    COALESCE(p_sub.pause_seconds, 0) AS pause_seconds,
    (te.active_duration_seconds + te.idle_duration_seconds + COALESCE(p_sub.pause_seconds, 0)) AS calculated_total_seconds,
    ABS(EXTRACT(EPOCH FROM (te.ended_at - te.started_at))::INTEGER - 
        (te.active_duration_seconds + te.idle_duration_seconds + COALESCE(p_sub.pause_seconds, 0))) AS discrepancy_seconds
FROM public.time_entries te
LEFT JOIN (
    SELECT 
        time_entry_id, 
        SUM(EXTRACT(EPOCH FROM (COALESCE(resumed_at, now()) - paused_at))::INTEGER) AS pause_seconds
    FROM public.time_entry_pauses
    GROUP BY time_entry_id
) p_sub ON p_sub.time_entry_id = te.id
WHERE te.state = 'completed'
  AND ABS(EXTRACT(EPOCH FROM (te.ended_at - te.started_at))::INTEGER - 
         (te.active_duration_seconds + te.idle_duration_seconds + COALESCE(p_sub.pause_seconds, 0))) > 2;
-- Expected: 0 rows.

-- 14.7.4 Verify running/paused timer duration bounds (active cannot exceed elapsed minus pauses and idles)
SELECT COUNT(*) AS running_duration_overflow_count
FROM (
    SELECT 
        te.id,
        te.active_duration_seconds,
        EXTRACT(EPOCH FROM (now() - te.started_at))::INTEGER AS elapsed_to_now,
        COALESCE(p_sub.pause_seconds, 0) AS pause_seconds,
        COALESCE(i_sub.idle_seconds, 0) AS idle_seconds
    FROM public.time_entries te
    LEFT JOIN (
        SELECT time_entry_id, SUM(EXTRACT(EPOCH FROM (COALESCE(resumed_at, now()) - paused_at))::INTEGER) AS pause_seconds
        FROM public.time_entry_pauses GROUP BY time_entry_id
    ) p_sub ON p_sub.time_entry_id = te.id
    LEFT JOIN (
        SELECT time_entry_id, SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))::INTEGER) AS idle_seconds
        FROM public.time_entry_idles GROUP BY time_entry_id
    ) i_sub ON i_sub.time_entry_id = te.id
    WHERE te.state IN ('running', 'paused')
) sub
WHERE sub.active_duration_seconds > GREATEST(0, (sub.elapsed_to_now - sub.pause_seconds - sub.idle_seconds)) + 2;
-- Expected: 0.

-- 14.7.5 Verify zero pause intervals outside parent timer bounds (Non-Quarantined Timers)
SELECT COUNT(*) AS pause_outside_parent_bounds_count
FROM public.time_entry_pauses p
JOIN public.time_entries te ON te.id = p.time_entry_id
WHERE te.state <> 'quarantined'
  AND (
      p.paused_at < te.started_at
   OR (te.ended_at IS NOT NULL AND p.paused_at > te.ended_at)
   OR (te.ended_at IS NOT NULL AND p.resumed_at IS NOT NULL AND p.resumed_at > te.ended_at)
  );
-- Expected: 0.

-- 14.7.6 Verify zero idle intervals outside parent timer bounds (Non-Quarantined Timers)
SELECT COUNT(*) AS idle_outside_parent_bounds_count
FROM public.time_entry_idles i
JOIN public.time_entries te ON te.id = i.time_entry_id
WHERE te.state <> 'quarantined'
  AND (
      i.started_at < te.started_at
   OR (te.ended_at IS NOT NULL AND i.started_at > te.ended_at)
   OR (te.ended_at IS NOT NULL AND i.ended_at IS NOT NULL AND i.ended_at > te.ended_at)
  );
-- Expected: 0.

-- 14.8 Verify zero completed timers have open pauses or open idle intervals
SELECT COUNT(*) AS completed_timers_with_open_intervals_count
FROM public.time_entries te
WHERE te.state = 'completed'
  AND (
      EXISTS (SELECT 1 FROM public.time_entry_pauses p WHERE p.time_entry_id = te.id AND p.resumed_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.time_entry_idles i WHERE i.time_entry_id = te.id AND i.ended_at IS NULL)
  );
-- Expected: 0.

-- 14.9 Verify zero users have more than 1 running timer
SELECT 
    user_id, 
    COUNT(*) AS running_count
FROM public.time_entries
WHERE state = 'running'
GROUP BY user_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows.

-- ----------------------------------------------------------------------------
-- 14.10 QUARANTINE FORENSIC AUDIT & INCONSISTENCY DIAGNOSTICS
-- ----------------------------------------------------------------------------
-- Quarantined timers preserve anomalous historical child records intentionally
-- so operators can audit root causes without compromising ordinary active timer integrity.

-- 14.10.1 Quarantined Timers Registry & Forensic Metadata Audit
-- Lists all quarantined timers with user, timeline bounds, and forensic recovery reasons.
SELECT 
    te.id AS quarantined_timer_id,
    te.user_id,
    te.task_id,
    te.started_at,
    te.ended_at,
    te.active_duration_seconds,
    te.idle_duration_seconds,
    te.is_recovered,
    te.recovery_reason,
    te.created_at,
    te.updated_at,
    (SELECT COUNT(*) FROM public.time_entry_pauses p WHERE p.time_entry_id = te.id) AS pause_interval_count,
    (SELECT COUNT(*) FROM public.time_entry_idles i WHERE i.time_entry_id = te.id) AS idle_interval_count
FROM public.time_entries te
WHERE te.state = 'quarantined'
ORDER BY te.started_at DESC;
-- Informational Diagnostic: Displays forensic catalog of all quarantined sessions.

-- 14.10.2 Preserved Child Pause Inconsistencies on Quarantined Timers
-- Identifies preserved pause intervals that exceed parent bounds or violate chronology.
SELECT 
    te.id AS quarantined_timer_id,
    te.user_id,
    te.recovery_reason,
    p.id AS pause_id,
    p.paused_at,
    p.resumed_at,
    te.started_at AS parent_started_at,
    te.ended_at AS parent_ended_at,
    CASE 
        WHEN p.paused_at < te.started_at THEN 'paused_at precedes parent started_at'
        WHEN te.ended_at IS NOT NULL AND p.paused_at > te.ended_at AND p.resumed_at IS NOT NULL AND p.resumed_at > te.ended_at THEN 'both paused_at and resumed_at exceed parent ended_at'
        WHEN te.ended_at IS NOT NULL AND p.paused_at > te.ended_at THEN 'paused_at exceeds parent ended_at'
        WHEN te.ended_at IS NOT NULL AND p.resumed_at IS NOT NULL AND p.resumed_at > te.ended_at THEN 'resumed_at exceeds parent ended_at'
        WHEN p.resumed_at IS NOT NULL AND p.resumed_at < p.paused_at THEN 'resumed_at precedes paused_at'
        WHEN p.resumed_at IS NULL THEN 'unclosed open pause'
        ELSE 'other pause inconsistency'
    END AS anomaly_classification
FROM public.time_entry_pauses p
JOIN public.time_entries te ON te.id = p.time_entry_id
WHERE te.state = 'quarantined'
  AND (
      p.paused_at < te.started_at
   OR (te.ended_at IS NOT NULL AND p.paused_at > te.ended_at)
   OR (te.ended_at IS NOT NULL AND p.resumed_at IS NOT NULL AND p.resumed_at > te.ended_at)
   OR (p.resumed_at IS NOT NULL AND p.resumed_at < p.paused_at)
   OR p.resumed_at IS NULL
  )
ORDER BY te.id, p.paused_at;
-- Informational Diagnostic: Lists exact child pause anomalies preserved for forensic investigation.

-- 14.10.3 Preserved Child Idle Inconsistencies on Quarantined Timers
-- Identifies preserved idle intervals that exceed parent bounds or violate chronology.
SELECT 
    te.id AS quarantined_timer_id,
    te.user_id,
    te.recovery_reason,
    i.id AS idle_id,
    i.started_at AS idle_started_at,
    i.ended_at AS idle_ended_at,
    te.started_at AS parent_started_at,
    te.ended_at AS parent_ended_at,
    CASE 
        WHEN i.started_at < te.started_at THEN 'idle started_at precedes parent started_at'
        WHEN te.ended_at IS NOT NULL AND i.started_at > te.ended_at AND i.ended_at IS NOT NULL AND i.ended_at > te.ended_at THEN 'both idle started_at and ended_at exceed parent ended_at'
        WHEN te.ended_at IS NOT NULL AND i.started_at > te.ended_at THEN 'idle started_at exceeds parent ended_at'
        WHEN te.ended_at IS NOT NULL AND i.ended_at IS NOT NULL AND i.ended_at > te.ended_at THEN 'idle ended_at exceeds parent ended_at'
        WHEN i.ended_at IS NOT NULL AND i.ended_at < i.started_at THEN 'idle ended_at precedes started_at'
        WHEN i.ended_at IS NULL THEN 'unclosed open idle'
        ELSE 'other idle inconsistency'
    END AS anomaly_classification
FROM public.time_entry_idles i
JOIN public.time_entries te ON te.id = i.time_entry_id
WHERE te.state = 'quarantined'
  AND (
      i.started_at < te.started_at
   OR (te.ended_at IS NOT NULL AND i.started_at > te.ended_at)
   OR (te.ended_at IS NOT NULL AND i.ended_at IS NOT NULL AND i.ended_at > te.ended_at)
   OR (i.ended_at IS NOT NULL AND i.ended_at < i.started_at)
   OR i.ended_at IS NULL
  )
ORDER BY te.id, i.started_at;
-- Informational Diagnostic: Lists exact child idle anomalies preserved for forensic investigation.

-- 14.10.4 Active Interval Conflicts Triggering Quarantine
-- Identifies quarantined timers resulting from active work collisions with existing sessions.
SELECT 
    te.id AS quarantined_timer_id,
    te.user_id,
    te.task_id,
    te.started_at,
    te.ended_at,
    te.recovery_reason
FROM public.time_entries te
WHERE te.state = 'quarantined'
  AND te.recovery_reason LIKE '%active interval conflicts%'
ORDER BY te.started_at DESC;
-- Informational Diagnostic: Lists sessions quarantined due to overlapping work collisions.


-- ----------------------------------------------------------------------------
-- 15. COMPREHENSIVE PRIVILEGE, OWNER, AND RLS POLICY AUDIT
-- ----------------------------------------------------------------------------

-- 15.1 Verify table owners and RLS status for all 14 application tables
SELECT 
    c.relname AS table_name,
    pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'tasks', 'user_preferences', 'projects', 'project_boards', 'board_columns',
    'task_labels', 'task_label_assignments', 'task_status_history', 'time_entries',
    'time_entry_pauses', 'time_entry_idles', 'computer_activity_events',
    'pet_reaction_logs', 'daily_reports'
  )
ORDER BY c.relname;
-- Expected: Exactly 14 rows.
-- table_owner: postgres (or deployment role).
-- rls_enabled: true on all 14 tables.
-- rls_forced: true on 13 tables (false on task_status_history for trigger ledger writes).

-- 15.2 Verify table grants for authenticated role
SELECT 
    table_name,
    STRING_AGG(privilege_type, ', ' ORDER BY privilege_type) AS granted_privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
  AND table_name IN (
    'tasks', 'user_preferences', 'projects', 'project_boards', 'board_columns',
    'task_labels', 'task_label_assignments', 'task_status_history', 'time_entries',
    'time_entry_pauses', 'time_entry_idles', 'computer_activity_events',
    'pet_reaction_logs', 'daily_reports'
  )
GROUP BY table_name
ORDER BY table_name;
-- Expected:
-- task_status_history: 'SELECT' only.
-- All other 13 tables: 'DELETE, INSERT, SELECT, UPDATE'.

-- 15.3 Verify anon role has zero grants on public tables
SELECT 
    COUNT(*) AS anon_forbidden_grants_count
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND table_name IN (
    'tasks', 'user_preferences', 'projects', 'project_boards', 'board_columns',
    'task_labels', 'task_label_assignments', 'task_status_history', 'time_entries',
    'time_entry_pauses', 'time_entry_idles', 'computer_activity_events',
    'pet_reaction_logs', 'daily_reports'
  );
-- Expected: 0.

-- 15.4 Verify all 14 functions have correct owners, search paths, and security flags
SELECT 
    p.proname AS function_name,
    pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
    p.prosecdef AS is_security_definer,
    p.provolatile AS volatility,
    COALESCE(pg_catalog.array_to_string(p.proconfig, '; '), 'NONE') AS search_path_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fn_set_updated_at',
    'fn_calculate_timer_active_multirange',
    'fn_check_active_interval_conflict',
    'fn_validate_time_entry_interval',
    'fn_validate_time_entry_pause',
    'fn_sync_time_entry_duration_on_pause',
    'fn_validate_time_entry_idle',
    'fn_sync_time_entry_duration_on_idle',
    'fn_sync_task_actual_duration_on_time_entry',
    'fn_validate_task_board_hierarchy',
    'fn_sync_task_status_and_completion',
    'fn_log_task_status_history',
    'reconcile_stale_time_entries',
    'purge_expired_activity_events'
  )
ORDER BY p.proname;
-- Expected: Exactly 14 rows.
-- fn_log_task_status_history: is_security_definer = true, volatility = 'v'.
-- fn_calculate_timer_active_multirange: is_security_definer = false, volatility = 'v'.
-- fn_check_active_interval_conflict: is_security_definer = false, volatility = 'v'.
-- All 14 functions MUST display: search_path_config = 'search_path=pg_catalog, public, pg_temp'.

-- 15.5 Function EXECUTE privilege audit (Catalog-based ACL Inspection on PostgreSQL 15+)
SELECT 
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS argument_types,
    -- Detect PUBLIC execute: grantee = 0 in aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))
    EXISTS (
        SELECT 1 
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) AS public_can_execute,
    -- Verify role-specific execute permissions via has_function_privilege
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
    p.proacl AS access_control_list
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fn_set_updated_at',
    'fn_calculate_timer_active_multirange',
    'fn_check_active_interval_conflict',
    'fn_validate_time_entry_interval',
    'fn_validate_time_entry_pause',
    'fn_sync_time_entry_duration_on_pause',
    'fn_validate_time_entry_idle',
    'fn_sync_time_entry_duration_on_idle',
    'fn_sync_task_actual_duration_on_time_entry',
    'fn_validate_task_board_hierarchy',
    'fn_sync_task_status_and_completion',
    'fn_log_task_status_history',
    'reconcile_stale_time_entries',
    'purge_expired_activity_events'
  )
ORDER BY p.proname;
-- Expected:
-- public_can_execute: FALSE for all 14 functions (grantee = 0 EXECUTE entry is absent from aclexplode).
-- anon_can_execute: FALSE for all 14 functions (no anonymous execution).
-- authenticated_can_execute: TRUE ONLY for the 3 approved callable utilities:
--   1. fn_calculate_timer_active_multirange
--   2. fn_check_active_interval_conflict
--   3. purge_expired_activity_events
--   FALSE for reconcile_stale_time_entries (administrative maintenance restricted strictly to service_role worker).
--   FALSE for all 10 internal trigger functions (no direct authenticated client execution).
-- service_role_can_execute: TRUE for all 14 functions.

-- 15.6 Authoritative Table-level Privilege Verification via has_table_privilege()
SELECT 
    c.relname AS table_name,
    has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select,
    has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_can_select,
    has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_can_insert,
    has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_can_update,
    has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_can_delete,
    has_table_privilege('service_role', c.oid, 'SELECT') AS service_role_can_select,
    has_table_privilege('service_role', c.oid, 'INSERT') AS service_role_can_insert,
    has_table_privilege('service_role', c.oid, 'UPDATE') AS service_role_can_update,
    has_table_privilege('service_role', c.oid, 'DELETE') AS service_role_can_delete,
    has_table_privilege('service_role', c.oid, 'TRUNCATE') AS service_role_can_truncate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'tasks', 'user_preferences', 'projects', 'project_boards', 'board_columns',
    'task_labels', 'task_label_assignments', 'task_status_history', 'time_entries',
    'time_entry_pauses', 'time_entry_idles', 'computer_activity_events',
    'pet_reaction_logs', 'daily_reports'
  )
ORDER BY c.relname;
-- Expected:
-- anon_can_select: FALSE on all 14 tables.
-- auth_can_select: TRUE on all 14 tables.
-- auth_can_insert/update/delete: TRUE on 13 tables, FALSE on task_status_history.
-- service_role_can_select/insert/update/delete: TRUE on all 14 tables.
-- service_role_can_truncate: FALSE on time_entries, time_entry_pauses, time_entry_idles (TRUNCATE revoked); TRUE on other tables.

-- 15.6.1 Verify TRUNCATE privilege restriction on timer entities for service_role
-- Validates that service_role does NOT hold TRUNCATE privilege on time_entries,
-- time_entry_pauses, or time_entry_idles, closing the TRUNCATE trigger-bypass vector.
SELECT 
    c.relname AS table_name,
    has_table_privilege('service_role', c.oid, 'TRUNCATE') AS service_role_can_truncate,
    has_table_privilege('service_role', c.oid, 'SELECT') AS service_role_can_select,
    has_table_privilege('service_role', c.oid, 'INSERT') AS service_role_can_insert,
    has_table_privilege('service_role', c.oid, 'UPDATE') AS service_role_can_update,
    has_table_privilege('service_role', c.oid, 'DELETE') AS service_role_can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('time_entries', 'time_entry_pauses', 'time_entry_idles')
ORDER BY c.relname;
-- Expected: Exactly 3 rows.
-- service_role_can_truncate: FALSE for all 3 tables (TRUNCATE revoked).
-- service_role_can_select/insert/update/delete: TRUE for all 3 tables.

-- 15.7 Inspect baseline RLS policies on tasks and user_preferences
-- ----------------------------------------------------------------------------
-- MANDATORY STAGING VERIFICATION REQUIREMENT:
-- Baseline tables (public.tasks and public.user_preferences) predate Phase 9.
-- Their existing RLS policies are preserved as-is and are NOT overwritten or
-- redefined by the migration script to prevent accidental policy regression.
--
-- Because baseline policy definitions cannot be established from static repository
-- files without live database catalog introspection, staging operators MUST run
-- this diagnostic query against the staging runtime database prior to production
-- sign-off to verify:
--   1. Permissive status: permissive = 'PERMISSIVE' (no RESTRICTIVE conflicts).
--   2. Target roles: roles contains 'authenticated' (or {public}).
--   3. Commands: cmd covers SELECT, INSERT, UPDATE, DELETE (or separate per-cmd policies).
--   4. Tenant Isolation Qualifiers (USING vs WITH CHECK):
--      In PostgreSQL Row Level Security, USING and WITH CHECK apply according to
--      the specific policy command (cmd). Do NOT assume both expressions exist
--      for every policy:
--      - SELECT policies: Only qual (USING) applies; with_check is NULL and not expected.
--      - DELETE policies: Only qual (USING) applies; with_check is NULL and not expected.
--      - INSERT policies: Only with_check (WITH CHECK) applies; qual is NULL and not expected.
--      - UPDATE policies: qual (USING) filters existing rows eligible for update;
--        with_check (WITH CHECK) validates new values (with_check may be NULL if it
--        implicitly defaults to the USING expression).
--      - ALL policies: qual (USING) applies to existing rows; with_check (WITH CHECK)
--        applies to newly created/updated rows.
--      Verify that whichever expression applies to the given command strictly enforces
--      user isolation: (auth.uid() = user_id) or ((SELECT auth.uid()) = user_id).
--   5. Zero permissive cross-user policies: ensure no policy has qual = 'true' or
--      with_check = 'true' or omits the user_id boundary.
-- Staging baseline policy inspection is strictly mandatory before production sign-off.
-- Cross-user isolation on both baseline tables is dynamically confirmed by Acceptance
-- Test 10 (Test 10.1 SELECT isolation, Test 10.2b INSERT rejection with 42501,
-- Test 10.3 UPDATE 0 rows, and Test 10.4 DELETE 0 rows).
-- ----------------------------------------------------------------------------
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tasks', 'user_preferences')
ORDER BY tablename, policyname;
-- Expected: All policies must enforce user isolation (auth.uid() = user_id). Zero permissive cross-user policies.
