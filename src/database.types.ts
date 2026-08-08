export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.15" };
  public: {
    Tables: {
      app_users: {
        Row: { created_at: string; user_id: string };
        Insert: { created_at?: string; user_id: string };
        Update: { created_at?: string; user_id?: string };
        Relationships: [];
      };
      crawl_runs: {
        Row: {
          error: string | null;
          finished_at: string | null;
          id: string;
          jobs_discovered: number;
          jobs_hydrated: number;
          mode: string;
          new_source_jobs: number;
          pages_fetched: number;
          source: string;
          started_at: string;
          status: string;
        };
        Insert: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          jobs_discovered?: number;
          jobs_hydrated?: number;
          mode?: string;
          new_source_jobs?: number;
          pages_fetched?: number;
          source: string;
          started_at?: string;
          status?: string;
        };
        Update: {
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          jobs_discovered?: number;
          jobs_hydrated?: number;
          mode?: string;
          new_source_jobs?: number;
          pages_fetched?: number;
          source?: string;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          canonical_url: string;
          company: string | null;
          description: string | null;
          fingerprint: string;
          first_seen_at: string;
          id: string;
          instant_alert_sent_at: string | null;
          last_seen_at: string;
          location: string | null;
          matched_rules: string[];
          negative_rules: string[];
          published_at: string | null;
          relevance_tier: string;
          remote_mode: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          canonical_url: string;
          company?: string | null;
          description?: string | null;
          fingerprint: string;
          first_seen_at?: string;
          id?: string;
          instant_alert_sent_at?: string | null;
          last_seen_at?: string;
          location?: string | null;
          matched_rules?: string[];
          negative_rules?: string[];
          published_at?: string | null;
          relevance_tier: string;
          remote_mode?: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          canonical_url?: string;
          company?: string | null;
          description?: string | null;
          fingerprint?: string;
          first_seen_at?: string;
          id?: string;
          instant_alert_sent_at?: string | null;
          last_seen_at?: string;
          location?: string | null;
          matched_rules?: string[];
          negative_rules?: string[];
          published_at?: string | null;
          relevance_tier?: string;
          remote_mode?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      monitored_companies: {
        Row: {
          adapter_key: string | null;
          careers_url: string;
          consecutive_failures: number;
          created_at: string;
          detected_adapter: string | null;
          enabled: boolean;
          id: string;
          last_checked_at: string | null;
          last_error: string | null;
          last_success_at: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          adapter_key?: string | null;
          careers_url: string;
          consecutive_failures?: number;
          created_at?: string;
          detected_adapter?: string | null;
          enabled?: boolean;
          id?: string;
          last_checked_at?: string | null;
          last_error?: string | null;
          last_success_at?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          adapter_key?: string | null;
          careers_url?: string;
          consecutive_failures?: number;
          created_at?: string;
          detected_adapter?: string | null;
          enabled?: boolean;
          id?: string;
          last_checked_at?: string | null;
          last_error?: string | null;
          last_success_at?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notification_deliveries: {
        Row: {
          attempts: number;
          created_at: string;
          delivered_at: string | null;
          delivery_type: string;
          error: string | null;
          id: string;
          idempotency_key: string;
          job_id: string | null;
          payload: Json;
          status: string;
          telegram_message_id: string | null;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          delivered_at?: string | null;
          delivery_type: string;
          error?: string | null;
          id?: string;
          idempotency_key: string;
          job_id?: string | null;
          payload?: Json;
          status?: string;
          telegram_message_id?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          delivered_at?: string | null;
          delivery_type?: string;
          error?: string | null;
          id?: string;
          idempotency_key?: string;
          job_id?: string | null;
          payload?: Json;
          status?: string;
          telegram_message_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          created_at: string;
          job_id: string;
          note: string | null;
          state: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          job_id: string;
          note?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          job_id?: string;
          note?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      source_configs: {
        Row: {
          consecutive_failures: number;
          enabled: boolean;
          interval_minutes: number;
          last_success_at: string | null;
          paused_reason: string | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          consecutive_failures?: number;
          enabled?: boolean;
          interval_minutes: number;
          last_success_at?: string | null;
          paused_reason?: string | null;
          source: string;
          updated_at?: string;
        };
        Update: {
          consecutive_failures?: number;
          enabled?: boolean;
          interval_minutes?: number;
          last_success_at?: string | null;
          paused_reason?: string | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      source_jobs: {
        Row: {
          company: string | null;
          company_id: string | null;
          content_hash: string | null;
          first_seen_at: string;
          job_id: string | null;
          last_checked_at: string | null;
          last_seen_at: string;
          location: string | null;
          published_at: string | null;
          raw_data: Json;
          snippet: string | null;
          source: string;
          source_id: string;
          status: string;
          title: string;
          url: string;
        };
        Insert: {
          company?: string | null;
          company_id?: string | null;
          content_hash?: string | null;
          first_seen_at?: string;
          job_id?: string | null;
          last_checked_at?: string | null;
          last_seen_at?: string;
          location?: string | null;
          published_at?: string | null;
          raw_data?: Json;
          snippet?: string | null;
          source: string;
          source_id: string;
          status?: string;
          title: string;
          url: string;
        };
        Update: {
          company?: string | null;
          company_id?: string | null;
          content_hash?: string | null;
          first_seen_at?: string;
          job_id?: string | null;
          last_checked_at?: string | null;
          last_seen_at?: string;
          location?: string | null;
          published_at?: string | null;
          raw_data?: Json;
          snippet?: string | null;
          source?: string;
          source_id?: string;
          status?: string;
          title?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_jobs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "monitored_companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "source_jobs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
