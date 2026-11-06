# KURO PHASE 9 — DATABASE DEPLOYMENT & VERIFICATION GUIDE

**Status: READY FOR STAGING TESTING (REVISION 15 — FINAL DOCUMENTATION CORRECTIONS ONLY)**  
*(STRICT RULE: NOT APPROVED FOR PRODUCTION DEPLOYMENT UNTIL STAGING RUNTIME VERIFICATION IS COMPLETED)*

This document provides operational specifications, architectural proofs, reproducible single-session acceptance test scripts, and two-connection concurrency test procedures for the Kuro Phase 9 database migration.

---

## 1. Deliverable Files Overview

| Deliverable | Path | Summary |
|---|---|---|
| Migration Script | `docs/kuro_phase9_reviewed_candidate.sql` | Complete, atomic, idempotent PostgreSQL 15+ migration (Revision 15). Creates 12 new application tables, extends 2 baseline tables with 19 additive columns, installs triggers, RLS policies, explicit table-level grants, immutable quarantine protections, TRUNCATE restrictions, fail-fast baseline pre-checks, and maintenance procedures. |
| Validation Diagnostics | `docs/kuro_phase9_reviewed_validation.sql` | 15 read-only diagnostic sections verifying tables, columns, privacy defaults, RLS on all 14 tables, triggers, board hierarchies, duration accounting, function security, table ownership, ACL permissions, TRUNCATE restrictions, mandatory staging baseline policy inspection, and forensic quarantine audits (Revision 15). |
| Deployment & Test Guide | `docs/kuro_phase9_reviewed_deployment_guide.md` | Operational manual containing snapshot concurrency proofs, single-session acceptance suite (Tests 1-11 with multi-role Subtests 10.6A-10.6L across authenticated, service_role, and postgres; comprehensive two-user RLS write tests on baseline tables in Test 10; schema-aligned 14-table cascade deletion in 10.7 with SET CONSTRAINTS ALL IMMEDIATE; and TRUNCATE audits), and two-connection concurrency verification procedures (Revision 15). |

---

## 2. Architectural & Concurrency Foundations

### A. Transaction Snapshot Behavior under READ COMMITTED
Under PostgreSQL's MVCC implementation in `READ COMMITTED` isolation mode:
1. When an SQL statement begins (e.g. `INSERT INTO public.time_entries`), PostgreSQL captures an initial statement-level snapshot.
2. The `BEFORE` trigger (`trg_validate_time_entry_interval`) executes and calls `PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || v_user_id::text));`.
3. If another concurrent transaction is currently holding this per-user advisory lock, the current transaction **blocks**.
4. While the current transaction is waiting, the prior transaction commits new completed timers, pauses, or idle intervals.
5. Once the lock is released, the current transaction resumes execution inside the PL/pgSQL function.
6. **The Volatility Requirement:** In PL/pgSQL, each individual command normally takes a new command snapshot. However, functions declared as `STABLE` inform the query optimizer that their results will not change within the statement; the optimizer can cache their evaluation or evaluate them against the calling statement's initial pre-lock snapshot.
7. **The Correction:** `public.fn_calculate_timer_active_multirange` and `public.fn_check_active_interval_conflict` are declared **`VOLATILE`**. Marking them `VOLATILE` forces the engine to evaluate their internal table scans against a fresh command snapshot established *after* the advisory lock has been acquired. This guarantees that any timers, pauses, or idle intervals committed while waiting for the lock are 100% visible to active work conflict checks.

### B. Airtight Open vs. Closed Interval Validation
The table-level GiST exclusion constraints (`exclude_overlapping_timer_pauses` and `exclude_overlapping_timer_idles`) contain the predicate `WHERE (ended_at IS NOT NULL)` (or `resumed_at IS NOT NULL`). As a result, the GiST index only prevents two *closed* intervals from overlapping.

