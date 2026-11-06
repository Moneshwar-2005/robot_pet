# KURO PHASE 9 — MANUAL DATABASE DEPLOYMENT GUIDE

**Project:** `F:\smart-pet-assistant-web`  
**Target Environment:** Supabase PostgreSQL 15+ (`https://hscwopvmczveqwkgnjqv.supabase.co`)  
**Scope:** Phase 9 Database Schema Upgrade (Projects, Kanban Boards, Time Tracking, Activity Events, Pet Reaction Logs, Daily Reports)

---

## 1. Pre-Deployment Backup Instructions

Before executing any DDL or data reconciliation in Supabase, take an immediate cold backup:

1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select the Kuro project (`hscwopvmczveqwkgnjqv`).
3. In the left navigation menu, navigate to **Settings (gear icon) $\to$ Database $\to$ Backups**.
4. Click **Take Backup Now** (or verify the automated scheduled daily backup is current).
5. Alternatively, if connecting via Supabase CLI:
   ```bash
   supabase db dump -f kuro_pre_phase9_backup.sql
   ```

---

## 2. Required Supabase Extension Checks

The Phase 9 migration requires the following PostgreSQL extensions:
- `pgcrypto` — Cryptographic hash and UUID generation (`gen_random_uuid()`).
- `btree_gist` — Required for temporal range exclusion constraints (`EXCLUDE USING gist`) on `public.time_entries` and `public.time_entry_pauses`.

### Extension Verification Steps:
1. In the Supabase Dashboard, navigate to **Database $\to$ Extensions**.
2. Search for `btree_gist`.
3. Verify that the toggle is **Active (Green)**.
4. If disabled, toggle it **ON**. (Note: Extension installation requires administrator privileges / `postgres` role).

---

## 3. Manual SQL Deployment Instructions

1. Open the Supabase Dashboard and click on the **SQL Editor** in the left sidebar.
2. Click **+ New Query**.
3. Name the query: `Phase 9 Deployment - Production Release`.
4. Open [`docs/kuro_phase9_final_migration.sql`](file:///f:/smart-pet-assistant-web/docs/kuro_phase9_final_migration.sql) and copy the entire contents.
5. Paste the SQL script into the query editor window.
6. Click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`).
7. Verify that the execution completes with:
   ```text
   Success. No rows returned
   ```
   *(The transaction ends with `COMMIT;`. If any Step 0 pre-check fails or a constraint violation occurs, the entire transaction rolls back automatically).*

---

## 4. Post-Deployment Validation

After the migration commits successfully, open a new SQL editor tab and run the validation suite:

1. Open [`docs/kuro_phase9_validation.sql`](file:///f:/smart-pet-assistant-web/docs/kuro_phase9_validation.sql).
2. Copy and execute the queries sequentially.
3. Confirm the expected diagnostic values:
   - **Table Count:** Exactly 11 rows returned for Phase 9 tables.
   - **Privacy Defaults:** `activity_tracking_enabled`, `auto_reports_enabled`, `tracking_include_window_titles`, and `tracking_include_process_names` all default to `false`.
   - **Unassigned Tasks:** `unassigned_tasks_count = 0`.
   - **Workflow Columns:** Every board shows 5 columns: `backlog, todo, in_progress, done, cancelled`.
   - **RLS Forced Status:** 10 user tables show `rls_forced = true`, while `task_status_history` shows `rls_forced = false` with zero client INSERT policies.

---

## 5. Rollback Considerations

Because the Phase 9 migration is strictly **additive** (it introduces 11 new tables, 10 new columns on `public.tasks`, and 9 new columns on `public.user_preferences`), rolling back does **NOT** require dropping existing baseline tables.

### 5.1 Safe Application-Level Rollback (No Data Loss)
If client issues arise after migration:
1. Leave the database schema intact.
2. The existing application code continues to query baseline columns (`tasks.id`, `tasks.title`, `tasks.completed`, `tasks.category`, `tasks.priority`, etc.).
3. The new columns have default values and do not alter existing queries.

### 5.2 Trigger Deactivation (Temporary Decoupling)
If triggers need to be temporarily paused without dropping tables:
```sql
ALTER TABLE public.tasks DISABLE TRIGGER trg_validate_task_board_hierarchy;
ALTER TABLE public.tasks DISABLE TRIGGER trg_sync_task_status_and_completion;
ALTER TABLE public.tasks DISABLE TRIGGER trg_log_task_status_history;
ALTER TABLE public.time_entries DISABLE TRIGGER trg_validate_time_entry_interval;
ALTER TABLE public.time_entries DISABLE TRIGGER trg_sync_task_actual_duration;
ALTER TABLE public.time_entry_pauses DISABLE TRIGGER trg_validate_time_entry_pause;
ALTER TABLE public.time_entry_pauses DISABLE TRIGGER trg_sync_time_entry_duration_on_pause;
```

### 5.3 Complete Teardown (Destructive - Only If Data Not Retained)
Never execute destructive teardowns without an export of user-created Phase 9 records.
```sql
BEGIN;
DROP TABLE IF EXISTS public.daily_reports CASCADE;
DROP TABLE IF EXISTS public.pet_reaction_logs CASCADE;
DROP TABLE IF EXISTS public.computer_activity_events CASCADE;
DROP TABLE IF EXISTS public.time_entry_pauses CASCADE;
DROP TABLE IF EXISTS public.time_entries CASCADE;
DROP TABLE IF EXISTS public.task_status_history CASCADE;
DROP TABLE IF EXISTS public.task_label_assignments CASCADE;
DROP TABLE IF EXISTS public.task_labels CASCADE;
DROP TABLE IF EXISTS public.board_columns CASCADE;
DROP TABLE IF EXISTS public.project_boards CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_tasks_project;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_tasks_board;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_tasks_column;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS fk_tasks_parent_task;
COMMIT;
```

---

## 6. Known Limitations

1. **Local Execution Environment Block:** Runtime execution tests could not be executed locally due to the absence of an active PostgreSQL daemon on `localhost:5432` or accessible container daemon. The SQL migration has been verified via static analysis and syntax inspection.
2. **External Schedulers:** Schedulers (Daily Reports, Activity Retention Pruning, Stale Timer Recovery) require external runtime callers (Desktop Companion on port 48299, Supabase Edge Functions with `pg_cron`, or web dashboard JIT triggers).
3. **Cross-Account RLS Acceptance:** Complete end-to-end multi-tenant RLS testing requires two distinct authenticated Supabase test accounts.

