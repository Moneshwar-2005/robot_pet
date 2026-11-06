/**
 * Kuro Companion — Database Type Definitions
 * Matches the deployed Supabase PostgreSQL schema for the Kuro application tables.
 * Includes baseline tables and Phase 9 tables with additive columns, foreign keys, and functions.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          theme: 'dark' | 'light';
          activity_tracking_enabled: boolean;
          idle_threshold_seconds: number;
          auto_reports_enabled: boolean;
          daily_report_time: string;
          telemetry_retention_days: number;
          tracking_include_window_titles: boolean;
          tracking_include_process_names: boolean;
          music_reaction_enabled: boolean;
          auto_break_reminders: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          theme?: 'dark' | 'light';
          activity_tracking_enabled?: boolean;
          idle_threshold_seconds?: number;
          auto_reports_enabled?: boolean;
          daily_report_time?: string;
          telemetry_retention_days?: number;
          tracking_include_window_titles?: boolean;
          tracking_include_process_names?: boolean;
          music_reaction_enabled?: boolean;
          auto_break_reminders?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          theme?: 'dark' | 'light';
          activity_tracking_enabled?: boolean;
          idle_threshold_seconds?: number;
          auto_reports_enabled?: boolean;
          daily_report_time?: string;
          telemetry_retention_days?: number;
          tracking_include_window_titles?: boolean;
          tracking_include_process_names?: boolean;
          music_reaction_enabled?: boolean;
          auto_break_reminders?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pet_settings: {
        Row: {
          id: string;
          user_id: string;
          pet_name: string;
          avatar_variant: string;
          eye_shape: 'curved' | 'round' | 'pixel';
          glow_color: 'cyan' | 'emerald' | 'amber' | 'violet';
          /** PostgreSQL integer percentage (0-100) */
          playfulness: number;
          /** PostgreSQL integer percentage (0-100) */
          focus_discipline: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          pet_name?: string;
          avatar_variant?: string;
          eye_shape?: 'curved' | 'round' | 'pixel';
          glow_color?: 'cyan' | 'emerald' | 'amber' | 'violet';
          /** PostgreSQL integer percentage (0-100) */
          playfulness?: number;
          /** PostgreSQL integer percentage (0-100) */
          focus_discipline?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          pet_name?: string;
          avatar_variant?: string;
          eye_shape?: 'curved' | 'round' | 'pixel';
          glow_color?: 'cyan' | 'emerald' | 'amber' | 'violet';
          /** PostgreSQL integer percentage (0-100) */
          playfulness?: number;
          /** PostgreSQL integer percentage (0-100) */
          focus_discipline?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          color: string;
          icon: string;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          color?: string;
          icon?: string;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          color?: string;
          icon?: string;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_boards: {
        Row: {
          id: string;
          user_id: string;
          project_id: string;
          name: string;
          description: string | null;
          board_type: 'kanban' | 'scrum';
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id: string;
          name: string;
          description?: string | null;
          board_type?: 'kanban' | 'scrum';
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          project_id?: string;
          name?: string;
          description?: string | null;
          board_type?: 'kanban' | 'scrum';
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_boards_project';
            columns: ['user_id', 'project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      board_columns: {
        Row: {
          id: string;
          user_id: string;
          board_id: string;
          name: string;
          status_category: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
          position: number;
          wip_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          board_id: string;
          name: string;
          status_category: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
          position?: number;
          wip_limit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          board_id?: string;
          name?: string;
          status_category?: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
          position?: number;
          wip_limit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_columns_board';
            columns: ['user_id', 'board_id'];
            isOneToOne: false;
            referencedRelation: 'project_boards';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          category: 'work' | 'personal' | 'robot' | 'learning';
          priority: 'low' | 'medium' | 'high' | 'urgent';
          due_date: string | null;
          due_time: string | null;
          estimated_minutes: number;
          completed: boolean;
          tags: string[];
          description: string | null;
          project_id: string | null;
          board_id: string | null;
          column_id: string | null;
          status: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
          position: number;
          parent_task_id: string | null;
          actual_duration_minutes: number;
          started_at: string | null;
          completed_at: string | null;
          status_updated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          category?: 'work' | 'personal' | 'robot' | 'learning';
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          due_date?: string | null;
          due_time?: string | null;
          estimated_minutes?: number;
          completed?: boolean;
          tags?: string[];
          description?: string | null;
          project_id?: string | null;
          board_id?: string | null;
          column_id?: string | null;
          status?: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
          position?: number;
          parent_task_id?: string | null;
          actual_duration_minutes?: number;
          started_at?: string | null;
          completed_at?: string | null;
          status_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          category?: 'work' | 'personal' | 'robot' | 'learning';
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          due_date?: string | null;
          due_time?: string | null;
          estimated_minutes?: number;
          completed?: boolean;
          tags?: string[];
          description?: string | null;
          project_id?: string | null;
          board_id?: string | null;
          column_id?: string | null;
          status?: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
          position?: number;
          parent_task_id?: string | null;
          actual_duration_minutes?: number;
          started_at?: string | null;
          completed_at?: string | null;
          status_updated_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_tasks_project';
            columns: ['user_id', 'project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_tasks_board';
            columns: ['user_id', 'board_id'];
            isOneToOne: false;
            referencedRelation: 'project_boards';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_tasks_column';
            columns: ['user_id', 'column_id'];
            isOneToOne: false;
            referencedRelation: 'board_columns';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_tasks_parent';
            columns: ['user_id', 'parent_task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      task_labels: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id?: string | null;
          name: string;
          color?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          project_id?: string | null;
          name?: string;
          color?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_task_labels_project';
            columns: ['user_id', 'project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      task_label_assignments: {
        Row: {
          user_id: string;
          task_id: string;
          label_id: string;
          assigned_at: string;
        };
        Insert: {
          user_id: string;
          task_id: string;
          label_id: string;
          assigned_at?: string;
        };
        Update: {
          user_id?: string;
          task_id?: string;
          label_id?: string;
          assigned_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_label_assign_task';
            columns: ['user_id', 'task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_label_assign_label';
            columns: ['user_id', 'label_id'];
            isOneToOne: false;
            referencedRelation: 'task_labels';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      task_status_history: {
        Row: {
          id: string;
          user_id: string;
          task_id: string;
          old_status: string | null;
          new_status: string;
          from_column_id: string | null;
          to_column_id: string | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id: string;
          old_status?: string | null;
          new_status: string;
          from_column_id?: string | null;
          to_column_id?: string | null;
          changed_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          task_id?: string;
          old_status?: string | null;
          new_status?: string;
          from_column_id?: string | null;
          to_column_id?: string | null;
          changed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_history_task';
            columns: ['user_id', 'task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_history_to_col';
            columns: ['user_id', 'to_column_id'];
            isOneToOne: false;
            referencedRelation: 'board_columns';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      time_entries: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          project_id: string | null;
          started_at: string;
          ended_at: string | null;
          active_duration_seconds: number;
          idle_duration_seconds: number;
          tracking_source: 'manual' | 'companion' | 'pomodoro';
          state: 'running' | 'paused' | 'completed' | 'quarantined';
          is_recovered: boolean;
          recovery_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          project_id?: string | null;
          started_at: string;
          ended_at?: string | null;
          active_duration_seconds?: number;
          idle_duration_seconds?: number;
          tracking_source?: 'manual' | 'companion' | 'pomodoro';
          state?: 'running' | 'paused' | 'completed' | 'quarantined';
          is_recovered?: boolean;
          recovery_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          task_id?: string | null;
          project_id?: string | null;
          started_at?: string;
          ended_at?: string | null;
          active_duration_seconds?: number;
          idle_duration_seconds?: number;
          tracking_source?: 'manual' | 'companion' | 'pomodoro';
          state?: 'running' | 'paused' | 'completed' | 'quarantined';
          is_recovered?: boolean;
          recovery_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_time_entry_task';
            columns: ['user_id', 'task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_time_entry_project';
            columns: ['user_id', 'project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      time_entry_pauses: {
        Row: {
          id: string;
          user_id: string;
          time_entry_id: string;
          paused_at: string;
          resumed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          time_entry_id: string;
          paused_at: string;
          resumed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          time_entry_id?: string;
          paused_at?: string;
          resumed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_pause_time_entry';
            columns: ['user_id', 'time_entry_id'];
            isOneToOne: false;
            referencedRelation: 'time_entries';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      time_entry_idles: {
        Row: {
          id: string;
          user_id: string;
          time_entry_id: string;
          started_at: string;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          time_entry_id: string;
          started_at: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          time_entry_id?: string;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_idle_time_entry';
            columns: ['user_id', 'time_entry_id'];
            isOneToOne: false;
            referencedRelation: 'time_entries';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      computer_activity_events: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          project_id: string | null;
          event_timestamp: string;
          duration_seconds: number;
          application_name: string;
          window_title: string | null;
          activity_category: string;
          is_idle: boolean;
          dedup_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          project_id?: string | null;
          event_timestamp?: string;
          duration_seconds: number;
          application_name: string;
          window_title?: string | null;
          activity_category?: string;
          is_idle?: boolean;
          dedup_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          task_id?: string | null;
          project_id?: string | null;
          event_timestamp?: string;
          duration_seconds?: number;
          application_name?: string;
          window_title?: string | null;
          activity_category?: string;
          is_idle?: boolean;
          dedup_hash?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_activity_task';
            columns: ['user_id', 'task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['user_id', 'id'];
          },
          {
            foreignKeyName: 'fk_activity_project';
            columns: ['user_id', 'project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      pet_reaction_logs: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          reaction_type: string;
          trigger_event: string;
          emotion_displayed: string;
          dialogue_text: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          reaction_type: string;
          trigger_event: string;
          emotion_displayed: string;
          dialogue_text?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          task_id?: string | null;
          reaction_type?: string;
          trigger_event?: string;
          emotion_displayed?: string;
          dialogue_text?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_reaction_task';
            columns: ['user_id', 'task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['user_id', 'id'];
          },
        ];
      };
      daily_reports: {
        Row: {
          id: string;
          user_id: string;
          report_date: string;
          total_focus_seconds: number;
          total_idle_seconds: number;
          tasks_completed_count: number;
          tasks_created_count: number;
          project_breakdown: Json;
          application_breakdown: Json;
          ai_narrative: string | null;
          actionable_suggestions: Json;
          generation_status: 'pending' | 'generating' | 'completed' | 'failed';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          report_date: string;
          total_focus_seconds?: number;
          total_idle_seconds?: number;
          tasks_completed_count?: number;
          tasks_created_count?: number;
          project_breakdown?: Json;
          application_breakdown?: Json;
          ai_narrative?: string | null;
          actionable_suggestions?: Json;
          generation_status?: 'pending' | 'generating' | 'completed' | 'failed';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          report_date?: string;
          total_focus_seconds?: number;
          total_idle_seconds?: number;
          tasks_completed_count?: number;
          tasks_created_count?: number;
          project_breakdown?: Json;
          application_breakdown?: Json;
          ai_narrative?: string | null;
          actionable_suggestions?: Json;
          generation_status?: 'pending' | 'generating' | 'completed' | 'failed';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reminders: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          remind_at: string;
          reminder_type: 'wellness' | 'task' | 'meeting' | 'pet-routine';
          priority: 'normal' | 'important';
          done: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          remind_at: string;
          reminder_type?: 'wellness' | 'task' | 'meeting' | 'pet-routine';
          priority?: 'normal' | 'important';
          done?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          remind_at?: string;
          reminder_type?: 'wellness' | 'task' | 'meeting' | 'pet-routine';
          priority?: 'normal' | 'important';
          done?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      routines: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          schedule_type: 'interval' | 'daily' | 'weekly' | 'custom';
          interval_minutes: number | null;
          schedule_time: string | null;
          days_of_week: number[] | null;
          timezone: string;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          schedule_type: 'interval' | 'daily' | 'weekly' | 'custom';
          interval_minutes?: number | null;
          schedule_time?: string | null;
          days_of_week?: number[] | null;
          timezone?: string;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          schedule_type?: 'interval' | 'daily' | 'weekly' | 'custom';
          interval_minutes?: number | null;
          schedule_time?: string | null;
          days_of_week?: number[] | null;
          timezone?: string;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_memories: {
        Row: {
          id: string;
          user_id: string;
          category: string;
          fact: string;
          confidence: number;
          source: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          category: string;
          fact: string;
          confidence?: number;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          category?: string;
          fact?: string;
          confidence?: number;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      work_sessions: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          title: string;
          session_type: 'focus' | 'break' | 'long_break';
          duration_minutes: number;
          started_at: string;
          completed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          title: string;
          session_type?: 'focus' | 'break' | 'long_break';
          duration_minutes: number;
          started_at: string;
          completed_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          task_id?: string | null;
          title?: string;
          session_type?: 'focus' | 'break' | 'long_break';
          duration_minutes?: number;
          started_at?: string;
          completed_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'work_sessions_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      fn_calculate_timer_active_multirange: {
        Args: {
          p_timer_id: string;
        };
        Returns: string;
      };
      fn_check_active_interval_conflict: {
        Args: {
          p_user_id: string;
          p_timer_id: string;
          p_candidate_range: unknown;
        };
        Returns: boolean;
      };
      purge_expired_activity_events: {
        Args: {
          p_user_id: string;
        };
        Returns: number;
      };
      reconcile_stale_time_entries: {
        Args: {
          p_max_age?: string;
        };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

// Baseline Table Helpers
export type UserProfileRow = Tables<'users'>;
export type UserPreferencesRow = Tables<'user_preferences'>;
export type PetSettingsRow = Tables<'pet_settings'>;
export type TaskRow = Tables<'tasks'>;
export type ReminderRow = Tables<'reminders'>;
export type RoutineRow = Tables<'routines'>;
export type UserMemoryRow = Tables<'user_memories'>;
export type WorkSessionRow = Tables<'work_sessions'>;

// Phase 9 New Table Helpers
export type ProjectRow = Tables<'projects'>;
export type ProjectBoardRow = Tables<'project_boards'>;
export type BoardColumnRow = Tables<'board_columns'>;
export type TaskLabelRow = Tables<'task_labels'>;
export type TaskLabelAssignmentRow = Tables<'task_label_assignments'>;
export type TaskStatusHistoryRow = Tables<'task_status_history'>;
export type TimeEntryRow = Tables<'time_entries'>;
export type TimeEntryPauseRow = Tables<'time_entry_pauses'>;
export type TimeEntryIdleRow = Tables<'time_entry_idles'>;
export type ComputerActivityEventRow = Tables<'computer_activity_events'>;
export type PetReactionLogRow = Tables<'pet_reaction_logs'>;
export type DailyReportRow = Tables<'daily_reports'>;