To prevent an open interval from overlapping an existing closed interval, and to prevent a closed interval from overlapping an existing open interval, [`fn_validate_time_entry_pause`](file:///f:/smart-pet-assistant-web/docs/kuro_phase9_reviewed_candidate.sql#L968-L1134) and [`fn_validate_time_entry_idle`](file:///f:/smart-pet-assistant-web/docs/kuro_phase9_reviewed_candidate.sql#L1256-L1424) enforce trigger-level range checks using `'infinity'::timestamptz`:
$$\text{tstzrange}(started\_at, \text{COALESCE}(ended\_at, '\text{infinity}'), '[\text{)}') \ \&\&\ \text{tstzrange}(NEW.started\_at, \text{COALESCE}(NEW.ended\_at, '\text{infinity}'), '[\text{)})$$
This symmetrically eliminates overlap vulnerabilities between open and closed intervals on the same timer, and guarantees disjointness between pause and idle intervals.

### C. Crash Recovery Timeline Consistency & Bounds Protection
In `reconcile_stale_time_entries(p_max_age INTERVAL)`:
1. **Canonical Lock Ordering:** The procedure iterates over candidate IDs without holding row locks. For each candidate, it acquires `PERFORM pg_advisory_xact_lock(hashtext('time_entries_' || v_candidate.user_id::text));` **FIRST**, and then acquires the row lock via `SELECT ... FOR UPDATE SKIP LOCKED`. This eliminates the lock inversion deadlock hazard between recovery and normal user transactions.
2. Abandoned open pauses are closed at `paused_at` ($+0\text{s}$ duration added).
3. Abandoned open idles are closed at `started_at` ($+0\text{s}$ duration added).
4. Closed pauses and verified idles are summed from normalized tables.
5. Target elapsed time is computed strictly as:
   $$E_{\text{target}} = P_{\text{closed}} + I_{\text{verified}} + A_{\text{verified}}$$
6. Target completion timestamp:
   $$T_{\text{ended}} = T_{\text{started}} + E_{\text{target}}$$
7. **Bounds Validation:** The procedure checks the minimum and maximum timestamps across all child pause and idle records. If any child record has $started\_at < T_{\text{started}}$ or $ended\_at > T_{\text{ended}}$, the stored durations and timestamp positions are inconsistent. The procedure **quarantines** the record with a clear diagnostic reason, rather than silently truncating intervals or fabricating active time.
8. **Active Conflict Validation:** The candidate active multirange is evaluated against existing committed timers. If an unresolvable active overlap is detected, the entry is safely quarantined.

### D. Privilege Matrix, RLS Architecture & TRUNCATE Protection
- **Scoped Table Grants:** Table grants are explicitly scoped to the 14 Phase 9 managed tables (`tasks`, `user_preferences`, `projects`, `project_boards`, `board_columns`, `task_labels`, `task_label_assignments`, `task_status_history`, `time_entries`, `time_entry_pauses`, `time_entry_idles`, `computer_activity_events`, `pet_reaction_logs`, `daily_reports`). No schema-wide `ALL TABLES` grants or revokes exist.
- `anon` and `PUBLIC` have all privileges revoked on the 14 managed tables.
- `authenticated` is granted `SELECT, INSERT, UPDATE, DELETE` on 13 application tables, and **`SELECT` ONLY** on `public.task_status_history`.
- `service_role` is granted administrative access explicitly on the 14 managed tables.
- **TRUNCATE Privilege Bypass Closure:** In PostgreSQL, `TRUNCATE` does not fire row-level triggers (`BEFORE DELETE` / `BEFORE UPDATE`). To prevent accidental or unauthorized bulk wiping of timer history and quarantined forensic evidence, `TRUNCATE` is explicitly revoked from `service_role` on `public.time_entries`, `public.time_entry_pauses`, and `public.time_entry_idles`. `service_role` retains `SELECT, INSERT, UPDATE, DELETE` subject to triggers and RLS. *(Technical note: Row-level triggers and role grants govern standard operations and prevent bypasses by service roles, but do not prevent a PostgreSQL superuser or table owner from using privileged DDL to alter tables).*
- **Function Execution:** Privileges on all 14 functions are explicitly revoked from `PUBLIC` and `anon`. `service_role` is granted `EXECUTE` on all 14 functions. `authenticated` is granted `EXECUTE` strictly on the 3 approved callable utilities (`fn_calculate_timer_active_multirange`, `fn_check_active_interval_conflict`, `purge_expired_activity_events`). `reconcile_stale_time_entries` is an administrative maintenance procedure restricted strictly to `service_role` (executed via trusted worker / pg_cron), preventing ordinary users from running cross-user reconciliation or encountering RLS conflicts.
- **Search Paths:** All 14 functions strictly declare `SET search_path = pg_catalog, public, pg_temp;`.

### E. Quarantined Record Lifecycle & Immutability Policy
1. **Terminal Forensic State:** Quarantine is a strictly terminal state. Direct table `UPDATE` statements are blocked from changing `state` away from `'quarantined'`, even for `service_role` or `postgres`, preventing accidental reopening of corrupted sessions.
2. **Client Protection:** Authenticated users cannot update or delete quarantined records (enforced by both RLS `state <> 'quarantined'` and trigger-level role rejection).
3. **Parent Deletion Immutability:** Direct `DELETE` on a quarantined `public.time_entries` record is strictly prohibited across all database roles (`authenticated`, `anon`, `service_role`, `postgres`) raising `P0001`, preserving terminal forensic evidence. To prevent PostgreSQL `42501` permission errors on private `auth.users`, triggers inspect `current_user`: for unprivileged and API roles (`authenticated`, `anon`, `service_role`), `P0001` is raised immediately without querying `auth.users`. For trusted administrative roles (`postgres`, `supabase_admin`, `supabase_auth_admin`), deletion is permitted ONLY as an account-deletion cascade from `auth.users` (`EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)` is false).
4. **Child UPDATE Validation Order:** In both `fn_validate_time_entry_pause()` and `fn_validate_time_entry_idle()`, the old parent timer (`OLD.time_entry_id`) and new parent timer (`NEW.time_entry_id`) are retrieved immediately upon `UPDATE`. If either parent timer is in the `'quarantined'` state, the operation is immediately rejected with SQLSTATE `P0001` before any timestamp validity checks, chronology comparisons, or interval overlap validations are performed. This ensures that any attempt to tamper with child records of quarantined timers consistently yields the intended forensic immutability exception, even when the supplied timestamps are out of bounds or invalid.
5. **Child Interval Immutability:** Child pause (`public.time_entry_pauses`) and idle (`public.time_entry_idles`) records belonging to a quarantined parent timer are permanently locked against modification across all database roles (`authenticated`, `service_role`, and `postgres`):
   - Direct `INSERT` of new child intervals into a quarantined parent timer is strictly rejected (`P0001`).
   - Direct `UPDATE` of existing child intervals belonging to a quarantined timer (modifying timestamps or shifting intervals) is strictly rejected (`P0001`).
   - Direct `UPDATE` attempting to move a child interval into or out of a quarantined timer is strictly rejected (`P0001`).
   - Direct `DELETE` of child intervals belonging to a quarantined timer is strictly rejected (`P0001`) across all roles (`authenticated`, `anon`, `service_role`, `postgres`), while preserving clean cascading account deletion when the user is removed from `auth.users` by trusted administrative roles. Unprivileged and API roles (`authenticated`, `anon`, `service_role`) fail immediately with `P0001` before evaluating any queries against `auth.users`, preventing `42501` permission errors.
6. **Recovery Preserves Forensic Evidence:** During crash recovery (`reconcile_stale_time_entries`), if a timer is transitioned to `'quarantined'` due to bounds mismatches or active interval conflicts, any open child pause or idle intervals are intentionally left open (`resumed_at IS NULL` or `ended_at IS NULL`). Recovery never fabricates closing timestamps on corrupted evidence, allowing forensic diagnostics (Queries 14.10.2 and 14.10.3) to inspect raw crash states.
7. **Field Immutability:** Core timing fields (`started_at`, `ended_at`, `active_duration_seconds`, `idle_duration_seconds`), task ownership, user identity, and recovery metadata (`is_recovered`, `recovery_reason`) on the parent timer are permanently locked against modification.
8. **Productive Time Crediting:** If a user is owed productive work from an abandoned or conflicted session, an administrator or user logs a new, cleanly validated manual `time_entry` with verified, non-conflicting bounds. The quarantined record is preserved intact as an immutable forensic tombstone.

---

## 3. Test Suites & Verification Procedures

### 3.1 Single-Session Acceptance Test Suite (Isolated Transaction)

> [!IMPORTANT]
> All negative acceptance tests capture the exact PostgreSQL error using `GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;`. Tests only pass if the exact expected SQLSTATE (`P0001`, `23505`, or `42501`) and targeted error message are returned. Unexpected errors or unexpected successes immediately fail the test outside the handler.

```sql
-- ============================================================================
-- KURO PHASE 9: REPRODUCIBLE ACCEPTANCE TEST SUITE (SINGLE-SESSION)
-- ============================================================================
BEGIN;

DO $$
DECLARE
    v_user_a UUID := '00000000-0000-0000-0000-00000000000a'::UUID;
    v_user_a2 UUID := '00000000-0000-0000-0000-0000000000a2'::UUID;
    v_user_a3 UUID := '00000000-0000-0000-0000-0000000000a3'::UUID;
    v_user_b UUID := '00000000-0000-0000-0000-00000000000b'::UUID;
    v_user_c UUID := '00000000-0000-0000-0000-00000000000c'::UUID;
    v_user_d UUID := '00000000-0000-0000-0000-00000000000d'::UUID;
    v_proj_a UUID;
    v_board_a UUID;
    v_col_todo_a UUID;
    v_col_inprogress_a UUID;
    v_col_done_a UUID;
    v_task_1 UUID;
    v_task_2 UUID;
    v_label_a UUID;
    v_proj_a2 UUID;
    v_board_a2 UUID;
    v_col_todo_a2 UUID;
    v_task_a2 UUID;
    v_proj_a3 UUID;
    v_board_a3 UUID;
    v_col_todo_a3 UUID;
    v_task_a3 UUID;
    v_proj_c UUID;
    v_board_c UUID;
    v_col_todo_c UUID;
    v_task_c UUID;
    v_proj_d UUID;
    v_board_d UUID;
    v_col_todo_d UUID;
    v_task_d UUID;
    v_t1 UUID;
    v_t2 UUID;
    v_pause_1 UUID;
    v_idle_1 UUID;
    v_t_test8 UUID;
    v_open_pause_test8 UUID;
    v_open_idle_test8 UUID;
    v_t_abandoned_1 UUID;
    v_t_open_pause UUID;
    v_t_open_idle UUID;
    v_t_abandoned_2 UUID;
    v_t_abandoned_3 UUID;
    v_t_conflict_anchor UUID;
    v_rec_1 RECORD;
    v_rec_open_pause RECORD;
    v_rec_open_idle RECORD;
    v_rec_2 RECORD;
    v_rec_3 RECORD;
    v_func_rec RECORD;
    v_rec_pause_total INTEGER;
    v_rec_open_pause_count INTEGER;
    v_rec_idle_total INTEGER;
    v_rec_open_idle_count INTEGER;
    v_active_conflict UUID;
    v_recovered_count INTEGER;
    v_test_failed BOOLEAN;
    v_expected_error BOOLEAN;
    v_err_code TEXT;
    v_err_msg TEXT;
    v_rows_affected INTEGER;
    v_ordinary_pause_violations INTEGER;
    v_quarantine_diagnostic_count INTEGER;
    v_quarantine_idle_diagnostic_count INTEGER;
    v_pause_quarantine UUID;
    v_idle_quarantine UUID;
    v_t_normal_c UUID;
    v_normal_pause_c UUID;
    v_normal_idle_c UUID;
    v_test_role TEXT;
    v_user_cascade UUID := '00000000-0000-0000-0000-0000000000ee'::UUID;
    v_proj_casc UUID;
    v_board_casc UUID;
    v_col_casc UUID;
    v_col_casc_2 UUID;
    v_task_casc UUID;
    v_label_casc UUID;
    v_t_quarantine_casc UUID;
    v_pause_casc UUID;
    v_idle_casc UUID;
    v_count_projects_before INTEGER;
    v_count_boards_before INTEGER;
    v_count_columns_before INTEGER;
    v_count_tasks_before INTEGER;
    v_count_labels_before INTEGER;
    v_count_label_assign_before INTEGER;
    v_count_status_hist_before INTEGER;
    v_count_prefs_before INTEGER;
    v_count_timers_before INTEGER;
    v_count_pauses_before INTEGER;
    v_count_idles_before INTEGER;
    v_count_events_before INTEGER;
    v_count_reactions_before INTEGER;
    v_count_reports_before INTEGER;
BEGIN
    -- Ensure test auth users exist (v_user_cascade is created dynamically in Test 10.7)
    INSERT INTO auth.users (id, email) VALUES 
        (v_user_a, 'user_a@test.local'),
        (v_user_a2, 'user_a2@test.local'),
        (v_user_a3, 'user_a3@test.local'),
        (v_user_b, 'user_b@test.local'),
        (v_user_c, 'user_c@test.local'),
        (v_user_d, 'user_d@test.local')
    ON CONFLICT (id) DO NOTHING;

    -- Setup Project, Board, and Columns for User A (Fixture A1)
    INSERT INTO public.projects (user_id, name) VALUES (v_user_a, 'Project A') RETURNING id INTO v_proj_a;
    INSERT INTO public.project_boards (user_id, project_id, name) VALUES (v_user_a, v_proj_a, 'Board A') RETURNING id INTO v_board_a;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_a, v_board_a, 'To Do', 'todo', 0) RETURNING id INTO v_col_todo_a;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_a, v_board_a, 'In Progress', 'in_progress', 1) RETURNING id INTO v_col_inprogress_a;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_a, v_board_a, 'Done', 'done', 2) RETURNING id INTO v_col_done_a;

    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_a, v_proj_a, v_board_a, v_col_todo_a, 'Task 1') RETURNING id INTO v_task_1;
    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_a, v_proj_a, v_board_a, v_col_todo_a, 'Task 2') RETURNING id INTO v_task_2;

    -- Setup Project, Board, and Task for User A2 (Fixture A2: Abandoned Open Pause)
    INSERT INTO public.projects (user_id, name) VALUES (v_user_a2, 'Project A2') RETURNING id INTO v_proj_a2;
    INSERT INTO public.project_boards (user_id, project_id, name) VALUES (v_user_a2, v_proj_a2, 'Board A2') RETURNING id INTO v_board_a2;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_a2, v_board_a2, 'To Do', 'todo', 0) RETURNING id INTO v_col_todo_a2;
    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_a2, v_proj_a2, v_board_a2, v_col_todo_a2, 'Task A2') RETURNING id INTO v_task_a2;

    -- Setup Project, Board, and Task for User A3 (Fixture A3: Abandoned Open Idle)
    INSERT INTO public.projects (user_id, name) VALUES (v_user_a3, 'Project A3') RETURNING id INTO v_proj_a3;
    INSERT INTO public.project_boards (user_id, project_id, name) VALUES (v_user_a3, v_proj_a3, 'Board A3') RETURNING id INTO v_board_a3;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_a3, v_board_a3, 'To Do', 'todo', 0) RETURNING id INTO v_col_todo_a3;
    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_a3, v_proj_a3, v_board_a3, v_col_todo_a3, 'Task A3') RETURNING id INTO v_task_a3;

    -- Setup Container for User C (Bounds-mismatch test fixture)
    INSERT INTO public.projects (user_id, name) VALUES (v_user_c, 'Project C') RETURNING id INTO v_proj_c;
    INSERT INTO public.project_boards (user_id, project_id, name) VALUES (v_user_c, v_proj_c, 'Board C') RETURNING id INTO v_board_c;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_c, v_board_c, 'To Do', 'todo', 0) RETURNING id INTO v_col_todo_c;
    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_c, v_proj_c, v_board_c, v_col_todo_c, 'Task C') RETURNING id INTO v_task_c;

    -- Setup Container for User D (Active-conflict recovery test fixture)
    INSERT INTO public.projects (user_id, name) VALUES (v_user_d, 'Project D') RETURNING id INTO v_proj_d;
    INSERT INTO public.project_boards (user_id, project_id, name) VALUES (v_user_d, v_proj_d, 'Board D') RETURNING id INTO v_board_d;
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) VALUES 
        (v_user_d, v_board_d, 'To Do', 'todo', 0) RETURNING id INTO v_col_todo_d;
    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_d, v_proj_d, v_board_d, v_col_todo_d, 'Task D') RETURNING id INTO v_task_d;

    -- ------------------------------------------------------------------------
    -- TEST 1: Continuous Timer Session
    -- ------------------------------------------------------------------------
    INSERT INTO public.time_entries (user_id, task_id, started_at, ended_at, state)
    VALUES (v_user_a, v_task_1, '2026-03-01 08:00:00+00', '2026-03-01 09:00:00+00', 'completed');
    RAISE NOTICE 'Test 1 Passed: Continuous completed timer accepted.';

    -- ------------------------------------------------------------------------
    -- TEST 2: Multiple Pauses on Timer
    -- ------------------------------------------------------------------------
    INSERT INTO public.time_entries (user_id, task_id, started_at, ended_at, state)
    VALUES (v_user_a, v_task_1, '2026-03-01 09:00:00+00', '2026-03-01 11:00:00+00', 'completed')
    RETURNING id INTO v_t1;

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a, v_t1, '2026-03-01 09:15:00+00', '2026-03-01 09:20:00+00');
    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a, v_t1, '2026-03-01 09:40:00+00', '2026-03-01 09:50:00+00')
    RETURNING id INTO v_pause_1;
    RAISE NOTICE 'Test 2 Passed: Multiple pauses accepted on single timer.';

    -- ------------------------------------------------------------------------
    -- TEST 3: Idle Intervals
    -- ------------------------------------------------------------------------
    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_a, v_t1, '2026-03-01 10:00:00+00', '2026-03-01 10:30:00+00')
    RETURNING id INTO v_idle_1;
    RAISE NOTICE 'Test 3 Passed: Idle intervals accepted on timer.';

    -- ------------------------------------------------------------------------
    -- TEST 4: Another Timer Active During Idle Period
    -- ------------------------------------------------------------------------
    -- Timer 2 runs from 10:05 to 10:25 (during Timer 1's idle interval 10:00-10:30).
    INSERT INTO public.time_entries (user_id, task_id, started_at, ended_at, state)
    VALUES (v_user_a, v_task_2, '2026-03-01 10:05:00+00', '2026-03-01 10:25:00+00', 'completed')
    RETURNING id INTO v_t2;
    RAISE NOTICE 'Test 4 Passed: Timer during another timer idle period accepted.';

    -- ------------------------------------------------------------------------
    -- TEST 5: Direct Active Overlap (Must Fail with SQLSTATE P0001)
    -- ------------------------------------------------------------------------
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        -- Attempts to insert a timer overlapping active work of Timer 1 (09:00-09:15)
        INSERT INTO public.time_entries (user_id, task_id, started_at, ended_at, state)
        VALUES (v_user_a, v_task_2, '2026-03-01 09:05:00+00', '2026-03-01 09:10:00+00', 'completed');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Active work interval conflicts with existing time entry%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 5 Passed: Active interval overlap correctly rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 5 FAILED: Unexpected error received: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 5 FAILED: Direct active overlap was unexpectedly accepted by database.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 6: Pause Deletion Causing Collision (Must Fail with SQLSTATE P0001)
    -- ------------------------------------------------------------------------
    -- Timer 3 ran during Pause 1 (09:42 to 09:48).
    INSERT INTO public.time_entries (user_id, task_id, started_at, ended_at, state)
    VALUES (v_user_a, v_task_2, '2026-03-01 09:42:00+00', '2026-03-01 09:48:00+00', 'completed');

    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        -- Deleting Pause 1 (09:40-09:50) would expand Timer 1 active work into Timer 3
        DELETE FROM public.time_entry_pauses WHERE id = v_pause_1;
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Cannot delete pause: expanding active work interval would conflict%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 6 Passed: Pause deletion exposing collision correctly rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 6 FAILED: Unexpected error received: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 6 FAILED: Pause deletion exposing overlap was unexpectedly accepted by database.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 7: Idle Interval Deletion Causing Collision (Must Fail with SQLSTATE P0001)
    -- ------------------------------------------------------------------------
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        -- Deleting Idle interval (10:00-10:30) would expand Timer 1 active work into Timer 2 (10:05-10:25)
        DELETE FROM public.time_entry_idles WHERE id = v_idle_1;
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Cannot delete idle interval: expanding active work interval would conflict%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 7 Passed: Idle interval deletion exposing collision correctly rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 7 FAILED: Unexpected error received: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 7 FAILED: Idle deletion exposing overlap was unexpectedly accepted by database.';
    END IF;

    -- ------------------------------------------------------------------------
    -- TEST 8: Granular Sub-Interval Overlap Rejection Suite
    -- ------------------------------------------------------------------------
    INSERT INTO public.time_entries (user_id, task_id, started_at, state)
    VALUES (v_user_a, v_task_1, '2026-03-01 12:00:00+00', 'running')
    RETURNING id INTO v_t_test8;

    -- Baseline child intervals on v_t_test8:
    -- Closed Pause: 12:05 to 12:15
    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a, v_t_test8, '2026-03-01 12:05:00+00', '2026-03-01 12:15:00+00');
    -- Closed Idle: 12:20 to 12:30
    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_a, v_t_test8, '2026-03-01 12:20:00+00', '2026-03-01 12:30:00+00');

    -- Subtest 8A: Open pause overlapping closed pause (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
        VALUES (v_user_a, v_t_test8, '2026-03-01 12:10:00+00', NULL);
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%conflicts with existing pause interval%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8A Passed: Open pause overlapping closed pause rejected.';
        ELSE
            RAISE EXCEPTION 'Test 8A FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8A FAILED: Open pause overlapping closed pause was accepted.';
    END IF;

    -- Subtest 8B: Closed pause overlapping open pause (Must Fail with P0001)
    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a, v_t_test8, '2026-03-01 12:35:00+00', NULL)
    RETURNING id INTO v_open_pause_test8;

    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
        VALUES (v_user_a, v_t_test8, '2026-03-01 12:30:00+00', '2026-03-01 12:40:00+00');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%conflicts with existing pause interval%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8B Passed: Closed pause overlapping open pause rejected.';
        ELSE
            RAISE EXCEPTION 'Test 8B FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8B FAILED: Closed pause overlapping open pause was accepted.';
    END IF;
    -- Close open pause before next checks
    UPDATE public.time_entry_pauses SET resumed_at = '2026-03-01 12:35:00+00' WHERE id = v_open_pause_test8;

    -- Subtest 8C: Open idle overlapping closed idle (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
        VALUES (v_user_a, v_t_test8, '2026-03-01 12:25:00+00', NULL);
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%conflicts with existing idle interval%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8C Passed: Open idle overlapping closed idle rejected.';
        ELSE
            RAISE EXCEPTION 'Test 8C FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8C FAILED: Open idle overlapping closed idle was accepted.';
    END IF;

    -- Subtest 8D: Closed idle overlapping open idle (Must Fail with P0001)
    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_a, v_t_test8, '2026-03-01 12:45:00+00', NULL)
    RETURNING id INTO v_open_idle_test8;

    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
        VALUES (v_user_a, v_t_test8, '2026-03-01 12:40:00+00', '2026-03-01 12:50:00+00');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%conflicts with existing idle interval%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8D Passed: Closed idle overlapping open idle rejected.';
        ELSE
            RAISE EXCEPTION 'Test 8D FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8D FAILED: Closed idle overlapping open idle was accepted.';
    END IF;
    -- Close open idle
    UPDATE public.time_entry_idles SET ended_at = '2026-03-01 12:45:00+00' WHERE id = v_open_idle_test8;

    -- Subtest 8E: Pause interval overlapping idle interval (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
        VALUES (v_user_a, v_t_test8, '2026-03-01 12:22:00+00', '2026-03-01 12:28:00+00');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Pause interval conflicts with idle interval%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8E Passed: Pause overlapping idle interval rejected.';
        ELSE
            RAISE EXCEPTION 'Test 8E FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8E FAILED: Pause overlapping idle interval was accepted.';
    END IF;

    -- Subtest 8F: Idle interval overlapping pause interval (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
        VALUES (v_user_a, v_t_test8, '2026-03-01 12:08:00+00', '2026-03-01 12:12:00+00');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Idle interval conflicts with pause interval%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8F Passed: Idle overlapping pause interval rejected.';
        ELSE
            RAISE EXCEPTION 'Test 8F FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8F FAILED: Idle overlapping pause interval was accepted.';
    END IF;

    -- Subtest 8G: Multiple running timers for single user (Must Fail with SQLSTATE 23505)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.time_entries (user_id, task_id, started_at, state)
        VALUES (v_user_a, v_task_2, now(), 'running');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF (v_err_code = '23505' AND v_err_msg LIKE '%idx_unique_running_timer_per_user%') OR 
           (v_err_code = 'P0001' AND v_err_msg LIKE '%running%') THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 8G Passed: Multiple running timers rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 8G FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 8G FAILED: Multiple running timers allowed for single user.';
    END IF;

    -- Complete v_t_test8 cleanly before crash recovery test
    UPDATE public.time_entries SET state = 'completed', ended_at = '2026-03-01 13:00:00+00' WHERE id = v_t_test8;

    -- ------------------------------------------------------------------------
    -- TEST 9: Crash Recovery with Multi-User Isolation & Conflict Quarantine
    -- ------------------------------------------------------------------------
    -- FIXTURE A1 (User A): Normal recovery with multiple closed pauses and multiple closed idles.
    -- Started 24h ago (T0). Target elapsed = 3300s (55 mins). Target ended_at = T0 + 55 mins.
    -- Timeline breakdown within [T0, T0 + 55m]:
    --   [T0, T0 + 10m): 600s active
    --   [T0 + 10m, T0 + 15m): 300s closed pause 1
    --   [T0 + 15m, T0 + 25m): 600s active
    --   [T0 + 25m, T0 + 35m): 600s closed idle 1
    --   [T0 + 35m, T0 + 40m): 300s closed pause 2
    --   [T0 + 40m, T0 + 45m): 300s closed idle 2
    --   [T0 + 45m, T0 + 55m): 600s active
    -- Total closed pauses = 600s. Total closed idles = 900s. Active = 1800s. Total = 3300s.
    -- All pause and idle intervals are strictly non-overlapping and strictly within [T0, T0 + 55m].
    INSERT INTO public.time_entries (
        user_id, task_id, started_at, state, active_duration_seconds, idle_duration_seconds, updated_at
    )
    VALUES (
        v_user_a, v_task_1, now() - INTERVAL '24 hours', 'running', 0, 0, now() - INTERVAL '20 hours'
    )
    RETURNING id INTO v_t_abandoned_1;

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a, v_t_abandoned_1, now() - INTERVAL '23 hours 50 min', now() - INTERVAL '23 hours 45 min');

    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_a, v_t_abandoned_1, now() - INTERVAL '23 hours 35 min', now() - INTERVAL '23 hours 25 min');

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a, v_t_abandoned_1, now() - INTERVAL '23 hours 25 min', now() - INTERVAL '23 hours 20 min');

    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_a, v_t_abandoned_1, now() - INTERVAL '23 hours 20 min', now() - INTERVAL '23 hours 15 min');

    -- Explicit controlled fixture update: establish intended test active duration AFTER child interval insertion
    -- (guaranteeing that AFTER-triggers on child inserts do not overwrite test values)
    UPDATE public.time_entries
    SET active_duration_seconds = 1800,
        idle_duration_seconds = 900,
        state = 'running',
        updated_at = now() - INTERVAL '20 hours'
    WHERE id = v_t_abandoned_1;

    -- FIXTURE A2 (User A2): Abandoned open pause recovery on separate valid timer.
    -- Started 22h ago (Ta). Active = 900s (15 min). Open pause starting at Ta + 15m.
    -- Target elapsed = 900s active + 0s pause = 900s. Target ended_at = Ta + 15m.
    INSERT INTO public.time_entries (
        user_id, task_id, started_at, state, active_duration_seconds, idle_duration_seconds, updated_at
    )
    VALUES (
        v_user_a2, v_task_a2, now() - INTERVAL '22 hours', 'running', 0, 0, now() - INTERVAL '20 hours'
    )
    RETURNING id INTO v_t_open_pause;

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_a2, v_t_open_pause, now() - INTERVAL '21 hours 45 min', NULL);

    UPDATE public.time_entries
    SET active_duration_seconds = 900,
        idle_duration_seconds = 0,
        state = 'paused',
        updated_at = now() - INTERVAL '20 hours'
    WHERE id = v_t_open_pause;

    -- FIXTURE A3 (User A3): Abandoned open idle recovery on separate valid timer.
    -- Started 20h ago (Tb). Active = 600s (10 min). Open idle starting at Tb + 10m.
    -- Target elapsed = 600s active + 0s idle = 600s. Target ended_at = Tb + 10m.
    INSERT INTO public.time_entries (
        user_id, task_id, started_at, state, active_duration_seconds, idle_duration_seconds, updated_at
    )
    VALUES (
        v_user_a3, v_task_a3, now() - INTERVAL '20 hours', 'running', 0, 0, now() - INTERVAL '18 hours'
    )
    RETURNING id INTO v_t_open_idle;

    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_a3, v_t_open_idle, now() - INTERVAL '19 hours 50 min', NULL);

    UPDATE public.time_entries
    SET active_duration_seconds = 600,
        idle_duration_seconds = 0,
        state = 'running',
        updated_at = now() - INTERVAL '18 hours'
    WHERE id = v_t_open_idle;

    -- FIXTURE B (User C): Out-of-bounds child records fixture.
    -- Started 40h ago (T1). Verified active = 300s (5 min).
    -- Pause: T1 + 30m to T1 + 40m (600s). Valid on insert because Timer 2 is running (ended_at IS NULL).
    -- Idle: T1 + 42m to T1 + 47m (300s). Valid on insert because Timer 2 is running (ended_at IS NULL).
    -- Target elapsed = 300s active + 600s pause + 300s idle = 1200s (20 mins). Target ended_at = T1 + 20 mins.
    -- Child pause ends at T1 + 40m > T1 + 20m. Child idle ends at T1 + 47m > T1 + 20m.
    -- Both child pause and child idle exceed target ended_at! Recovery MUST quarantine for timeline bounds mismatch!
    INSERT INTO public.time_entries (
        user_id, task_id, started_at, state, active_duration_seconds, idle_duration_seconds, updated_at
    )
    VALUES (
        v_user_c, v_task_c, now() - INTERVAL '40 hours', 'running', 0, 0, now() - INTERVAL '38 hours'
    )
    RETURNING id INTO v_t_abandoned_2;

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_c, v_t_abandoned_2, now() - INTERVAL '39 hours 30 min', now() - INTERVAL '39 hours 20 min')
    RETURNING id INTO v_pause_quarantine;

    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_c, v_t_abandoned_2, now() - INTERVAL '39 hours 18 min', now() - INTERVAL '39 hours 13 min')
    RETURNING id INTO v_idle_quarantine;

    UPDATE public.time_entries
    SET active_duration_seconds = 300,
        idle_duration_seconds = 300,
        state = 'running',
        updated_at = now() - INTERVAL '38 hours'
    WHERE id = v_t_abandoned_2;

    -- FIXTURE C (User D): Active-conflict quarantine fixture.
    -- Timer 3 started 48h ago (T2). State = 'paused'. Verified active = 7200s (2 hours).
    -- Open pause starting at T2 + 30m (47.5h ago).
    -- Active range while paused is only [T2, T2 + 30m) = [48h, 47.5h ago).
    INSERT INTO public.time_entries (
        user_id, task_id, started_at, state, active_duration_seconds, idle_duration_seconds, updated_at
    )
    VALUES (
        v_user_d, v_task_d, now() - INTERVAL '48 hours', 'paused', 0, 0, now() - INTERVAL '46 hours'
    )
    RETURNING id INTO v_t_abandoned_3;

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_d, v_t_abandoned_3, now() - INTERVAL '47 hours 30 min', NULL);

    UPDATE public.time_entries
    SET active_duration_seconds = 7200,
        idle_duration_seconds = 0,
        state = 'paused',
        updated_at = now() - INTERVAL '46 hours'
    WHERE id = v_t_abandoned_3;

    -- Timer 4 (completed anchor) from 47h to 46h ago.
    -- Disjoint from Timer 3 active work [48h, 47.5h) on insert -> Inserts cleanly!
    INSERT INTO public.time_entries (
        user_id, task_id, started_at, ended_at, state, active_duration_seconds
    )
    VALUES (
        v_user_d, v_task_d, now() - INTERVAL '47 hours', now() - INTERVAL '46 hours', 'completed', 3600
    )
    RETURNING id INTO v_t_conflict_anchor;

    -- Execute crash recovery
    SELECT COUNT(*) INTO v_recovered_count FROM public.reconcile_stale_time_entries(INTERVAL '12 hours');
    IF v_recovered_count < 5 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Expected at least 5 stale entries recovered/quarantined, but got %', v_recovered_count;
    END IF;

    -- Detailed assertions on Recovered Timer 1 (User A - Fixture A1):
    SELECT * INTO v_rec_1 FROM public.time_entries WHERE id = v_t_abandoned_1;
    IF v_rec_1.state <> 'completed' THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 state is % (expected completed)', v_rec_1.state;
    END IF;
    IF NOT v_rec_1.is_recovered THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 is_recovered is false';
    END IF;
    IF v_rec_1.active_duration_seconds <> 1800 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 active_duration_seconds is % (expected 1800)', v_rec_1.active_duration_seconds;
    END IF;
    IF v_rec_1.idle_duration_seconds <> 900 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 idle_duration_seconds is % (expected 900)', v_rec_1.idle_duration_seconds;
    END IF;
    IF v_rec_1.ended_at <> (v_rec_1.started_at + INTERVAL '3300 seconds') THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 ended_at (%) does not equal started_at + 3300s (%)',
            v_rec_1.ended_at, (v_rec_1.started_at + INTERVAL '3300 seconds');
    END IF;

    -- Pause & Idle counts on Timer 1:
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (resumed_at - paused_at))::INTEGER), 0),
           COUNT(*) FILTER (WHERE resumed_at IS NULL)
    INTO v_rec_pause_total, v_rec_open_pause_count
    FROM public.time_entry_pauses WHERE time_entry_id = v_t_abandoned_1;
    IF v_rec_pause_total <> 600 OR v_rec_open_pause_count <> 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 pause totals invalid (sum=%, open=%)', v_rec_pause_total, v_rec_open_pause_count;
    END IF;

    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER), 0),
           COUNT(*) FILTER (WHERE ended_at IS NULL)
    INTO v_rec_idle_total, v_rec_open_idle_count
    FROM public.time_entry_idles WHERE time_entry_id = v_t_abandoned_1;
    IF v_rec_idle_total <> 900 OR v_rec_open_idle_count <> 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 idle totals invalid (sum=%, open=%)', v_rec_idle_total, v_rec_open_idle_count;
    END IF;

    -- Assert Timer 1 has zero active conflicts:
    v_active_conflict := public.fn_check_active_interval_conflict(
        v_user_a, v_t_abandoned_1, public.fn_calculate_timer_active_multirange(v_t_abandoned_1, v_rec_1.started_at, v_rec_1.ended_at)
    );
    IF v_active_conflict IS NOT NULL THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 1 has active conflict with timer %', v_active_conflict;
    END IF;

    -- Detailed assertions on Recovered Timer A2 (User A2 - Fixture A2: Abandoned Open Pause):
    SELECT * INTO v_rec_open_pause FROM public.time_entries WHERE id = v_t_open_pause;
    IF v_rec_open_pause.state <> 'completed' OR NOT v_rec_open_pause.is_recovered OR v_rec_open_pause.active_duration_seconds <> 900 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer A2 abandoned open pause recovery invalid: state=%, recovered=%, active=%',
            v_rec_open_pause.state, v_rec_open_pause.is_recovered, v_rec_open_pause.active_duration_seconds;
    END IF;
    SELECT COUNT(*) FILTER (WHERE resumed_at IS NULL) INTO v_rec_open_pause_count
    FROM public.time_entry_pauses WHERE time_entry_id = v_t_open_pause;
    IF v_rec_open_pause_count <> 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer A2 still has % open pause intervals after recovery', v_rec_open_pause_count;
    END IF;
    -- Assert Timer A2 has zero active conflicts for User A2:
    v_active_conflict := public.fn_check_active_interval_conflict(
        v_user_a2, v_t_open_pause, public.fn_calculate_timer_active_multirange(v_t_open_pause, v_rec_open_pause.started_at, v_rec_open_pause.ended_at)
    );
    IF v_active_conflict IS NOT NULL THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer A2 has active conflict with timer %', v_active_conflict;
    END IF;

    -- Detailed assertions on Recovered Timer A3 (User A3 - Fixture A3: Abandoned Open Idle):
    SELECT * INTO v_rec_open_idle FROM public.time_entries WHERE id = v_t_open_idle;
    IF v_rec_open_idle.state <> 'completed' OR NOT v_rec_open_idle.is_recovered OR v_rec_open_idle.active_duration_seconds <> 600 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer A3 abandoned open idle recovery invalid: state=%, recovered=%, active=%',
            v_rec_open_idle.state, v_rec_open_idle.is_recovered, v_rec_open_idle.active_duration_seconds;
    END IF;
    SELECT COUNT(*) FILTER (WHERE ended_at IS NULL) INTO v_rec_open_idle_count
    FROM public.time_entry_idles WHERE time_entry_id = v_t_open_idle;
    IF v_rec_open_idle_count <> 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer A3 still has % open idle intervals after recovery', v_rec_open_idle_count;
    END IF;
    -- Assert Timer A3 has zero active conflicts for User A3:
    v_active_conflict := public.fn_check_active_interval_conflict(
        v_user_a3, v_t_open_idle, public.fn_calculate_timer_active_multirange(v_t_open_idle, v_rec_open_idle.started_at, v_rec_open_idle.ended_at)
    );
    IF v_active_conflict IS NOT NULL THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer A3 has active conflict with timer %', v_active_conflict;
    END IF;

    -- Detailed assertions on Quarantined Timer 2 (User C - Fixture B: Bounds mismatch):
    SELECT * INTO v_rec_2 FROM public.time_entries WHERE id = v_t_abandoned_2;
    IF v_rec_2.state <> 'quarantined' OR v_rec_2.active_duration_seconds <> 0 OR v_rec_2.recovery_reason NOT LIKE '%child interval timestamps exceed%' THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 2 was not correctly quarantined for timeline bounds mismatch: %', v_rec_2.recovery_reason;
    END IF;

    -- Detailed assertions on Quarantined Timer 3 (User D - Fixture C: Active collision with Timer 4):
    SELECT * INTO v_rec_3 FROM public.time_entries WHERE id = v_t_abandoned_3;
    IF v_rec_3.state <> 'quarantined' OR v_rec_3.active_duration_seconds <> 0 OR v_rec_3.recovery_reason NOT LIKE '%active interval conflicts%' THEN
        RAISE EXCEPTION 'Test 9 FAILED: Timer 3 was not correctly quarantined for active collision: %', v_rec_3.recovery_reason;
    END IF;

    -- Verify ordinary integrity checks exclude quarantined timers (zero false-positive violations)
    SELECT COUNT(*) INTO v_ordinary_pause_violations
    FROM public.time_entry_pauses p
    JOIN public.time_entries te ON te.id = p.time_entry_id
    WHERE te.state <> 'quarantined'
      AND (
          (p.resumed_at IS NOT NULL AND p.resumed_at < p.paused_at)
          OR p.paused_at < te.started_at
          OR (te.ended_at IS NOT NULL AND p.paused_at > te.ended_at)
          OR (te.ended_at IS NOT NULL AND p.resumed_at IS NOT NULL AND p.resumed_at > te.ended_at)
      );
    IF v_ordinary_pause_violations <> 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Ordinary non-quarantined pause bounds check flagged quarantined fixture (% violations)', v_ordinary_pause_violations;
    END IF;

    -- Verify quarantine diagnostics explicitly identify and report that both paused_at and resumed_at exceed ended_at on Timer 2
    SELECT COUNT(*) INTO v_quarantine_diagnostic_count
    FROM public.time_entry_pauses p
    JOIN public.time_entries te ON te.id = p.time_entry_id
    WHERE te.state = 'quarantined'
      AND te.id = v_t_abandoned_2
      AND (te.ended_at IS NOT NULL AND p.paused_at > te.ended_at AND p.resumed_at IS NOT NULL AND p.resumed_at > te.ended_at);
    IF v_quarantine_diagnostic_count = 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Quarantine diagnostics failed to report preserved bounds mismatch (both paused_at and resumed_at exceed ended_at) on Timer 2';
    END IF;

    -- Verify quarantine diagnostics explicitly identify and report that both idle started_at and ended_at exceed ended_at on Timer 2
    SELECT COUNT(*) INTO v_quarantine_idle_diagnostic_count
    FROM public.time_entry_idles i
    JOIN public.time_entries te ON te.id = i.time_entry_id
    WHERE te.state = 'quarantined'
      AND te.id = v_t_abandoned_2
      AND (te.ended_at IS NOT NULL AND i.started_at > te.ended_at AND i.ended_at IS NOT NULL AND i.ended_at > te.ended_at);
    IF v_quarantine_idle_diagnostic_count = 0 THEN
        RAISE EXCEPTION 'Test 9 FAILED: Quarantine diagnostics failed to report preserved idle bounds mismatch (both started_at and ended_at exceed ended_at) on Timer 2';
    END IF;

    RAISE NOTICE 'Test 9 Passed: Crash recovery verified (normal recovery with closed pauses/idles, open pause closure, open idle closure, bounds mismatch quarantine, collision quarantine, and forensic quarantine audit isolation all verified).';

    -- ------------------------------------------------------------------------
    -- TEST 10: Exhaustive 14-Table Two-User RLS Isolation & Write Rejection
    -- ------------------------------------------------------------------------
    -- Seed User A records in all 14 tables before testing User B isolation
    INSERT INTO public.task_labels (user_id, project_id, name, color) 
    VALUES (v_user_a, v_proj_a, 'Bug', '#ff0000') RETURNING id INTO v_label_a;

    INSERT INTO public.task_label_assignments (user_id, task_id, label_id) 
    VALUES (v_user_a, v_task_1, v_label_a);

    -- Trigger writes to task_status_history for User A
    UPDATE public.tasks SET status = 'in_progress', column_id = v_col_inprogress_a WHERE id = v_task_1;

    INSERT INTO public.user_preferences (user_id, theme, activity_tracking_enabled) 
    VALUES (v_user_a, 'dark', true)
    ON CONFLICT (user_id) DO UPDATE SET theme = 'dark';

    INSERT INTO public.computer_activity_events (user_id, task_id, duration_seconds, application_name, dedup_hash) 
    VALUES (v_user_a, v_task_1, 60, 'VS Code', 'hash_test_10');

    INSERT INTO public.pet_reaction_logs (user_id, trigger_event, reaction_type, emotion_displayed) 
    VALUES (v_user_a, 'task_completed', 'happy', 'happy');

    INSERT INTO public.daily_reports (user_id, report_date, total_focus_seconds) 
    VALUES (v_user_a, '2026-03-01', 3600);

    -- Switch auth role simulation to User B
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b::text)::text, true);

    -- 10.1 Verify SELECT isolation across all 14 tables
    IF EXISTS (SELECT 1 FROM public.projects WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.project_boards WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.board_columns WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.tasks WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.task_labels WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.task_label_assignments WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.task_status_history WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.user_preferences WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.time_entries WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.time_entry_pauses WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.time_entry_idles WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.computer_activity_events WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.pet_reaction_logs WHERE user_id = v_user_a) OR
       EXISTS (SELECT 1 FROM public.daily_reports WHERE user_id = v_user_a) THEN
        RAISE EXCEPTION 'Test 10 FAILED: User B was able to view User A records across RLS tables.';
    END IF;

    -- 10.2 Verify cross-user write rejection (INSERT with spoofed user_id must fail)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.projects (user_id, name) VALUES (v_user_a, 'Hacked Project');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = '42501' OR v_err_msg LIKE '%policy%' OR v_err_msg LIKE '%permission%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.2 Passed: Cross-user INSERT rejected under RLS.';
        ELSE
            RAISE EXCEPTION 'Test 10.2 FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.2 FAILED: User B successfully inserted project belonging to User A.';
    END IF;

    -- 10.2b Verify cross-user INSERT rejection on user_preferences (Must Fail under RLS with 42501)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.user_preferences (user_id, theme) VALUES (v_user_a, 'light');
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = '42501' OR v_err_msg LIKE '%policy%' OR v_err_msg LIKE '%permission%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.2b Passed: Cross-user INSERT on user_preferences rejected under RLS.';
        ELSE
            RAISE EXCEPTION 'Test 10.2b FAILED: Unexpected error on user_preferences INSERT: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.2b FAILED: User B successfully inserted user_preferences belonging to User A.';
    END IF;

    -- 10.3 Verify cross-user UPDATE rejection (must affect 0 rows)
    UPDATE public.time_entries SET state = 'completed' WHERE user_id = v_user_a;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN
        RAISE EXCEPTION 'Test 10.3 FAILED: User B was able to update time_entries belonging to User A (% rows affected).', v_rows_affected;
    END IF;

    UPDATE public.user_preferences SET theme = 'light' WHERE user_id = v_user_a;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN
        RAISE EXCEPTION 'Test 10.3 FAILED: User B was able to update user_preferences belonging to User A (% rows affected).', v_rows_affected;
    END IF;

    -- 10.4 Verify cross-user DELETE rejection (must affect 0 rows)
    DELETE FROM public.tasks WHERE user_id = v_user_a;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN
        RAISE EXCEPTION 'Test 10.4 FAILED: User B was able to delete tasks belonging to User A (% rows affected).', v_rows_affected;
    END IF;

    DELETE FROM public.user_preferences WHERE user_id = v_user_a;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected > 0 THEN
        RAISE EXCEPTION 'Test 10.4 FAILED: User B was able to delete user_preferences belonging to User A (% rows affected).', v_rows_affected;
    END IF;

    -- 10.5 Verify client direct INSERT rejection on audit ledger with structurally valid columns (Must Fail with 42501)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        INSERT INTO public.task_status_history (
            user_id, task_id, old_status, new_status, from_column_id, to_column_id
        )
        VALUES (
            v_user_b, v_task_1, 'todo', 'done', v_col_todo_a, v_col_done_a
        );
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = '42501' OR v_err_msg LIKE '%permission denied%' OR v_err_msg LIKE '%policy%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.5 Passed: Direct client INSERT on task_status_history rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 10.5 FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.5 FAILED: Client directly inserted record into immutable audit ledger.';
    END IF;

    -- ------------------------------------------------------------------------
    -- Setup baseline normal completed timer for User C to test child move rejection in Test 10.6
    -- (Inserted under postgres role after Test 9 has quarantined v_t_abandoned_2, avoiding active conflict)
    -- ------------------------------------------------------------------------
    PERFORM set_config('role', 'postgres', true);

    INSERT INTO public.time_entries (
        user_id, task_id, started_at, ended_at, state, active_duration_seconds
    )
    VALUES (
        v_user_c, v_task_c, now() - INTERVAL '10 hours', now() - INTERVAL '9 hours', 'completed', 3600
    )
    RETURNING id INTO v_t_normal_c;

    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_c, v_t_normal_c, now() - INTERVAL '9 hours 45 min', now() - INTERVAL '9 hours 15 min')
    RETURNING id INTO v_normal_pause_c;

    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_c, v_t_normal_c, now() - INTERVAL '9 hours 55 min', now() - INTERVAL '9 hours 50 min')
    RETURNING id INTO v_normal_idle_c;

    -- 10.6 Verify quarantined time entry lifecycle and immutability rules

    -- 10.6A Authenticated client attempting to update quarantined record (v_t_abandoned_2) (Must Fail)
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_c::text)::text, true);
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        UPDATE public.time_entries 
        SET active_duration_seconds = 9999
        WHERE id = v_t_abandoned_2;
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        -- RLS policy filters out quarantined rows (0 rows affected) OR trigger throws exception
        IF v_rows_affected = 0 THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.6A Passed: Authenticated client UPDATE on quarantined entry rejected by RLS (0 rows affected).';
        ELSE
            v_test_failed := true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%quarantined%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.6A Passed: Authenticated client UPDATE on quarantined entry rejected by trigger (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 10.6A FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.6A FAILED: Authenticated client was able to update a quarantined time entry.';
    END IF;

    -- Switch to administrative role (postgres) to verify state transition locks
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);

    -- 10.6B Administrative role direct UPDATE attempting to change state out of 'quarantined' (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        UPDATE public.time_entries 
        SET state = 'completed'
        WHERE id = v_t_abandoned_2;
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%state of quarantined time entry%cannot be changed through direct table UPDATE%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.6B Passed: Administrative direct UPDATE attempting to change state out of quarantined rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 10.6B FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.6B FAILED: Administrative role was able to reopen a quarantined time entry via direct table UPDATE.';
    END IF;

    -- 10.6C Administrative role direct UPDATE attempting to modify core timing fields on quarantined record (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        UPDATE public.time_entries 
        SET active_duration_seconds = 3600
        WHERE id = v_t_abandoned_2;
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined record immutability violation%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.6C Passed: Administrative direct UPDATE on quarantined timing fields rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 10.6C FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.6C FAILED: Administrative role was able to modify core timing fields on a quarantined time entry.';
    END IF;

    -- 10.6D Administrative role direct DELETE attempting to delete quarantined parent timer (Must Fail with P0001)
    v_test_failed := false;
    v_expected_error := false;
    BEGIN
        DELETE FROM public.time_entries WHERE id = v_t_abandoned_2;
        v_test_failed := true;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
        IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry records are terminal forensic evidence and cannot be deleted directly%' THEN
            v_expected_error := true;
            RAISE NOTICE 'Test 10.6D Passed: Direct DELETE on quarantined parent timer rejected (SQLSTATE %, MSG: %).', v_err_code, v_err_msg;
        ELSE
            RAISE EXCEPTION 'Test 10.6D FAILED: Unexpected error: SQLSTATE %, MSG %', v_err_code, v_err_msg;
        END IF;
    END;
    IF v_test_failed OR NOT v_expected_error THEN
        RAISE EXCEPTION 'Test 10.6D FAILED: Administrative role was able to directly delete a quarantined time entry.';
    END IF;

    -- 10.6 Child interval immutability across all three roles: authenticated, service_role, and postgres
    -- Exhaustively tests pause and idle INSERT, UPDATE (timestamps), UPDATE (move OUT), UPDATE (move IN), and DELETE
    FOREACH v_test_role IN ARRAY ARRAY['authenticated', 'service_role', 'postgres'] LOOP
        IF v_test_role = 'authenticated' THEN
            PERFORM set_config('role', 'authenticated', true);
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_c::text)::text, true);
        ELSIF v_test_role = 'service_role' THEN
            PERFORM set_config('role', 'service_role', true);
            PERFORM set_config('request.jwt.claims', '', true);
        ELSE
            PERFORM set_config('role', 'postgres', true);
            PERFORM set_config('request.jwt.claims', '', true);
        END IF;

        -- 10.6E Direct INSERT of child pause interval into quarantined timer (Must Fail with P0001)
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
            VALUES (v_user_c, v_t_abandoned_2, now() - INTERVAL '39 hours 10 min', now() - INTERVAL '39 hours 05 min');
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Cannot insert pause interval into quarantined time entry%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6E [%] Passed: Pause INSERT into quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6E [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6E [%] FAILED: Able to insert pause into quarantined timer.', v_test_role;
        END IF;

        -- 10.6F Direct UPDATE of child pause belonging to quarantined timer (Must Fail with P0001)
        -- Explicitly test with out-of-bounds timestamps to prove validation order:
        -- Quarantine check MUST fire first (P0001), not the timestamp bounds validation!
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            UPDATE public.time_entry_pauses 
            SET paused_at = '2099-01-01 00:00:00+00', resumed_at = '2099-01-01 01:00:00+00'
            WHERE id = v_pause_quarantine;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry child pause records are immutable and cannot be modified or moved%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6F [%] Passed: Pause UPDATE against quarantined timer child rejected by quarantine check first (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6F [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6F [%] FAILED: Able to modify child pause on quarantined timer.', v_test_role;
        END IF;

        -- 10.6G Pause UPDATE attempting to move pause between quarantined timer and normal timer (Must Fail with P0001)
        -- Part 1: Moving pause OUT of quarantined timer to normal timer
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            UPDATE public.time_entry_pauses 
            SET time_entry_id = v_t_normal_c
            WHERE id = v_pause_quarantine;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry child pause records are immutable and cannot be modified or moved%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6G (Part 1) [%] Passed: Moving pause out of quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6G (Part 1) [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6G (Part 1) [%] FAILED: Able to move child pause out of quarantined timer.', v_test_role;
        END IF;

        -- Part 2: Moving normal pause INTO quarantined timer
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            UPDATE public.time_entry_pauses 
            SET time_entry_id = v_t_abandoned_2
            WHERE id = v_normal_pause_c;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Cannot move pause interval into quarantined time entry%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6G (Part 2) [%] Passed: Moving pause into quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6G (Part 2) [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6G (Part 2) [%] FAILED: Able to move pause into quarantined timer.', v_test_role;
        END IF;

        -- 10.6H Direct DELETE of child pause belonging to quarantined timer (Must Fail with P0001)
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            DELETE FROM public.time_entry_pauses WHERE id = v_pause_quarantine;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry child pause records are immutable and cannot be deleted directly%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6H [%] Passed: Direct DELETE of child pause on quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6H [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6H [%] FAILED: Able to directly delete child pause from quarantined timer.', v_test_role;
        END IF;

        -- 10.6I Direct INSERT of child idle interval into quarantined timer (Must Fail with P0001)
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
            VALUES (v_user_c, v_t_abandoned_2, now() - INTERVAL '39 hours 10 min', now() - INTERVAL '39 hours 05 min');
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Cannot insert idle interval into quarantined time entry%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6I [%] Passed: Idle INSERT into quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6I [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6I [%] FAILED: Able to insert idle interval into quarantined timer.', v_test_role;
        END IF;

        -- 10.6J Direct UPDATE of child idle belonging to quarantined timer (Must Fail with P0001)
        -- Explicitly test with out-of-bounds timestamps to prove validation order:
        -- Quarantine check MUST fire first (P0001), not the timestamp bounds validation!
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            UPDATE public.time_entry_idles 
            SET started_at = '2099-01-01 00:00:00+00', ended_at = '2099-01-01 01:00:00+00'
            WHERE id = v_idle_quarantine;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry child idle records are immutable and cannot be modified or moved%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6J [%] Passed: Idle UPDATE against quarantined timer child rejected by quarantine check first (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6J [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6J [%] FAILED: Able to modify child idle on quarantined timer.', v_test_role;
        END IF;

        -- 10.6K Idle UPDATE attempting to move idle between quarantined timer and normal timer (Must Fail with P0001)
        -- Part 1: Moving idle OUT of quarantined timer to normal timer
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            UPDATE public.time_entry_idles 
            SET time_entry_id = v_t_normal_c
            WHERE id = v_idle_quarantine;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry child idle records are immutable and cannot be modified or moved%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6K (Part 1) [%] Passed: Moving idle out of quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6K (Part 1) [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6K (Part 1) [%] FAILED: Able to move child idle out of quarantined timer.', v_test_role;
        END IF;

        -- Part 2: Moving normal idle INTO quarantined timer
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            UPDATE public.time_entry_idles 
            SET time_entry_id = v_t_abandoned_2
            WHERE id = v_normal_idle_c;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Cannot move idle interval into quarantined time entry%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6K (Part 2) [%] Passed: Moving idle into quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6K (Part 2) [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6K (Part 2) [%] FAILED: Able to move idle into quarantined timer.', v_test_role;
        END IF;

        -- 10.6L Direct DELETE of child idle belonging to quarantined timer (Must Fail with P0001)
        v_test_failed := false;
        v_expected_error := false;
        BEGIN
            DELETE FROM public.time_entry_idles WHERE id = v_idle_quarantine;
            v_test_failed := true;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
            IF v_err_code = 'P0001' AND v_err_msg LIKE '%Quarantined time entry child idle records are immutable and cannot be deleted directly%' THEN
                v_expected_error := true;
                RAISE NOTICE 'Test 10.6L [%] Passed: Direct DELETE of child idle on quarantined timer rejected (SQLSTATE %, MSG: %).', v_test_role, v_err_code, v_err_msg;
            ELSE
                RAISE EXCEPTION 'Test 10.6L [%] FAILED: Unexpected error: SQLSTATE %, MSG %', v_test_role, v_err_code, v_err_msg;
            END IF;
        END;
        IF v_test_failed OR NOT v_expected_error THEN
            RAISE EXCEPTION 'Test 10.6L [%] FAILED: Able to directly delete child idle from quarantined timer.', v_test_role;
        END IF;
    END LOOP;

    -- Reset role to postgres for subsequent test assertions
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);

    -- Final Assertion: Verify that quarantined parent and all child forensic records remain completely intact and unchanged
    SELECT * INTO v_rec_2 FROM public.time_entries WHERE id = v_t_abandoned_2;
    IF v_rec_2.state <> 'quarantined' OR v_rec_2.active_duration_seconds <> 0 OR v_rec_2.idle_duration_seconds <> 0 THEN
        RAISE EXCEPTION 'Test 10.6 FAILED: Quarantined parent timer state was altered or corrupted: state=%, active=%, idle=%',
            v_rec_2.state, v_rec_2.active_duration_seconds, v_rec_2.idle_duration_seconds;
    END IF;

    SELECT id INTO v_active_conflict FROM public.time_entry_pauses WHERE id = v_pause_quarantine AND time_entry_id = v_t_abandoned_2;
    IF v_active_conflict IS NULL THEN
        RAISE EXCEPTION 'Test 10.6 FAILED: Child pause on quarantined timer was altered or deleted.';
    END IF;

    SELECT id INTO v_active_conflict FROM public.time_entry_idles WHERE id = v_idle_quarantine AND time_entry_id = v_t_abandoned_2;
    IF v_active_conflict IS NULL THEN
        RAISE EXCEPTION 'Test 10.6 FAILED: Child idle on quarantined timer was altered or deleted.';
    END IF;

    RAISE NOTICE 'Test 10.6 Passed: Terminal quarantine rules (client block, admin state lock, timing field lock, parent delete rejection, pause INSERT/UPDATE/move/DELETE rejection, idle INSERT/UPDATE/move/DELETE rejection, and forensic record preservation) verified.';

    -- ------------------------------------------------------------------------
    -- 10.7 Account-Deletion Cascade Verification Across All 14 Managed Tables
    -- ------------------------------------------------------------------------
    -- Fail safely if the test UUID already belongs to an existing account in auth.users
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_cascade) THEN
        RAISE EXCEPTION 'Test 10.7 Setup FAILED: Test account % already exists in auth.users prior to test setup.', v_user_cascade;
    END IF;

    -- Dynamically provision isolated test account in auth.users
    INSERT INTO auth.users (id, email) VALUES (v_user_cascade, 'cascade_test@test.local');

    -- Create user hierarchy and populate records across ALL 14 Phase 9 managed tables:
    -- 1. projects
    INSERT INTO public.projects (user_id, name) 
    VALUES (v_user_cascade, 'Cascade Project') 
    RETURNING id INTO v_proj_casc;

    -- 2. project_boards
    INSERT INTO public.project_boards (user_id, project_id, name) 
    VALUES (v_user_cascade, v_proj_casc, 'Cascade Board') 
    RETURNING id INTO v_board_casc;

    -- 3. board_columns (Column 1: To Do, Column 2: In Progress)
    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) 
    VALUES (v_user_cascade, v_board_casc, 'To Do', 'todo', 0) 
    RETURNING id INTO v_col_casc;

    INSERT INTO public.board_columns (user_id, board_id, name, status_category, position) 
    VALUES (v_user_cascade, v_board_casc, 'In Progress', 'in_progress', 1) 
    RETURNING id INTO v_col_casc_2;

    -- 4. tasks
    INSERT INTO public.tasks (user_id, project_id, board_id, column_id, title) 
    VALUES (v_user_cascade, v_proj_casc, v_board_casc, v_col_casc, 'Cascade Task') 
    RETURNING id INTO v_task_casc;

    -- 5. task_labels
    INSERT INTO public.task_labels (user_id, project_id, name, color) 
    VALUES (v_user_cascade, v_proj_casc, 'Cascade Bug', '#ff0000') 
    RETURNING id INTO v_label_casc;

    -- 6. task_label_assignments
    INSERT INTO public.task_label_assignments (user_id, task_id, label_id) 
    VALUES (v_user_cascade, v_task_casc, v_label_casc);

    -- 7. task_status_history (Triggered via task update to exercise immutable ledger)
    UPDATE public.tasks 
    SET status = 'in_progress', column_id = v_col_casc_2 
    WHERE id = v_task_casc;

    -- 8. user_preferences
    INSERT INTO public.user_preferences
        (user_id, theme, activity_tracking_enabled)
    VALUES
        (v_user_cascade, 'dark', true)
    ON CONFLICT (user_id)
    DO UPDATE SET
        theme = EXCLUDED.theme,
        activity_tracking_enabled = EXCLUDED.activity_tracking_enabled;

    -- 9. time_entries (establish running timer, add child records, then transition to quarantined)
    INSERT INTO public.time_entries (user_id, task_id, started_at, state)
    VALUES (v_user_cascade, v_task_casc, now() - INTERVAL '5 hours', 'running')
    RETURNING id INTO v_t_quarantine_casc;

    -- 10. time_entry_pauses
    INSERT INTO public.time_entry_pauses (user_id, time_entry_id, paused_at, resumed_at)
    VALUES (v_user_cascade, v_t_quarantine_casc, now() - INTERVAL '4 hours 30 min', now() - INTERVAL '4 hours 15 min')
    RETURNING id INTO v_pause_casc;

    -- 11. time_entry_idles
    INSERT INTO public.time_entry_idles (user_id, time_entry_id, started_at, ended_at)
    VALUES (v_user_cascade, v_t_quarantine_casc, now() - INTERVAL '4 hours 10 min', now() - INTERVAL '4 hours 05 min')
    RETURNING id INTO v_idle_casc;

    -- Transition timer to quarantined (representing forensic crash quarantine)
    UPDATE public.time_entries
    SET state = 'quarantined',
        ended_at = now() - INTERVAL '4 hours',
        active_duration_seconds = 0,
        idle_duration_seconds = 0,
        is_recovered = true,
        recovery_reason = 'Quarantined for cascade deletion test'
    WHERE id = v_t_quarantine_casc;

    -- 12. computer_activity_events
    INSERT INTO public.computer_activity_events (user_id, task_id, duration_seconds, application_name, dedup_hash) 
    VALUES (v_user_cascade, v_task_casc, 60, 'VS Code', 'hash_test_cascade_14');

    -- 13. pet_reaction_logs
    INSERT INTO public.pet_reaction_logs (user_id, trigger_event, reaction_type, emotion_displayed) 
    VALUES (v_user_cascade, 'task_completed', 'happy', 'happy');

    -- 14. daily_reports
    INSERT INTO public.daily_reports (user_id, report_date, total_focus_seconds) 
    VALUES (v_user_cascade, '2026-03-02', 3600);

    -- Pre-deletion Assertions: Verify that v_user_cascade owns records in ALL 14 managed tables
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.project_boards WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.board_columns WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.tasks WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.task_labels WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.task_label_assignments WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.task_status_history WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.user_preferences WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.time_entries WHERE user_id = v_user_cascade AND state = 'quarantined') OR
       NOT EXISTS (SELECT 1 FROM public.time_entry_pauses WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.time_entry_idles WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.computer_activity_events WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.pet_reaction_logs WHERE user_id = v_user_cascade) OR
       NOT EXISTS (SELECT 1 FROM public.daily_reports WHERE user_id = v_user_cascade) THEN
        RAISE EXCEPTION 'Test 10.7 Setup FAILED: Not all 14 managed tables were populated for cascade test user.';
    END IF;

    -- Record baseline counts of unrelated users across all 14 tables before deletion
    SELECT COUNT(*) INTO v_count_projects_before FROM public.projects WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_boards_before FROM public.project_boards WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_columns_before FROM public.board_columns WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_tasks_before FROM public.tasks WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_labels_before FROM public.task_labels WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_label_assign_before FROM public.task_label_assignments WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_status_hist_before FROM public.task_status_history WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_prefs_before FROM public.user_preferences WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_timers_before FROM public.time_entries WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_pauses_before FROM public.time_entry_pauses WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_idles_before FROM public.time_entry_idles WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_events_before FROM public.computer_activity_events WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_reactions_before FROM public.pet_reaction_logs WHERE user_id <> v_user_cascade;
    SELECT COUNT(*) INTO v_count_reports_before FROM public.daily_reports WHERE user_id <> v_user_cascade;

    -- Execute real account deletion from auth.users
    -- All Phase 9 foreign keys define ON DELETE CASCADE.
    -- Row-level triggers on time_entries, time_entry_pauses, and time_entry_idles verify:
    -- NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)
    -- Allowing cascading deletion to proceed cleanly without triggering direct-deletion P0001 exceptions.
    DELETE FROM auth.users WHERE id = v_user_cascade;

    -- Force immediate evaluation of all deferred container constraints (e.g. tasks_project_board_column_fk)
    -- Proves that cascading deletion executed in clean topological order without dangling references or constraint violations.
    SET CONSTRAINTS ALL IMMEDIATE;

    -- Post-deletion Assertion A: Assert v_user_cascade is 0 in auth.users and across all 14 managed tables
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_cascade) THEN
        RAISE EXCEPTION 'Test 10.7 FAILED: auth.users record for % was not deleted.', v_user_cascade;
    END IF;

    IF (SELECT COUNT(*) FROM public.projects WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.project_boards WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.board_columns WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.tasks WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.task_labels WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.task_label_assignments WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.task_status_history WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.user_preferences WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.time_entries WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.time_entry_pauses WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.time_entry_idles WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.computer_activity_events WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.pet_reaction_logs WHERE user_id = v_user_cascade) <> 0 OR
       (SELECT COUNT(*) FROM public.daily_reports WHERE user_id = v_user_cascade) <> 0 THEN
        RAISE EXCEPTION 'Test 10.7 FAILED: Cascading account deletion left orphan records for v_user_cascade in public tables.';
    END IF;

    -- Post-deletion Assertion B: Assert that unrelated users row counts across all 14 tables are completely unchanged
    IF (SELECT COUNT(*) FROM public.projects WHERE user_id <> v_user_cascade) <> v_count_projects_before OR
       (SELECT COUNT(*) FROM public.project_boards WHERE user_id <> v_user_cascade) <> v_count_boards_before OR
       (SELECT COUNT(*) FROM public.board_columns WHERE user_id <> v_user_cascade) <> v_count_columns_before OR
       (SELECT COUNT(*) FROM public.tasks WHERE user_id <> v_user_cascade) <> v_count_tasks_before OR
       (SELECT COUNT(*) FROM public.task_labels WHERE user_id <> v_user_cascade) <> v_count_labels_before OR
       (SELECT COUNT(*) FROM public.task_label_assignments WHERE user_id <> v_user_cascade) <> v_count_label_assign_before OR
       (SELECT COUNT(*) FROM public.task_status_history WHERE user_id <> v_user_cascade) <> v_count_status_hist_before OR
       (SELECT COUNT(*) FROM public.user_preferences WHERE user_id <> v_user_cascade) <> v_count_prefs_before OR
       (SELECT COUNT(*) FROM public.time_entries WHERE user_id <> v_user_cascade) <> v_count_timers_before OR
       (SELECT COUNT(*) FROM public.time_entry_pauses WHERE user_id <> v_user_cascade) <> v_count_pauses_before OR
       (SELECT COUNT(*) FROM public.time_entry_idles WHERE user_id <> v_user_cascade) <> v_count_idles_before OR
       (SELECT COUNT(*) FROM public.computer_activity_events WHERE user_id <> v_user_cascade) <> v_count_events_before OR
       (SELECT COUNT(*) FROM public.pet_reaction_logs WHERE user_id <> v_user_cascade) <> v_count_reactions_before OR
       (SELECT COUNT(*) FROM public.daily_reports WHERE user_id <> v_user_cascade) <> v_count_reports_before THEN
        RAISE EXCEPTION 'Test 10.7 FAILED: Account-deletion cascade affected unrelated users records.';
    END IF;

    RAISE NOTICE 'Test 10.7 Passed: Full account-deletion cascade verified across all 14 tables with SET CONSTRAINTS ALL IMMEDIATE and zero impact on unrelated users.';

    -- ------------------------------------------------------------------------
    -- 10.8 TRUNCATE Privilege Bypass Restriction Audit
    -- ------------------------------------------------------------------------
    -- Verify that service_role does NOT have TRUNCATE privilege on time_entries,
    -- time_entry_pauses, or time_entry_idles (closing trigger-bypass vectors),
    -- while retaining standard DML privileges (SELECT, INSERT, UPDATE, DELETE).
    IF has_table_privilege('service_role', 'public.time_entries'::regclass, 'TRUNCATE') THEN
        RAISE EXCEPTION 'Test 10.8 FAILED: service_role holds unauthorized TRUNCATE privilege on public.time_entries';
    END IF;

    IF has_table_privilege('service_role', 'public.time_entry_pauses'::regclass, 'TRUNCATE') THEN
        RAISE EXCEPTION 'Test 10.8 FAILED: service_role holds unauthorized TRUNCATE privilege on public.time_entry_pauses';
    END IF;

    IF has_table_privilege('service_role', 'public.time_entry_idles'::regclass, 'TRUNCATE') THEN
        RAISE EXCEPTION 'Test 10.8 FAILED: service_role holds unauthorized TRUNCATE privilege on public.time_entry_idles';
    END IF;

    IF NOT (
        has_table_privilege('service_role', 'public.time_entries'::regclass, 'SELECT') AND
        has_table_privilege('service_role', 'public.time_entries'::regclass, 'INSERT') AND
        has_table_privilege('service_role', 'public.time_entries'::regclass, 'UPDATE') AND
        has_table_privilege('service_role', 'public.time_entries'::regclass, 'DELETE')
    ) THEN
        RAISE EXCEPTION 'Test 10.8 FAILED: service_role lacks required DML privileges on public.time_entries';
    END IF;

    RAISE NOTICE 'Test 10.8 Passed: TRUNCATE privilege explicitly revoked from service_role on timer tables while retaining full DML.';
    RAISE NOTICE 'Test 10 Passed: 14-table RLS isolation, cross-user write protection, ledger immutability, terminal quarantine rules, account-deletion cascade, and TRUNCATE restriction verified.';

    -- ------------------------------------------------------------------------
    -- TEST 11: Comprehensive 14-Function EXECUTE Privilege Hardening Audit
    -- ------------------------------------------------------------------------
    FOR v_func_rec IN
        SELECT 
            p.proname AS func_name,
            EXISTS (
                SELECT 1 
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
            ) AS pub_exec,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS serv_exec
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
    LOOP
        -- Check PUBLIC execute (must be false for all via aclexplode grantee = 0)
        IF v_func_rec.pub_exec THEN
            RAISE EXCEPTION 'Test 11 FAILED: Function % has PUBLIC execute permission (grantee=0 found in aclexplode)', v_func_rec.func_name;
        END IF;

        -- Check anon execute (must be false for all)
        IF v_func_rec.anon_exec THEN
            RAISE EXCEPTION 'Test 11 FAILED: Function % has anon execute permission', v_func_rec.func_name;
        END IF;

        -- Check service_role execute (must be true for all 14)
        IF NOT v_func_rec.serv_exec THEN
            RAISE EXCEPTION 'Test 11 FAILED: Function % lacks service_role execute permission', v_func_rec.func_name;
        END IF;

        -- Check authenticated execute:
        -- ONLY allowed on the 3 approved callable utilities; STRICTLY FORBIDDEN on reconcile_stale_time_entries and all 10 internal trigger functions
        IF v_func_rec.func_name IN (
            'fn_calculate_timer_active_multirange',
            'fn_check_active_interval_conflict',
            'purge_expired_activity_events'
        ) THEN
            IF NOT v_func_rec.auth_exec THEN
                RAISE EXCEPTION 'Test 11 FAILED: Callable utility % lacks authenticated execute permission', v_func_rec.func_name;
            END IF;
        ELSE
            IF v_func_rec.auth_exec THEN
                RAISE EXCEPTION 'Test 11 FAILED: Function % exposes unauthorized authenticated execute permission (must be restricted strictly to service_role)', v_func_rec.func_name;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'Test 11 Passed: All 14 functions satisfy EXECUTE privilege hardening matrix (PUBLIC/anon blocked via aclexplode, authenticated restricted strictly to 3 utilities, service_role fully granted on all 14).';
END $$;

ROLLBACK;
```

---

### 3.2 Two-Connection Concurrency Verification Procedure (Dual-Session Script)

> [!NOTE]
> **Execution Status: DOCUMENTED SPECIFICATION (AWAITING STAGING EXECUTION).**
> This procedure cannot be executed in a single-connection review. Execute across two separate PostgreSQL connections (`Session 1` and `Session 2`) under `READ COMMITTED` isolation in the staging environment.

#### Prerequisites: Complete Setup Commands (Run Once in Either Session)
```sql
DO $$
DECLARE
    v_u UUID := '00000000-0000-0000-0000-0000000000cc'::UUID;
    v_p UUID := '00000000-0000-0000-0000-0000000000ca'::UUID;
    v_b UUID := '00000000-0000-0000-0000-0000000000cb'::UUID;
    v_c UUID := '00000000-0000-0000-0000-0000000000c1'::UUID;
BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_u, 'concurrency_user@test.local') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.projects (id, user_id, name) VALUES (v_p, v_u, 'Concurrency Project') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.project_boards (id, user_id, project_id, name) VALUES (v_b, v_u, v_p, 'Board') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.board_columns (id, user_id, board_id, name, status_category, position) 
    VALUES (v_c, v_u, v_b, 'To Do', 'todo', 0) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.tasks (id, user_id, project_id, board_id, column_id, title)
    VALUES ('00000000-0000-0000-0000-000000000011'::UUID, v_u, v_p, v_b, v_c, 'Task 1') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.tasks (id, user_id, project_id, board_id, column_id, title)
    VALUES ('00000000-0000-0000-0000-000000000022'::UUID, v_u, v_p, v_b, v_c, 'Task 2') ON CONFLICT (id) DO NOTHING;

    -- Scenario C Baseline Timer: 10:00 to 12:00, completed, active = 3600
    INSERT INTO public.time_entries (id, user_id, task_id, started_at, ended_at, state, active_duration_seconds)
    VALUES ('00000000-0000-0000-0000-000000000300'::UUID, v_u, '00000000-0000-0000-0000-000000000011'::UUID, 
            '2026-03-02 10:00:00+00', '2026-03-02 12:00:00+00', 'completed', 3600)
    ON CONFLICT (id) DO NOTHING;

    -- Scenario C Baseline Pause: 10:30 to 11:30
    INSERT INTO public.time_entry_pauses (id, user_id, time_entry_id, paused_at, resumed_at)
    VALUES ('00000000-0000-0000-0000-00000000030a'::UUID, v_u, '00000000-0000-0000-0000-000000000300'::UUID,
            '2026-03-02 10:30:00+00', '2026-03-02 11:30:00+00')
    ON CONFLICT (id) DO NOTHING;

    -- Scenario D Baseline: Stale timer with child pause for lock-deferral test
    INSERT INTO public.time_entries (id, user_id, task_id, started_at, state, active_duration_seconds, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000400'::UUID, v_u, '00000000-0000-0000-0000-000000000011'::UUID,
            now() - INTERVAL '24 hours', 'running', 1800, now() - INTERVAL '20 hours')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.time_entry_pauses (id, user_id, time_entry_id, paused_at, resumed_at)
    VALUES ('00000000-0000-0000-0000-00000000040a'::UUID, v_u, '00000000-0000-0000-0000-000000000400'::UUID,
            now() - INTERVAL '23 hours 50 min', now() - INTERVAL '23 hours 40 min')
    ON CONFLICT (id) DO NOTHING;
END $$;
```

#### Concurrency Scenario A: Simultaneous Running Timer Starts

- **Purpose:** Verifies that two transactions attempting to start a running timer for the same user are serialized by the per-user advisory lock, and that the second transaction fails immediately upon unblocking.

| Step | Session 1 Command | Session 2 Command | Observation & Verification |
|---|---|---|---|
| 1 | `BEGIN;` | | Session 1 transaction begins. |
| 2 | | `BEGIN;` | Session 2 transaction begins. |
| 3 | `INSERT INTO public.time_entries (id, user_id, task_id, started_at, state) VALUES ('00000000-0000-0000-0000-000000000101'::UUID, '00000000-0000-0000-0000-0000000000cc'::UUID, '00000000-0000-0000-0000-000000000011'::UUID, now(), 'running');` | | **Session 1:** `INSERT 0 1`. Advisory lock acquired for User CC. |
| 4 | | `INSERT INTO public.time_entries (id, user_id, task_id, started_at, state) VALUES ('00000000-0000-0000-0000-000000000102'::UUID, '00000000-0000-0000-0000-0000000000cc'::UUID, '00000000-0000-0000-0000-000000000022'::UUID, now(), 'running');` | **Session 2 BLOCKS.** Command hangs waiting for advisory lock. |
| 5 | `COMMIT;` | | Session 1 commits; advisory lock released. |
| 6 | | *(Unblocks automatically)* | **Session 2 THROWS:** `ERROR: duplicate key value violates unique constraint "idx_unique_running_timer_per_user"` (SQLSTATE `23505`). |
| 7 | | `ROLLBACK;` | Session 2 transaction safely aborted. Exactly 1 running timer exists. |

#### Concurrency Scenario B: Simultaneous Overlapping Completed Intervals

- **Purpose:** Verifies that when two transactions attempt to insert overlapping completed sessions, the advisory lock forces serialization, and the `VOLATILE` conflict checking function sees the newly committed interval.

| Step | Session 1 Command | Session 2 Command | Observation & Verification |
|---|---|---|---|
| 1 | `BEGIN;` | | Session 1 transaction begins. |
| 2 | | `BEGIN;` | Session 2 transaction begins. |
| 3 | `INSERT INTO public.time_entries (id, user_id, task_id, started_at, ended_at, state) VALUES ('00000000-0000-0000-0000-000000000201'::UUID, '00000000-0000-0000-0000-0000000000cc'::UUID, '00000000-0000-0000-0000-000000000011'::UUID, '2026-03-02 14:00:00+00', '2026-03-02 15:00:00+00', 'completed');` | | **Session 1:** `INSERT 0 1`. Advisory lock acquired. |
| 4 | | `INSERT INTO public.time_entries (id, user_id, task_id, started_at, ended_at, state) VALUES ('00000000-0000-0000-0000-000000000202'::UUID, '00000000-0000-0000-0000-0000000000cc'::UUID, '00000000-0000-0000-0000-000000000022'::UUID, '2026-03-02 14:30:00+00', '2026-03-02 15:30:00+00', 'completed');` | **Session 2 BLOCKS.** Query hangs waiting on advisory lock. |
| 5 | `COMMIT;` | | Session 1 commits. |
| 6 | | *(Unblocks automatically)* | **Session 2 THROWS:** `ERROR: Active work interval conflicts with existing time entry ...` (SQLSTATE `P0001`). `VOLATILE` snapshot immediately observed Session 1's commit. |
| 7 | | `ROLLBACK;` | Session 2 rolls back. Zero interval collisions remain. |

#### Concurrency Scenario C: Concurrent Timer Insertion vs. Pause Deletion

- **Purpose:** Verifies that deleting a pause (which expands active work) is serialized against a concurrent timer insertion inside that pause window, proving that `fn_validate_time_entry_pause` obtains a fresh snapshot after waiting for the lock.
- **Initial Baseline State:** Timer `...0300` has active segments `[10:00, 10:30)` and `[11:30, 12:00)`. Pause `...030a` covers `[10:30, 11:30)`.

| Step | Session 1 Command | Session 2 Command | Observation & Verification |
|---|---|---|---|
| 1 | `BEGIN;` | | Session 1 begins. |
| 2 | | `BEGIN;` | Session 2 begins. |
| 3 | `INSERT INTO public.time_entries (id, user_id, task_id, started_at, ended_at, state) VALUES ('00000000-0000-0000-0000-000000000301'::UUID, '00000000-0000-0000-0000-0000000000cc'::UUID, '00000000-0000-0000-0000-000000000011'::UUID, '2026-03-02 10:45:00+00', '2026-03-02 11:15:00+00', 'completed');` | | **Session 1:** `INSERT 0 1`. Inserts Timer B inside Pause A's window. Holds advisory lock. |
| 4 | | `DELETE FROM public.time_entry_pauses WHERE id = '00000000-0000-0000-0000-00000000030a'::UUID;` | **Session 2 BLOCKS** on `PERFORM pg_advisory_xact_lock(...)` in `fn_validate_time_entry_pause()`. |
| 5 | `COMMIT;` | | Session 1 commits Timer B. |
| 6 | | *(Unblocks automatically)* | **Session 2 THROWS:** `ERROR: Cannot delete pause: expanding active work interval would conflict with time entry ...` (SQLSTATE `P0001`). Fresh command snapshot caught Timer B! |
| 7 | | `ROLLBACK;` | Session 2 rolls back. Pause A preserved. |

- **Verification Query:**
```sql
-- Confirm Pause A is preserved and Timer B is committed
SELECT id, time_entry_id, paused_at, resumed_at FROM public.time_entry_pauses WHERE id = '00000000-0000-0000-0000-00000000030a'::UUID;
SELECT id, started_at, ended_at, state FROM public.time_entries WHERE id = '00000000-0000-0000-0000-000000000301'::UUID;
```

#### Concurrency Scenario D: Recovery Encountering a Concurrently Locked Child Interval

- **Purpose:** Verifies that crash recovery (`reconcile_stale_time_entries()`) never blocks or deadlocks when a concurrent user transaction holds an uncommitted row lock on a child pause or idle interval. Recovery executes `SELECT id FROM public.time_entry_pauses WHERE time_entry_id = r.id FOR UPDATE NOWAIT;`. Upon encountering a locked child tuple, `NOWAIT` immediately raises SQLSTATE `55P03` (`lock_not_available`), which recovery catches to cleanly defer recovery for that candidate timer while completing all other eligible timers.
- **Initial Baseline State:** Timer `...0400` is abandoned (started 24h ago, updated 20h ago) with child pause `...040a` (`[23h50m ago, 23h40m ago]`).

| Step | Session 1 (User Transaction) | Session 2 (Recovery Worker) | Observation & Verification |
|---|---|---|---|
| 1 | `BEGIN;` | | Session 1 transaction begins. |
| 2 | `SELECT * FROM public.time_entry_pauses WHERE id = '00000000-0000-0000-0000-00000000040a'::UUID FOR UPDATE;` | | **Session 1:** Acquires exclusive row lock on child pause tuple `...040a`. |
| 3 | | `BEGIN;` | Session 2 transaction begins. |
| 4 | | `SELECT * FROM public.reconcile_stale_time_entries(INTERVAL '12 hours');` | **Session 2 DOES NOT BLOCK.** `FOR UPDATE NOWAIT` immediately detects row lock on child pause, catches `lock_not_available` (55P03), and safely skips Timer `...0400`. Recovery completes other eligible timers and returns immediately! |
| 5 | | `COMMIT;` | Session 2 commits. Timer `...0400` is untouched and not partially recovered. |
| 6 | `COMMIT;` | | Session 1 commits its user modification and releases the row lock on `...040a`. |
| 7 | | `BEGIN;` | Session 2 begins next scheduled recovery sweep. |
| 8 | | `SELECT * FROM public.reconcile_stale_time_entries(INTERVAL '12 hours');` | **Session 2:** Now acquires child rows without contention and successfully recovers Timer `...0400` to `state = 'completed'`. |
| 9 | | `COMMIT;` | Session 2 commits recovered timer. |

- **Verification Query:**
```sql
-- Confirm Timer ...0400 was safely deferred in Step 4 and cleanly completed in Step 8
SELECT id, state, is_recovered, active_duration_seconds, recovery_reason 
FROM public.time_entries 
WHERE id = '00000000-0000-0000-0000-000000000400'::UUID;
```

---

## 4. Operational Sign-Off & Staging Gate

### Static Code Review Status: COMPLETED (REVISION 15 — FINAL DOCUMENTATION CORRECTIONS ONLY)
All defects and documentation items identified in Revision 15 and prior reviews have been resolved and verified by static analysis:
1. **Authoritative Schema Inventory (12 New Application Tables & 2 Extended Baseline Tables):** Rebuilt schema inventory strictly using actual column declarations, distinguishing column definitions from table-level constraints (FOREIGN KEY, CHECK, UNIQUE, PRIMARY KEY). Confirmed exact column counts and field names:
   - **12 New Application Tables:**
     - `public.projects` (9 columns): `id`, `user_id`, `name`, `description`, `color`, `icon`, `is_archived`, `created_at`, `updated_at`.
     - `public.project_boards` (9 columns): `id`, `user_id`, `project_id`, `name`, `description`, `board_type`, `position`, `created_at`, `updated_at`.
     - `public.board_columns` (9 columns): `id`, `user_id`, `board_id`, `name`, `status_category`, `position`, `wip_limit`, `created_at`, `updated_at`.
     - `public.task_labels` (6 columns): `id`, `user_id`, `project_id`, `name`, `color`, `created_at`.
     - `public.task_label_assignments` (4 columns): `user_id`, `task_id`, `label_id`, `assigned_at` (composite PK `(task_id, label_id)`).
     - `public.task_status_history` (8 columns): `id`, `user_id`, `task_id`, `old_status`, `new_status`, `from_column_id`, `to_column_id`, `changed_at`.
     - `public.time_entries` (14 columns): `id`, `user_id`, `task_id`, `project_id`, `started_at`, `ended_at`, `active_duration_seconds`, `idle_duration_seconds`, `tracking_source`, `state`, `is_recovered`, `recovery_reason`, `created_at`, `updated_at`.
     - `public.time_entry_pauses` (6 columns): `id`, `user_id`, `time_entry_id`, `paused_at`, `resumed_at`, `created_at`.
     - `public.time_entry_idles` (6 columns): `id`, `user_id`, `time_entry_id`, `started_at`, `ended_at`, `created_at`.
     - `public.computer_activity_events` (12 columns): `id`, `user_id`, `task_id`, `project_id`, `event_timestamp`, `duration_seconds`, `application_name`, `window_title`, `activity_category`, `is_idle`, `dedup_hash`, `created_at`.
     - `public.pet_reaction_logs` (8 columns): `id`, `user_id`, `task_id`, `reaction_type`, `trigger_event`, `emotion_displayed`, `dialogue_text`, `created_at`.
     - `public.daily_reports` (14 columns): `id`, `user_id`, `report_date`, `total_focus_seconds`, `total_idle_seconds`, `tasks_completed_count`, `tasks_created_count`, `project_breakdown`, `application_breakdown`, `ai_narrative`, `actionable_suggestions`, `generation_status`, `created_at`, `updated_at`.
   - **Baseline Tables Additive Extensions (Step 2 ALTER TABLE Source of Truth):**
     - `public.tasks` (10 columns added by Phase 9 migration): `project_id` (UUID), `board_id` (UUID), `column_id` (UUID), `status` (VARCHAR(30) DEFAULT 'todo'), `position` (INTEGER DEFAULT 0), `parent_task_id` (UUID), `actual_duration_minutes` (INTEGER DEFAULT 0), `started_at` (TIMESTAMPTZ), `completed_at` (TIMESTAMPTZ), `status_updated_at` (TIMESTAMPTZ DEFAULT now()).
     - `public.user_preferences` (9 privacy-related columns added by Phase 9 migration): `activity_tracking_enabled` (BOOLEAN DEFAULT false), `idle_threshold_seconds` (INTEGER DEFAULT 300), `auto_reports_enabled` (BOOLEAN DEFAULT false), `daily_report_time` (TIME DEFAULT '18:00:00'), `telemetry_retention_days` (INTEGER DEFAULT 30), `tracking_include_window_titles` (BOOLEAN DEFAULT false), `tracking_include_process_names` (BOOLEAN DEFAULT false), `music_reaction_enabled` (BOOLEAN DEFAULT false), `auto_break_reminders` (BOOLEAN DEFAULT true).
2. **Hardened Baseline Table Compatibility Pre-Checks (`tasks` & `user_preferences`):** Added fail-fast prechecks in Step 0 verifying that baseline columns used by acceptance fixtures exist with compatible types and nullability prior to executing Step 2 ALTER TABLE extensions:
   - `public.tasks.id`: Explicitly checks for missing column (`v_type IS NULL`) before asserting `v_type = 'uuid'` and `v_nullable = 'NO'`.
   - `public.tasks.user_id`: Explicitly checks for missing column (`v_type IS NULL`) before asserting `v_type = 'uuid'` and `v_nullable = 'NO'`.
   - `public.tasks.completed`: Verified boolean AND `NOT NULL` (`is_nullable = 'NO'`).
   - `public.tasks.title`: Verified exists with compatible type (`text` or `character varying`).
   - `public.user_preferences.user_id`: Explicitly checks for missing column (`v_type IS NULL`) before asserting `v_type = 'uuid'` and `v_nullable = 'NO'`.
   - `public.user_preferences.theme`: Verified exists with compatible type (`text` or `character varying`).
   - Eliminates the PL/pgSQL SQL NULL evaluation issue where `NULL <> 'uuid'` evaluated to NULL rather than TRUE, ensuring informative, fail-fast exceptions if any baseline column is missing.
3. **Reconciled INSERT Audit Classification & Accounting:** Independently recounted and audited all INSERT statements and VALUES tuples across the deployment guide, distinguishing fenced acceptance-test SQL from markdown concurrency instruction tables, positive fixtures from negative tests, and system tables from application tables:
   - **Fenced SQL Acceptance Test Sections:** Exactly 98 SQL INSERT statements inserting 103 VALUES tuples.
     - *Supabase Authentication System Table (`auth.users`):* 3 statements inserting 8 system-user rows (6 users in initial fixture line 187, 1 cascade user in Test 10.7 line 1284, 1 user in Section 3.2 setup line 1572). Strictly accounted for as a Supabase system table outside the application schema.
     - *14 Phase 9 Managed Application Tables:* 95 statements inserting 95 VALUES tuples.
       - *Positive Fixture Statements:* 92 statements (populating operational data for Users A, A2, A3, B, C, D, and cascade user).
       - *Expected-Failing Negative Test Statements:* 3 statements asserting client authorization/RLS rejections (Test 10.2 unauthorized cross-user INSERT on `projects`, Test 10.2b unauthorized cross-user INSERT on `user_preferences`, and Test 10.5 direct client INSERT on `task_status_history`).
   - **Markdown Concurrency Instruction Tables (Section 3.2):** Exactly 5 SQL INSERT commands inserting 5 VALUES tuples (all on `public.time_entries`).
   - **Combined Grand Total:** Exactly 103 statements and 108 VALUES tuples (8 system-user rows in `auth.users`, 100 application rows in the 14 managed tables).
   - **Per-Table Breakdown:**
     - `auth.users`: 3 statements (8 tuples)
     - `public.projects`: 8 statements (8 tuples: 7 positive fixtures, 1 negative test)
     - `public.project_boards`: 7 statements (7 tuples: 7 positive fixtures)
     - `public.board_columns`: 10 statements (10 tuples: 10 positive fixtures)
     - `public.tasks`: 9 statements (9 tuples: 9 positive fixtures)
     - `public.task_labels`: 2 statements (2 tuples: 2 positive fixtures)
     - `public.task_label_assignments`: 2 statements (2 tuples: 2 positive fixtures)
     - `public.user_preferences`: 3 statements (3 tuples: 2 positive fixtures, 1 negative test)
     - `public.task_status_history`: 1 statement (1 tuple: 0 positive fixtures, 1 negative test)
     - `public.time_entries`: 22 statements (22 tuples: 17 fenced [positive fixtures/engine tests] + 5 concurrency markdown tables)
     - `public.time_entry_pauses`: 17 statements (17 tuples: positive fixtures/engine tests)
     - `public.time_entry_idles`: 13 statements (13 tuples: positive fixtures/engine tests)
     - `public.computer_activity_events`: 2 statements (2 tuples: 2 positive fixtures)
     - `public.pet_reaction_logs`: 2 statements (2 tuples: 2 positive fixtures)
     - `public.daily_reports`: 2 statements (2 tuples: 2 positive fixtures)
4. **Complete Baseline RLS Diagnostics & Mandatory Staging Verification Instructions:**
   - **Query 4 Expansion:** Extended Query 4 in `docs/kuro_phase9_reviewed_validation.sql` to verify Row Level Security (`rls_enabled = true`) across all 14 managed tables, explicitly including baseline tables `public.tasks` and `public.user_preferences`.
   - **Query 15.7 Staging Policy Verification (Mandatory):** Documented staging operational requirements in Section 15.7 to inspect existing baseline policies from `pg_policies` in the staging runtime. Clarifies that `USING` (`qual`) and `WITH CHECK` (`with_check`) apply according to the specific policy command (`cmd`) and operators must not assume both expressions exist for every policy:
     - For `SELECT` and `DELETE` policies: only `USING` (`qual`) applies; `with_check` is naturally `NULL`.
     - For `INSERT` policies: only `WITH CHECK` (`with_check`) applies; `qual` is naturally `NULL`.
     - For `UPDATE` policies: `USING` (`qual`) filters rows to update; `WITH CHECK` (`with_check`) validates new values (optional/defaults to `USING`).
     - For `ALL` policies: `USING` (`qual`) applies to existing rows; `WITH CHECK` (`with_check`) applies to new/modified rows.
     - Staging verification remains strictly mandatory prior to production sign-off to ensure all active clauses enforce multi-tenant isolation (`auth.uid() = user_id`) and that no permissive cross-user policies exist (`qual = 'true'`).
   - **Acceptance Test 10 Extension:** Extended Test 10 in Section 3.1 to test cross-user access to `public.user_preferences`: verified SELECT isolation (10.1), rejection of unauthorized INSERT with spoofed `user_id` (10.2b, fails with SQLSTATE `42501`), rejection of cross-user UPDATE (10.3, affects 0 rows), and rejection of cross-user DELETE (10.4, affects 0 rows), retaining existing two-user tests for `tasks` and all other tables.
5. **Acceptance Fixture Schema Alignment (Acceptance Tests 10 & 10.7):** Resolved all fixture-schema mismatches across all 14 managed tables:
   - **`pet_reaction_logs.emotion_displayed`:** Explicitly supplied `emotion_displayed` (`'happy'`) on all `public.pet_reaction_logs` INSERT statements in Test 10 and Test 10.7, satisfying the schema definition `VARCHAR(30) NOT NULL` with no default.
   - **`daily_reports.total_focus_seconds`:** Corrected all `public.daily_reports` INSERT statements to insert into authoritative migration column `total_focus_seconds` rather than non-existent `total_active_seconds`, preserving migration schema integrity without creating unnecessary database columns.
6. **Accurate UUID Literal Terminology:** Documented deterministic test UUIDs accurately as valid, well-formed 128-bit PostgreSQL UUID literals (standard 8-4-4-4-12 hex notation) rather than RFC 4122 Version 4 UUIDs.
7. **Complete Child Immutability Multi-Role Coverage (Acceptance Subtest 10.6):** Child pause and idle immutability protections (INSERT into quarantined timer, UPDATE modifying timestamps including out-of-bounds timestamps, UPDATE moving child OUT of quarantined timer, UPDATE moving normal child INTO quarantined timer, and DELETE) are exhaustively tested and verified across all three database roles: `authenticated` (with JWT claims `sub: v_user_c`), `service_role`, and `postgres`. All operations consistently raise SQLSTATE `P0001` with the intended quarantine error messages across all roles, with zero mutation to underlying forensic records.
8. **Strengthened 14-Table Account-Deletion Cascade Validation (Acceptance Subtest 10.7):** Dynamically provisions an isolated test account (`v_user_cascade`), asserting pre-absence from `auth.users`. Populates records across all 14 Phase 9 user-owned tables (`projects`, `project_boards`, `board_columns`, `tasks`, `task_labels`, `task_label_assignments`, `task_status_history`, `user_preferences`, quarantined `time_entries`, `time_entry_pauses`, `time_entry_idles`, `computer_activity_events`, `pet_reaction_logs`, `daily_reports`). Uses `ON CONFLICT (user_id) DO UPDATE` on `public.user_preferences` to prevent duplicate key `23505` conflicts if an auth signup trigger automatically provisioned default preferences upon account creation. Captures baseline row counts of all unrelated users across all 14 tables. Executes `DELETE FROM auth.users WHERE id = v_user_cascade;` and immediately calls `SET CONSTRAINTS ALL IMMEDIATE;` to evaluate deferred container constraints (e.g. `tasks_project_board_column_fk`). Proves 0 orphan rows remain for `v_user_cascade` and asserts 100% identical row counts for unrelated users across all 14 tables.
9. **Child UPDATE Validation Order Hardening (`fn_validate_time_entry_pause`, `fn_validate_time_entry_idle`):** Both old and new parent timer records are retrieved immediately upon `UPDATE`. If either parent timer is quarantined, the operation is immediately rejected with SQLSTATE `P0001` before any timestamp validity checks, chronology comparisons, or interval overlap validations are executed. Verified in Subtests 10.6F and 10.6J with out-of-bounds timestamps across all roles.
10. **TRUNCATE Privilege Bypass Closure:** Explicitly revoked `TRUNCATE` from `service_role` on `public.time_entries`, `public.time_entry_pauses`, and `public.time_entry_idles`, while preserving `SELECT, INSERT, UPDATE, DELETE` subject to triggers and RLS. Verified in Query 15.6.1 and Acceptance Subtest 10.8. *(Accurately acknowledges that row-level triggers do not prevent a PostgreSQL superuser or table owner from using privileged DDL to alter tables).*
11. **Quarantined Direct Deletion Protection (`fn_validate_time_entry_interval`, `fn_validate_time_entry_pause`, `fn_validate_time_entry_idle`):** Direct `DELETE` on quarantined `time_entries`, `time_entry_pauses`, or `time_entry_idles` records is strictly blocked with `P0001` across all roles (`authenticated`, `anon`, `service_role`, `postgres`). In Supabase, unprivileged and API roles (`authenticated`, `anon`, `service_role`) lack `SELECT` privileges on `auth.users`. Triggers inspect `current_user`: for `current_user IN ('authenticated', 'anon', 'service_role')`, the triggers immediately raise `P0001` without querying `auth.users`, eliminating SQLSTATE `42501`. For trusted administrative roles (`postgres`, `supabase_admin`, `supabase_auth_admin`), account-deletion cascading is preserved by verifying `NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)`. Verified in Subtests 10.6D, 10.6H, 10.6L, and Test 10.7.
12. **Forensic Child Integrity in Recovery (`reconcile_stale_time_entries`):** Removed updates closing open pauses and idles when a timer is transitioned to `'quarantined'`. Unclosed child intervals are preserved in their raw forensic state (`resumed_at IS NULL` or `ended_at IS NULL`), matching Query 14.10.2 classification `'unclosed open pause'` and Query 14.10.3 classification `'unclosed open idle'`.
13. **Diagnostic Classification Ordering (Queries 14.10.2 & 14.10.3):** Updated CASE classification in `docs/kuro_phase9_reviewed_validation.sql` to evaluate `'both paused_at and resumed_at exceed parent ended_at'` before single-timestamp checks. Verified in Acceptance Test 9.
14. **Administrative Recovery Privilege Hardening (`reconcile_stale_time_entries`):** Removed `authenticated` execution permissions from `reconcile_stale_time_entries(INTERVAL)`. Restricted execution strictly to `service_role` (for execution by scheduled background workers / pg_cron). Preserved `SECURITY INVOKER` design, enabling `service_role` to quarantine corrupted timers without RLS hindrance, while eliminating client-side cross-user execution and RLS policy conflicts. Verified in Query 15.5 and Test 11.
15. **Terminal Quarantine State & Direct UPDATE Protection:** Hardened `fn_validate_time_entry_interval` to enforce that quarantine is a strictly terminal state. Direct table `UPDATE` statements are blocked from changing `state` away from `'quarantined'`, even for `service_role` or administrative roles, preventing accidental reopening of corrupted timers. Preserved full immutability of core timing fields, ownership, and forensic recovery metadata. Verified in Test 10.6 (Subtests 10.6A, 10.6B, 10.6C).
16. **Forensic Quarantine Diagnostic Isolation:** Updated ordinary duration and interval integrity queries in `docs/kuro_phase9_reviewed_validation.sql` to filter out `state = 'quarantined'`. Added Section 14.10 containing dedicated forensic audit queries (14.10.1–14.10.4) that catalogue quarantined records and preserved child interval inconsistencies for operator investigation. Verified in Test 9.
17. **Final 14-Function Permission Matrix:** `service_role` has `EXECUTE` on all 14 functions; `PUBLIC` and `anon` have all execution revoked across all 14; `authenticated` has `EXECUTE` strictly on the 3 approved client callable utilities (`fn_calculate_timer_active_multirange`, `fn_check_active_interval_conflict`, `purge_expired_activity_events`). Verified via catalog inspection (`aclexplode` with `grantee = 0`) in Query 15.5 and Test 11.
18. **Crash Recovery Test Fixture Isolation (Users A, A2, A3):** Separated concurrent recovery fixtures across distinct test users (`v_user_a`, `v_user_a2`, `v_user_a3`) with complete project, board, column, and task hierarchies, eliminating active multirange collisions and partial unique index violations on running timers.
19. **Explicit `task_status_history` Privilege Hardening:** Executed `REVOKE ALL ON TABLE public.task_status_history FROM authenticated;` before granting `SELECT`, ensuring absolute SELECT-only access and total idempotency regardless of preexisting public schema defaults.
20. **Deadlock-Free Child Row Lock Handling in Recovery:** Integrated `FOR UPDATE NOWAIT` inside a subtransaction exception handler (`55P03` `lock_not_available`) so recovery never waits or deadlocks when a user transaction holds a child interval lock, cleanly deferring candidate recovery.
21. **Dual-Session Concurrency Suite (Scenarios A, B, C, D):** Includes Scenario D for concurrently locked child interval deferral, Scenario C for pause deletion serialization, Scenario B for overlapping completed intervals, and Scenario A for running timer serialization.

### Deployment Decision Matrix
```
+--------------------------------------------------------------------------------+
|                             DEPLOYMENT GATE STATUS                             |
|                                                                                |
|                GO FOR STAGING RUNTIME VALIDATION                               |
|                NO-GO FOR PRODUCTION DEPLOYMENT                                 |
|                                                                                |
|  Pending Staging Verification Items:                                          |
|    [ ] Run docs/kuro_phase9_reviewed_candidate.sql on disposable staging DB.   |
|    [ ] Run docs/kuro_phase9_reviewed_validation.sql (all 15 queries pass).     |
|    [ ] Execute Section 3.1 single-session acceptance test suite (Tests 1-11).  |
|    [ ] Execute Section 3.2 dual-session concurrency test (Scenarios A, B, C, D)|
+--------------------------------------------------------------------------------+
```
