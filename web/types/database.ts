// Minimal hand-written Database types matching the migrations in supabase/.
// In a real project these would be generated via `supabase gen types typescript`.

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          initials: string;
          role: 'coach' | 'admin';
          avatar_color: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & {
          id: string; display_name: string; initials: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
      };
      students: {
        Row: {
          id: string;
          ghl_contact_id: string | null;
          email: string;
          first_name: string | null;
          last_name: string | null;
          mobile: string | null;
          membership: string | null;
          tags: string[];
          student_group: string | null;
          start_date: string | null;
          end_date: string | null;
          course_start_date: string | null;
          course_end_date: string | null;
          background: string | null;
          upgrade_flag: boolean;
          month_1: boolean; month_2: boolean; month_3: boolean;
          month_4: boolean; month_5: boolean; month_6: boolean;
          total_fee: number | null;
          down_payment: number | null;
          down_payment_date: string | null;
          created_at: string;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['students']['Row']> & { email: string };
        Update: Partial<Database['public']['Tables']['students']['Row']>;
      };
      call_logs: {
        Row: {
          id: string;
          student_id: string;
          coach_id: string;
          comment: string;
          outcome: 'connected' | 'no_answer' | 'rescheduled' | 'wrong_number' | null;
          next_action: string | null;
          next_action_due: string | null;
          voice_transcript: boolean;
          voice_audio_path: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['call_logs']['Row']> & {
          student_id: string; coach_id: string; comment: string;
        };
        Update: Partial<Database['public']['Tables']['call_logs']['Row']>;
      };
      emi_schedule: {
        Row: {
          id: string;
          student_id: string;
          installment_no: number;
          installments_total: number;
          amount: number;
          due_date: string;
          reminder_date: string;
          status: 'upcoming' | 'due_soon' | 'overdue' | 'paid' | 'cancelled';
          paid_date: string | null;
          payment_link: string | null;
          payment_mode: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['emi_schedule']['Row']> & {
          student_id: string; installment_no: number; installments_total: number;
          amount: number; due_date: string; reminder_date: string;
        };
        Update: Partial<Database['public']['Tables']['emi_schedule']['Row']>;
      };
      reminders: {
        Row: {
          id: string;
          event_id: string;
          emi_id: string | null;
          student_id: string | null;
          recipient_profile: string | null;
          ghl_workflow_id: string | null;
          ghl_contact_id: string | null;
          channel: 'whatsapp' | 'sms' | 'email' | null;
          payload: Record<string, unknown> | null;
          scheduled_at: string;
          fired_at: string | null;
          status: 'queued' | 'sent' | 'delivered' | 'failed' | 'cancelled';
          triggered_by: string | null;
          error: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['reminders']['Row']> & { event_id: string };
        Update: Partial<Database['public']['Tables']['reminders']['Row']>;
      };
      reminder_events: {
        Row: {
          id: string;
          name: string;
          recipient_type: 'student' | 'coach' | 'admin';
          default_workflow_id: string | null;
          schedule: string;
          enabled: boolean;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['reminder_events']['Row']> & {
          id: string; name: string; recipient_type: 'student' | 'coach' | 'admin'; schedule: string;
        };
        Update: Partial<Database['public']['Tables']['reminder_events']['Row']>;
      };
      student_briefings: {
        Row: {
          student_id: string;
          summary_md: string;
          generated_at: string;
          source_calls_count: number;
          source_max_call_at: string | null;
          is_stale: boolean;
          model: string | null;
          tokens_in: number | null;
          tokens_out: number | null;
        };
        Insert: Partial<Database['public']['Tables']['student_briefings']['Row']> & {
          student_id: string; summary_md: string;
        };
        Update: Partial<Database['public']['Tables']['student_briefings']['Row']>;
      };
      audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          entity: string;
          entity_id: string;
          action: 'create' | 'update' | 'delete';
          diff: Record<string, unknown> | null;
          at: string;
        };
        Insert: Partial<Database['public']['Tables']['audit_log']['Row']>;
        Update: Partial<Database['public']['Tables']['audit_log']['Row']>;
      };
      ghl_settings: {
        Row: {
          id: number;
          location_id: string | null;
          default_workflows: Record<string, unknown>;
          last_full_sync: string | null;
          updated_at: string;
          ghl_pit_token: string | null;
          openai_api_key: string | null;
          anthropic_api_key: string | null;
        };
        Insert: Partial<Database['public']['Tables']['ghl_settings']['Row']>;
        Update: Partial<Database['public']['Tables']['ghl_settings']['Row']>;
      };
    };
    Views: {
      v_emi_due_today:        { Row: any };
      v_emi_overdue:          { Row: any };
      v_students_silent_30d:  { Row: any };
      v_settings_status: {
        Row: {
          id: number;
          location_id: string | null;
          ghl_configured: boolean;
          openai_configured: boolean;
          anthropic_configured: boolean;
          ghl_last4: string;
          openai_last4: string;
          anthropic_last4: string;
          last_full_sync: string | null;
          updated_at: string;
        };
      };
    };
    Functions: { [k: string]: any };
    Enums: { [k: string]: any };
  };
};