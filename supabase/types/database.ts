export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          role: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          admin_user_id: string | null
          correlation_id: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          payload: Json
          reason: string | null
          target_id: string | null
          target_type: string
          updated_at: string
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          reason?: string | null
          target_id?: string | null
          target_type: string
          updated_at?: string
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          reason?: string | null
          target_id?: string | null
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_exchange_choices: {
        Row: {
          captured_at: string
          choice: boolean
          chooser_user_id: string
          created_at: string
          id: string
          linkup_id: string
          target_user_id: string
          updated_at: string
        }
        Insert: {
          captured_at?: string
          choice: boolean
          chooser_user_id: string
          created_at?: string
          id?: string
          linkup_id: string
          target_user_id: string
          updated_at?: string
        }
        Update: {
          captured_at?: string
          choice?: boolean
          chooser_user_id?: string
          created_at?: string
          id?: string
          linkup_id?: string
          target_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_exchange_choices_chooser_user_id_fkey"
            columns: ["chooser_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_exchange_choices_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_exchange_choices_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_exchange_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          linkup_id: string
          payload: Json
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          linkup_id: string
          payload?: Json
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          linkup_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "contact_exchange_events_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_exchanges: {
        Row: {
          created_at: string
          id: string
          linkup_id: string
          revealed_at: string
          updated_at: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          linkup_id: string
          revealed_at?: string
          updated_at?: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          created_at?: string
          id?: string
          linkup_id?: string
          revealed_at?: string
          updated_at?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_exchanges_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_exchanges_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_exchanges_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_events: {
        Row: {
          conversation_session_id: string
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string | null
          payload: Json
          profile_id: string | null
          step_token: string | null
          twilio_message_sid: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          conversation_session_id: string
          correlation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          profile_id?: string | null
          step_token?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          conversation_session_id?: string
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          profile_id?: string | null
          step_token?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_events_conversation_session_id_fkey"
            columns: ["conversation_session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_sessions: {
        Row: {
          created_at: string
          current_step_id: string | null
          dropout_nudge_sent_at: string | null
          expires_at: string | null
          id: string
          last_inbound_message_sid: string | null
          linkup_id: string | null
          mode: Database["public"]["Enums"]["conversation_mode"]
          state_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_step_id?: string | null
          dropout_nudge_sent_at?: string | null
          expires_at?: string | null
          id?: string
          last_inbound_message_sid?: string | null
          linkup_id?: string | null
          mode?: Database["public"]["Enums"]["conversation_mode"]
          state_token?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_step_id?: string | null
          dropout_nudge_sent_at?: string | null
          expires_at?: string | null
          id?: string
          last_inbound_message_sid?: string | null
          linkup_id?: string | null
          mode?: Database["public"]["Enums"]["conversation_mode"]
          state_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_sessions_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlement_events: {
        Row: {
          created_at: string
          entitlement_type: string
          event_type: string
          id: string
          idempotency_key: string
          metadata: Json
          occurred_at: string
          quantity: number | null
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entitlement_type: string
          event_type: string
          id?: string
          idempotency_key: string
          metadata?: Json
          occurred_at?: string
          quantity?: number | null
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entitlement_type?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          occurred_at?: string
          quantity?: number | null
          source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlement_ledger: {
        Row: {
          created_at: string
          entry_type: string
          id: string
          idempotency_key: string
          metadata: Json
          occurred_at: string
          quantity: number | null
          reason: string | null
          source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_type: string
          id?: string
          idempotency_key: string
          metadata?: Json
          occurred_at?: string
          quantity?: number | null
          reason?: string | null
          source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_type?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          occurred_at?: string
          quantity?: number | null
          reason?: string | null
          source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlement_overrides: {
        Row: {
          created_at: string
          created_by_admin_user_id: string | null
          effective_at: string
          expires_at: string | null
          id: string
          override_type: string
          updated_at: string
          user_id: string
          values: Json
        }
        Insert: {
          created_at?: string
          created_by_admin_user_id?: string | null
          effective_at?: string
          expires_at?: string | null
          id?: string
          override_type: string
          updated_at?: string
          user_id: string
          values?: Json
        }
        Update: {
          created_at?: string
          created_by_admin_user_id?: string | null
          effective_at?: string
          expires_at?: string | null
          id?: string
          override_type?: string
          updated_at?: string
          user_id?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          can_initiate_linkup: boolean
          can_participate_linkup: boolean
          can_receive_intro: boolean
          computed_at: string
          created_at: string
          expires_at: string | null
          id: string
          intro_credits_remaining: number
          linkup_credits_remaining: number
          source: Database["public"]["Enums"]["entitlement_source"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          can_initiate_linkup?: boolean
          can_participate_linkup?: boolean
          can_receive_intro?: boolean
          computed_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          intro_credits_remaining?: number
          linkup_credits_remaining?: number
          source?: Database["public"]["Enums"]["entitlement_source"]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          can_initiate_linkup?: boolean
          can_participate_linkup?: boolean
          can_receive_intro?: boolean
          computed_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          intro_credits_remaining?: number
          linkup_credits_remaining?: number
          source?: Database["public"]["Enums"]["entitlement_source"]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      keyword_rules: {
        Row: {
          action: Database["public"]["Enums"]["keyword_rule_action"]
          created_at: string
          hold_type: Database["public"]["Enums"]["safety_hold_type"] | null
          id: string
          is_active: boolean
          keyword: string
          match_type: Database["public"]["Enums"]["keyword_match_type"]
          metadata: Json
          response_template: string | null
          rule_set: string
          severity: string
          updated_at: string
          version: number
        }
        Insert: {
          action: Database["public"]["Enums"]["keyword_rule_action"]
          created_at?: string
          hold_type?: Database["public"]["Enums"]["safety_hold_type"] | null
          id?: string
          is_active?: boolean
          keyword: string
          match_type?: Database["public"]["Enums"]["keyword_match_type"]
          metadata?: Json
          response_template?: string | null
          rule_set?: string
          severity: string
          updated_at?: string
          version?: number
        }
        Update: {
          action?: Database["public"]["Enums"]["keyword_rule_action"]
          created_at?: string
          hold_type?: Database["public"]["Enums"]["safety_hold_type"] | null
          id?: string
          is_active?: boolean
          keyword?: string
          match_type?: Database["public"]["Enums"]["keyword_match_type"]
          metadata?: Json
          response_template?: string | null
          rule_set?: string
          severity?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      learning_jobs: {
        Row: {
          completed_at: string | null
          error_detail: string | null
          id: string
          params: Json
          run_key: string
          started_at: string
          status: Database["public"]["Enums"]["learning_job_status"]
        }
        Insert: {
          completed_at?: string | null
          error_detail?: string | null
          id?: string
          params?: Json
          run_key: string
          started_at?: string
          status?: Database["public"]["Enums"]["learning_job_status"]
        }
        Update: {
          completed_at?: string | null
          error_detail?: string | null
          id?: string
          params?: Json
          run_key?: string
          started_at?: string
          status?: Database["public"]["Enums"]["learning_job_status"]
        }
        Relationships: []
      }
      learning_signals: {
        Row: {
          counterparty_user_id: string | null
          id: string
          idempotency_key: string
          ingested_at: string
          meta: Json
          occurred_at: string
          signal_type: Database["public"]["Enums"]["learning_signal_type"]
          subject_id: string | null
          user_id: string
          value_bool: boolean | null
          value_num: number | null
          value_text: string | null
        }
        Insert: {
          counterparty_user_id?: string | null
          id?: string
          idempotency_key: string
          ingested_at?: string
          meta?: Json
          occurred_at: string
          signal_type: Database["public"]["Enums"]["learning_signal_type"]
          subject_id?: string | null
          user_id: string
          value_bool?: boolean | null
          value_num?: number | null
          value_text?: string | null
        }
        Update: {
          counterparty_user_id?: string | null
          id?: string
          idempotency_key?: string
          ingested_at?: string
          meta?: Json
          occurred_at?: string
          signal_type?: Database["public"]["Enums"]["learning_signal_type"]
          subject_id?: string | null
          user_id?: string
          value_bool?: boolean | null
          value_num?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_signals_counterparty_user_id_fkey"
            columns: ["counterparty_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      linkup_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          event_type: string
          from_state: string | null
          id: string
          idempotency_key: string | null
          linkup_id: string
          payload: Json
          to_state: string | null
          updated_at: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          event_type: string
          from_state?: string | null
          id?: string
          idempotency_key?: string | null
          linkup_id: string
          payload?: Json
          to_state?: string | null
          updated_at?: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          from_state?: string | null
          id?: string
          idempotency_key?: string | null
          linkup_id?: string
          payload?: Json
          to_state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkup_events_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
        ]
      }
      linkup_invites: {
        Row: {
          closed_at: string | null
          created_at: string
          expires_at: string | null
          explainability: Json
          id: string
          idempotency_key: string
          invited_user_id: string
          linkup_id: string
          offered_options: Json | null
          responded_at: string | null
          response_message_sid: string | null
          selected_option: string | null
          sent_at: string | null
          state: Database["public"]["Enums"]["invite_state"]
          status: Database["public"]["Enums"]["invite_state"] | null
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          expires_at?: string | null
          explainability?: Json
          id?: string
          idempotency_key: string
          invited_user_id: string
          linkup_id: string
          offered_options?: Json | null
          responded_at?: string | null
          response_message_sid?: string | null
          selected_option?: string | null
          sent_at?: string | null
          state?: Database["public"]["Enums"]["invite_state"]
          status?: Database["public"]["Enums"]["invite_state"] | null
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          expires_at?: string | null
          explainability?: Json
          id?: string
          idempotency_key?: string
          invited_user_id?: string
          linkup_id?: string
          offered_options?: Json | null
          responded_at?: string | null
          response_message_sid?: string | null
          selected_option?: string | null
          sent_at?: string | null
          state?: Database["public"]["Enums"]["invite_state"]
          status?: Database["public"]["Enums"]["invite_state"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkup_invites_invited_user_id_fkey"
            columns: ["invited_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkup_invites_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
        ]
      }
      linkup_members: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          left_at: string | null
          linkup_id: string
          role: Database["public"]["Enums"]["linkup_member_role"]
          status: Database["public"]["Enums"]["linkup_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          linkup_id: string
          role: Database["public"]["Enums"]["linkup_member_role"]
          status?: Database["public"]["Enums"]["linkup_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          linkup_id?: string
          role?: Database["public"]["Enums"]["linkup_member_role"]
          status?: Database["public"]["Enums"]["linkup_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkup_members_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkup_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      linkup_outcomes: {
        Row: {
          attendance_result: string | null
          attendance_response: string | null
          created_at: string
          do_again: boolean | null
          feedback: string | null
          id: string
          linkup_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attendance_result?: string | null
          attendance_response?: string | null
          created_at?: string
          do_again?: boolean | null
          feedback?: string | null
          id?: string
          linkup_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attendance_result?: string | null
          attendance_response?: string | null
          created_at?: string
          do_again?: boolean | null
          feedback?: string | null
          id?: string
          linkup_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkup_outcomes_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkup_outcomes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      linkup_participants: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          left_at: string | null
          linkup_id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          linkup_id: string
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          linkup_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkup_participants_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkup_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      linkups: {
        Row: {
          acceptance_window_ends_at: string | null
          brief: Json
          canceled_reason: string | null
          correlation_id: string | null
          created_at: string
          event_time: string | null
          id: string
          initiator_user_id: string | null
          linkup_create_key: string
          lock_version: number
          locked_at: string | null
          max_size: number
          min_size: number
          region_id: string
          scheduled_at: string | null
          state: Database["public"]["Enums"]["linkup_state"]
          updated_at: string
          venue: Json | null
        }
        Insert: {
          acceptance_window_ends_at?: string | null
          brief: Json
          canceled_reason?: string | null
          correlation_id?: string | null
          created_at?: string
          event_time?: string | null
          id?: string
          initiator_user_id?: string | null
          linkup_create_key: string
          lock_version?: number
          locked_at?: string | null
          max_size?: number
          min_size?: number
          region_id: string
          scheduled_at?: string | null
          state?: Database["public"]["Enums"]["linkup_state"]
          updated_at?: string
          venue?: Json | null
        }
        Update: {
          acceptance_window_ends_at?: string | null
          brief?: Json
          canceled_reason?: string | null
          correlation_id?: string | null
          created_at?: string
          event_time?: string | null
          id?: string
          initiator_user_id?: string | null
          linkup_create_key?: string
          lock_version?: number
          locked_at?: string | null
          max_size?: number
          min_size?: number
          region_id?: string
          scheduled_at?: string | null
          state?: Database["public"]["Enums"]["linkup_state"]
          updated_at?: string
          venue?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "linkups_initiator_user_id_fkey"
            columns: ["initiator_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkups_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      match_candidates: {
        Row: {
          candidate_profile_id: string | null
          candidate_user_id: string
          component_scores: Json
          created_at: string
          explainability: Json
          final_score: number | null
          id: string
          match_run_id: string
          mode: Database["public"]["Enums"]["match_mode"]
          passed_hard_filters: boolean
          subject_profile_id: string | null
          subject_user_id: string
          updated_at: string
        }
        Insert: {
          candidate_profile_id?: string | null
          candidate_user_id: string
          component_scores?: Json
          created_at?: string
          explainability?: Json
          final_score?: number | null
          id?: string
          match_run_id: string
          mode: Database["public"]["Enums"]["match_mode"]
          passed_hard_filters?: boolean
          subject_profile_id?: string | null
          subject_user_id: string
          updated_at?: string
        }
        Update: {
          candidate_profile_id?: string | null
          candidate_user_id?: string
          component_scores?: Json
          created_at?: string
          explainability?: Json
          final_score?: number | null
          id?: string
          match_run_id?: string
          mode?: Database["public"]["Enums"]["match_mode"]
          passed_hard_filters?: boolean
          subject_profile_id?: string | null
          subject_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_candidates_candidate_profile_id_fkey"
            columns: ["candidate_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_candidate_user_id_fkey"
            columns: ["candidate_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_match_run_id_fkey"
            columns: ["match_run_id"]
            isOneToOne: false
            referencedRelation: "match_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_subject_profile_id_fkey"
            columns: ["subject_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_candidates_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_detail: string | null
          id: string
          mode: Database["public"]["Enums"]["match_mode"]
          params: Json
          region_id: string | null
          run_key: string
          status: Database["public"]["Enums"]["match_run_status"]
          subject_user_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          mode: Database["public"]["Enums"]["match_mode"]
          params?: Json
          region_id?: string | null
          run_key: string
          status?: Database["public"]["Enums"]["match_run_status"]
          subject_user_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["match_mode"]
          params?: Json
          region_id?: string | null
          run_key?: string
          status?: Database["public"]["Enums"]["match_run_status"]
          subject_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_runs_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_runs_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_sessions: {
        Row: {
          attempts: number
          created_at: string
          expires_at: string
          id: string
          otp_hash: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          expires_at: string
          id?: string
          otp_hash: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "otp_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_compatibility_scores: {
        Row: {
          a_hash: string
          b_hash: string
          breakdown_json: Json
          computed_at: string
          id: string
          score_total: number
          score_version: string
          updated_at: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          a_hash: string
          b_hash: string
          breakdown_json?: Json
          computed_at?: string
          id?: string
          score_total: number
          score_version: string
          updated_at?: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          a_hash?: string
          b_hash?: string
          breakdown_json?: Json
          computed_at?: string
          id?: string
          score_total?: number
          score_version?: string
          updated_at?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_compatibility_scores_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_compatibility_scores_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_compatibility_signals: {
        Row: {
          availability_vector: number[]
          content_hash: string
          created_at: string
          id: string
          intent_vector: number[]
          interest_vector: number[]
          metadata: Json
          normalization_version: string
          profile_id: string
          source_profile_completed_at: string | null
          source_profile_state: Database["public"]["Enums"]["profile_state"]
          source_profile_updated_at: string
          trait_vector: number[]
          updated_at: string
          user_id: string
        }
        Insert: {
          availability_vector: number[]
          content_hash: string
          created_at?: string
          id?: string
          intent_vector: number[]
          interest_vector: number[]
          metadata?: Json
          normalization_version: string
          profile_id: string
          source_profile_completed_at?: string | null
          source_profile_state: Database["public"]["Enums"]["profile_state"]
          source_profile_updated_at: string
          trait_vector: number[]
          updated_at?: string
          user_id: string
        }
        Update: {
          availability_vector?: number[]
          content_hash?: string
          created_at?: string
          id?: string
          intent_vector?: number[]
          interest_vector?: number[]
          metadata?: Json
          normalization_version?: string
          profile_id?: string
          source_profile_completed_at?: string | null
          source_profile_state?: Database["public"]["Enums"]["profile_state"]
          source_profile_updated_at?: string
          trait_vector?: number[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_compatibility_signals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_compatibility_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_entitlements: {
        Row: {
          can_exchange_contact: boolean
          can_initiate: boolean
          can_participate: boolean
          created_at: string
          id: string
          profile_id: string
          reason: string | null
          region_override: boolean
          safety_override: boolean
          updated_at: string
          updated_by: string | null
          waitlist_override: boolean
        }
        Insert: {
          can_exchange_contact?: boolean
          can_initiate?: boolean
          can_participate?: boolean
          created_at?: string
          id?: string
          profile_id: string
          reason?: string | null
          region_override?: boolean
          safety_override?: boolean
          updated_at?: string
          updated_by?: string | null
          waitlist_override?: boolean
        }
        Update: {
          can_exchange_contact?: boolean
          can_initiate?: boolean
          can_participate?: boolean
          created_at?: string
          id?: string
          profile_id?: string
          reason?: string | null
          region_override?: boolean
          safety_override?: boolean
          updated_at?: string
          updated_by?: string | null
          waitlist_override?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profile_entitlements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_entitlements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_events: {
        Row: {
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          payload: Json
          profile_id: string
          source: string
          step_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          payload: Json
          profile_id: string
          source: string
          step_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          payload?: Json
          profile_id?: string
          source?: string
          step_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_region_assignments: {
        Row: {
          assigned_at: string
          assignment_source: string
          created_at: string
          id: string
          profile_id: string
          region_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assignment_source: string
          created_at?: string
          id?: string
          profile_id: string
          region_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assignment_source?: string
          created_at?: string
          id?: string
          profile_id?: string
          region_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_region_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_region_assignments_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_intent: Json | null
          activity_patterns: Json
          boundaries: Json
          completed_at: string | null
          completeness_percent: number
          country_code: string | null
          created_at: string
          fingerprint: Json
          id: string
          is_complete_mvp: boolean
          last_interview_step: string | null
          preferences: Json
          stale_at: string | null
          state: Database["public"]["Enums"]["profile_state"]
          state_changed_at: string
          state_code: string | null
          status_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_intent?: Json | null
          activity_patterns?: Json
          boundaries?: Json
          completed_at?: string | null
          completeness_percent?: number
          country_code?: string | null
          created_at?: string
          fingerprint?: Json
          id?: string
          is_complete_mvp?: boolean
          last_interview_step?: string | null
          preferences?: Json
          stale_at?: string | null
          state?: Database["public"]["Enums"]["profile_state"]
          state_changed_at?: string
          state_code?: string | null
          status_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_intent?: Json | null
          activity_patterns?: Json
          boundaries?: Json
          completed_at?: string | null
          completeness_percent?: number
          country_code?: string | null
          created_at?: string
          fingerprint?: Json
          id?: string
          is_complete_mvp?: boolean
          last_interview_step?: string | null
          preferences?: Json
          stale_at?: string | null
          state?: Database["public"]["Enums"]["profile_state"]
          state_changed_at?: string
          state_code?: string | null
          status_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      region_memberships: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          region_id: string
          released_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          region_id: string
          released_at?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          region_id?: string
          released_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "region_memberships_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "region_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          country_code: string
          created_at: string
          display_name: string
          geometry: Json
          id: string
          is_active: boolean
          is_launch_region: boolean
          name: string
          rules: Json
          slug: string
          state: Database["public"]["Enums"]["region_state"]
          state_code: string | null
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          display_name: string
          geometry?: Json
          id?: string
          is_active?: boolean
          is_launch_region?: boolean
          name: string
          rules?: Json
          slug: string
          state?: Database["public"]["Enums"]["region_state"]
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          display_name?: string
          geometry?: Json
          id?: string
          is_active?: boolean
          is_launch_region?: boolean
          name?: string
          rules?: Json
          slug?: string
          state?: Database["public"]["Enums"]["region_state"]
          state_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      safety_holds: {
        Row: {
          created_at: string
          created_by_admin_id: string | null
          expires_at: string | null
          hold_type: Database["public"]["Enums"]["safety_hold_type"]
          id: string
          idempotency_key: string | null
          reason: string | null
          status: Database["public"]["Enums"]["safety_hold_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_admin_id?: string | null
          expires_at?: string | null
          hold_type: Database["public"]["Enums"]["safety_hold_type"]
          id?: string
          idempotency_key?: string | null
          reason?: string | null
          status?: Database["public"]["Enums"]["safety_hold_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_admin_id?: string | null
          expires_at?: string | null
          hold_type?: Database["public"]["Enums"]["safety_hold_type"]
          id?: string
          idempotency_key?: string | null
          reason?: string | null
          status?: Database["public"]["Enums"]["safety_hold_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_holds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_incidents: {
        Row: {
          assigned_admin_id: string | null
          category: string
          created_at: string
          description: string | null
          id: string
          idempotency_key: string | null
          incident_type: string | null
          linkup_id: string | null
          message_id: string | null
          reporter_user_id: string | null
          resolution: Json | null
          severity: string
          status: Database["public"]["Enums"]["safety_incident_status"]
          subject_user_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_admin_id?: string | null
          category: string
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string | null
          incident_type?: string | null
          linkup_id?: string | null
          message_id?: string | null
          reporter_user_id?: string | null
          resolution?: Json | null
          severity: string
          status?: Database["public"]["Enums"]["safety_incident_status"]
          subject_user_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_admin_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          idempotency_key?: string | null
          incident_type?: string | null
          linkup_id?: string | null
          message_id?: string | null
          reporter_user_id?: string | null
          resolution?: Json | null
          severity?: string
          status?: Database["public"]["Enums"]["safety_incident_status"]
          subject_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_incidents_linkup_id_fkey"
            columns: ["linkup_id"]
            isOneToOne: false
            referencedRelation: "linkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "sms_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          body_ciphertext: string | null
          body_iv: string | null
          body_tag: string | null
          correlation_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["sms_direction"]
          from_e164: string
          id: string
          key_version: number
          last_status_at: string | null
          media_count: number
          profile_id: string | null
          status: string | null
          to_e164: string
          twilio_message_sid: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body_ciphertext?: string | null
          body_iv?: string | null
          body_tag?: string | null
          correlation_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["sms_direction"]
          from_e164: string
          id?: string
          key_version?: number
          last_status_at?: string | null
          media_count?: number
          profile_id?: string | null
          status?: string | null
          to_e164: string
          twilio_message_sid?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body_ciphertext?: string | null
          body_iv?: string | null
          body_tag?: string | null
          correlation_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["sms_direction"]
          from_e164?: string
          id?: string
          key_version?: number
          last_status_at?: string | null
          media_count?: number
          profile_id?: string | null
          status?: string | null
          to_e164?: string
          twilio_message_sid?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_opt_outs: {
        Row: {
          created_at: string
          opted_out_at: string
          phone_e164: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          opted_out_at?: string
          phone_e164: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          opted_out_at?: string
          phone_e164?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_outbound_jobs: {
        Row: {
          attempts: number
          body_ciphertext: string | null
          body_iv: string | null
          body_tag: string | null
          correlation_id: string | null
          created_at: string
          from_e164: string | null
          id: string
          idempotency_key: string
          key_version: number
          last_error: string | null
          last_status_at: string | null
          next_attempt_at: string | null
          purpose: string
          run_at: string | null
          status: Database["public"]["Enums"]["job_state"]
          to_e164: string
          twilio_message_sid: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          body_ciphertext?: string | null
          body_iv?: string | null
          body_tag?: string | null
          correlation_id?: string | null
          created_at?: string
          from_e164?: string | null
          id?: string
          idempotency_key: string
          key_version?: number
          last_error?: string | null
          last_status_at?: string | null
          next_attempt_at?: string | null
          purpose: string
          run_at?: string | null
          status?: Database["public"]["Enums"]["job_state"]
          to_e164: string
          twilio_message_sid?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          body_ciphertext?: string | null
          body_iv?: string | null
          body_tag?: string | null
          correlation_id?: string | null
          created_at?: string
          from_e164?: string | null
          id?: string
          idempotency_key?: string
          key_version?: number
          last_error?: string | null
          last_status_at?: string | null
          next_attempt_at?: string | null
          purpose?: string
          run_at?: string | null
          status?: Database["public"]["Enums"]["job_state"]
          to_e164?: string
          twilio_message_sid?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_outbound_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_status_callbacks: {
        Row: {
          error_code: string | null
          error_message: string | null
          id: string
          message_sid: string
          message_status: string
          payload_fingerprint: string
          provider_event_at: string | null
          received_at: string
          sms_message_id: string | null
        }
        Insert: {
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_sid: string
          message_status: string
          payload_fingerprint: string
          provider_event_at?: string | null
          received_at?: string
          sms_message_id?: string | null
        }
        Update: {
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_sid?: string
          message_status?: string
          payload_fingerprint?: string
          provider_event_at?: string | null
          received_at?: string
          sms_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_status_callbacks_sms_message_id_fkey"
            columns: ["sms_message_id"]
            isOneToOne: false
            referencedRelation: "sms_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          created_at: string
          event_created_at: string
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          processing_error: string | null
          received_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_created_at: string
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_user_id: string
          blocker_user_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          blocked_user_id: string
          blocker_user_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          blocked_user_id?: string
          blocker_user_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_user_id_fkey"
            columns: ["blocked_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_user_id_fkey"
            columns: ["blocker_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_derived_state: {
        Row: {
          activity_weight_overrides: Json
          novelty_tags: Json
          rel_score: number
          time_window_overrides: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          activity_weight_overrides?: Json
          novelty_tags?: Json
          rel_score?: number
          time_window_overrides?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          activity_weight_overrides?: Json
          novelty_tags?: Json
          rel_score?: number
          time_window_overrides?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_derived_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          idempotency_key: string | null
          reason_category: string
          reporter_user_id: string | null
          subject_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          idempotency_key?: string | null
          reason_category: string
          reporter_user_id?: string | null
          subject_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          idempotency_key?: string | null
          reason_category?: string
          reporter_user_id?: string | null
          subject_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_strikes: {
        Row: {
          created_at: string
          id: string
          points: number
          reason: string | null
          strike_type: string
          updated_at: string
          user_id: string
          window_end: string
          window_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          points: number
          reason?: string | null
          strike_type: string
          updated_at?: string
          user_id: string
          window_end: string
          window_start: string
        }
        Update: {
          created_at?: string
          id?: string
          points?: number
          reason?: string | null
          strike_type?: string
          updated_at?: string
          user_id?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_strikes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          age_consent: boolean
          birthday: string
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string
          phone_e164: string
          phone_hash: string
          privacy_consent: boolean
          region_id: string | null
          sms_consent: boolean
          state: Database["public"]["Enums"]["user_state"]
          suspended_at: string | null
          terms_consent: boolean
          updated_at: string
        }
        Insert: {
          age_consent: boolean
          birthday: string
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          phone_e164: string
          phone_hash: string
          privacy_consent: boolean
          region_id?: string | null
          sms_consent: boolean
          state?: Database["public"]["Enums"]["user_state"]
          suspended_at?: string | null
          terms_consent: boolean
          updated_at?: string
        }
        Update: {
          age_consent?: boolean
          birthday?: string
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          phone_e164?: string
          phone_hash?: string
          privacy_consent?: boolean
          region_id?: string | null
          sms_consent?: boolean
          state?: Database["public"]["Enums"]["user_state"]
          suspended_at?: string | null
          terms_consent?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_region_fk"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          joined_at: string
          last_notified_at: string | null
          notified_at: string | null
          onboarded_at: string | null
          profile_id: string
          reason: string | null
          region_id: string
          source: string
          status: Database["public"]["Enums"]["waitlist_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          last_notified_at?: string | null
          notified_at?: string | null
          onboarded_at?: string | null
          profile_id: string
          reason?: string | null
          region_id: string
          source?: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          last_notified_at?: string | null
          notified_at?: string | null
          onboarded_at?: string | null
          profile_id?: string
          reason?: string | null
          region_id?: string
          source?: string
          status?: Database["public"]["Enums"]["waitlist_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      capture_post_event_do_again: {
        Args: {
          p_correlation_id?: string
          p_do_again: string
          p_inbound_message_id: string
          p_inbound_message_sid: string
          p_user_id: string
        }
        Returns: {
          attendance_result: string
          correlation_id: string
          do_again: string
          duplicate: boolean
          learning_signal_written: boolean
          linkup_id: string
          mode: Database["public"]["Enums"]["conversation_mode"]
          next_state_token: string
          previous_state_token: string
          reason: string
          session_id: string
        }[]
      }
      capture_post_event_attendance: {
        Args: {
          p_attendance_result: string
          p_correlation_id?: string
          p_inbound_message_id: string
          p_inbound_message_sid: string
          p_user_id: string
        }
        Returns: {
          attendance_result: string
          correlation_id: string
          duplicate: boolean
          linkup_id: string
          mode: Database["public"]["Enums"]["conversation_mode"]
          next_state_token: string
          previous_state_token: string
          reason: string
          session_id: string
        }[]
      }
      claim_sms_outbound_jobs: {
        Args: { lease_seconds?: number; max_jobs: number; now_ts?: string }
        Returns: {
          attempts: number
          body_ciphertext: string | null
          body_iv: string | null
          body_tag: string | null
          correlation_id: string | null
          created_at: string
          from_e164: string | null
          id: string
          idempotency_key: string
          key_version: number
          last_error: string | null
          last_status_at: string | null
          next_attempt_at: string | null
          purpose: string
          run_at: string | null
          status: Database["public"]["Enums"]["job_state"]
          to_e164: string
          twilio_message_sid: string | null
          updated_at: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sms_outbound_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      decrypt_sms_body: {
        Args: { ciphertext: string; key: string }
        Returns: string
      }
      encrypt_sms_body: {
        Args: { key: string; plaintext: string }
        Returns: string
      }
      is_admin_user: { Args: never; Returns: boolean }
      is_linkup_visible_to_current_user: {
        Args: { linkup_uuid: string }
        Returns: boolean
      }
      owns_profile: { Args: { profile_uuid: string }; Returns: boolean }
    }
    Enums: {
      conversation_mode:
        | "idle"
        | "interviewing"
        | "linkup_forming"
        | "awaiting_invite_reply"
        | "post_event"
        | "safety_hold"
      entitlement_source: "stripe" | "admin_override" | "reconciled"
      invite_state: "pending" | "accepted" | "declined" | "expired" | "closed"
      job_state: "pending" | "sending" | "sent" | "failed" | "canceled"
      keyword_match_type: "exact" | "contains" | "regex"
      keyword_rule_action: "flag" | "hold" | "block" | "crisis_route"
      learning_job_status: "started" | "completed" | "failed"
      learning_signal_type:
        | "linkup_attendance_attended"
        | "linkup_attendance_no_show"
        | "linkup_attendance_unsure"
        | "linkup_do_again_yes"
        | "linkup_do_again_no"
        | "linkup_do_again_unsure"
        | "linkup_feedback_text"
        | "contact_exchange_mutual_yes"
        | "contact_exchange_declined"
        | "match_preview_accepted"
        | "match_preview_rejected"
        | "match_preview_expired"
        | "user_blocked_other"
        | "user_reported_other"
      linkup_member_role: "initiator" | "participant"
      linkup_member_status:
        | "confirmed"
        | "canceled"
        | "no_show"
        | "attended"
        | "left"
      linkup_state:
        | "draft"
        | "broadcasting"
        | "locked"
        | "completed"
        | "expired"
        | "canceled"
      match_mode: "one_to_one" | "linkup"
      match_run_status: "started" | "completed" | "failed"
      profile_state:
        | "empty"
        | "partial"
        | "complete_mvp"
        | "complete_full"
        | "stale"
      region_state: "open" | "waitlisted" | "closed"
      safety_hold_status: "active" | "lifted" | "expired"
      safety_hold_type:
        | "match_hold"
        | "linkup_hold"
        | "contact_hold"
        | "global_hold"
      safety_incident_status: "open" | "triaged" | "resolved" | "escalated"
      sms_direction: "in" | "out"
      subscription_state:
        | "none"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid"
      user_state:
        | "unverified"
        | "verified"
        | "interviewing"
        | "active"
        | "suspended"
        | "deleted"
      waitlist_status:
        | "waiting"
        | "onboarded"
        | "notified"
        | "activated"
        | "removed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      conversation_mode: [
        "idle",
        "interviewing",
        "linkup_forming",
        "awaiting_invite_reply",
        "post_event",
        "safety_hold",
      ],
      entitlement_source: ["stripe", "admin_override", "reconciled"],
      invite_state: ["pending", "accepted", "declined", "expired", "closed"],
      job_state: ["pending", "sending", "sent", "failed", "canceled"],
      keyword_match_type: ["exact", "contains", "regex"],
      keyword_rule_action: ["flag", "hold", "block", "crisis_route"],
      learning_job_status: ["started", "completed", "failed"],
      learning_signal_type: [
        "linkup_attendance_attended",
        "linkup_attendance_no_show",
        "linkup_attendance_unsure",
        "linkup_do_again_yes",
        "linkup_do_again_no",
        "linkup_do_again_unsure",
        "linkup_feedback_text",
        "contact_exchange_mutual_yes",
        "contact_exchange_declined",
        "match_preview_accepted",
        "match_preview_rejected",
        "match_preview_expired",
        "user_blocked_other",
        "user_reported_other",
      ],
      linkup_member_role: ["initiator", "participant"],
      linkup_member_status: [
        "confirmed",
        "canceled",
        "no_show",
        "attended",
        "left",
      ],
      linkup_state: [
        "draft",
        "broadcasting",
        "locked",
        "completed",
        "expired",
        "canceled",
      ],
      match_mode: ["one_to_one", "linkup"],
      match_run_status: ["started", "completed", "failed"],
      profile_state: [
        "empty",
        "partial",
        "complete_mvp",
        "complete_full",
        "stale",
      ],
      region_state: ["open", "waitlisted", "closed"],
      safety_hold_status: ["active", "lifted", "expired"],
      safety_hold_type: [
        "match_hold",
        "linkup_hold",
        "contact_hold",
        "global_hold",
      ],
      safety_incident_status: ["open", "triaged", "resolved", "escalated"],
      sms_direction: ["in", "out"],
      subscription_state: [
        "none",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
      ],
      user_state: [
        "unverified",
        "verified",
        "interviewing",
        "active",
        "suspended",
        "deleted",
      ],
      waitlist_status: [
        "waiting",
        "onboarded",
        "notified",
        "activated",
        "removed",
      ],
    },
  },
} as const
