/**
 * Kuro Companion — Database Type Definitions
 * Matches the deployed Supabase PostgreSQL schema for the 7 Kuro application tables.
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          theme?: 'dark' | 'light';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          theme?: 'dark' | 'light';
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
          playfulness: number;
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
          playfulness?: number;
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
          playfulness?: number;
          focus_discipline?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          category: 'work' | 'personal' | 'robot' | 'learning';
          priority: 'low' | 'medium' | 'high' | 'urgent';
          due_date?: string | null;
          due_time?: string | null;
          estimated_minutes?: number;
          completed?: boolean;
          tags?: string[];
          description?: string | null;
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
      [_ in never]: never;
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

export type UserProfileRow = Tables<'users'>;
export type UserPreferencesRow = Tables<'user_preferences'>;
export type PetSettingsRow = Tables<'pet_settings'>;
export type TaskRow = Tables<'tasks'>;
export type ReminderRow = Tables<'reminders'>;
export type RoutineRow = Tables<'routines'>;
export type UserMemoryRow = Tables<'user_memories'>;
export type WorkSessionRow = Tables<'work_sessions'>;
