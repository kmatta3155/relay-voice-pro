export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          created_at: string | null
          customer: string
          end: string | null
          end_at: string
          id: string
          staff: string | null
          start: string | null
          start_at: string
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string | null
          customer: string
          end?: string | null
          end_at: string
          id?: string
          staff?: string | null
          start?: string | null
          start_at: string
          tenant_id: string
          title: string
        }
        Update: {
          created_at?: string | null
          customer?: string
          end?: string | null
          end_at?: string
          id?: string
          staff?: string | null
          start?: string | null
          start_at?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          action: string | null
          created_at: string | null
          id: string
          name: string
          status: string | null
          tenant_id: string
          updated_at: string | null
          when: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          id?: string
          name: string
          status?: string | null
          tenant_id: string
          updated_at?: string | null
          when?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          id?: string
          name?: string
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
          when?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_quick_answers: {
        Row: {
          answer: string
          confidence: number | null
          created_at: string | null
          id: string
          question_pattern: string
          question_type: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          answer: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          question_pattern: string
          question_type: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          answer?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          question_pattern?: string
          question_type?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      calls: {
        Row: {
          at: string | null
          duration: number | null
          from: string
          id: string
          outcome: string | null
          summary: string | null
          tenant_id: string
          to: string | null
        }
        Insert: {
          at?: string | null
          duration?: number | null
          from: string
          id?: string
          outcome?: string | null
          summary?: string | null
          tenant_id: string
          to?: string | null
        }
        Update: {
          at?: string | null
          duration?: number | null
          from?: string
          id?: string
          outcome?: string | null
          summary?: string | null
          tenant_id?: string
          to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          channel: string
          contact: string
          created_at: string | null
          id: string
          tenant_id: string
        }
        Insert: {
          channel?: string
          contact: string
          created_at?: string | null
          id?: string
          tenant_id: string
        }
        Update: {
          channel?: string
          contact?: string
          created_at?: string | null
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string
          id: string
          meta: Json | null
          source_id: string | null
          tenant_id: string
          token_count: number
        }
        Insert: {
          content: string
          created_at?: string
          embedding: string
          id?: string
          meta?: Json | null
          source_id?: string | null
          tenant_id: string
          token_count?: number
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string
          id?: string
          meta?: Json | null
          source_id?: string | null
          tenant_id?: string
          token_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          created_at: string
          id: string
          meta: Json
          source_type: string
          source_url: string | null
          tenant_id: string
          title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          meta?: Json
          source_type?: string
          source_url?: string | null
          tenant_id: string
          title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          meta?: Json
          source_type?: string
          source_url?: string | null
          tenant_id?: string
          title?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          intent: string | null
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          score: number | null
          score_tier: string | null
          source: string | null
          status: string | null
          tenant_id: string
          updated_at: string | null
          value: number | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          intent?: string | null
          name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          score?: number | null
          score_tier?: string | null
          source?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          intent?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          score?: number | null
          score_tier?: string | null
          source?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      logs: {
        Row: {
          created_at: string | null
          data: string | null
          event: string
          id: number
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data?: string | null
          event: string
          id?: number
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data?: string | null
          event?: string
          id?: number
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      memberships: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["role"]
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["role"]
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["role"]
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          at: string | null
          body: string | null
          conversation_id: string | null
          direction: string | null
          from: string
          id: string
          sent_at: string
          tenant_id: string
          text: string
          thread_id: string
        }
        Insert: {
          at?: string | null
          body?: string | null
          conversation_id?: string | null
          direction?: string | null
          from: string
          id?: string
          sent_at: string
          tenant_id: string
          text: string
          thread_id: string
        }
        Update: {
          at?: string | null
          body?: string | null
          conversation_id?: string | null
          direction?: string | null
          from?: string
          id?: string
          sent_at?: string
          tenant_id?: string
          text?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_tenant_id: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          image_url: string | null
          is_site_admin: boolean
          updated_at: string | null
        }
        Insert: {
          active_tenant_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          image_url?: string | null
          is_site_admin?: boolean
          updated_at?: string | null
        }
        Update: {
          active_tenant_id?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          image_url?: string | null
          is_site_admin?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          customer_id: string
          id: string
          price_id: string | null
          provider: string
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          customer_id: string
          id?: string
          price_id?: string | null
          provider?: string
          status: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          customer_id?: string
          id?: string
          price_id?: string | null
          provider?: string
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invites: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["role_kind"]
          tenant_id: string | null
          token: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          role?: Database["public"]["Enums"]["role_kind"]
          tenant_id?: string | null
          token?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["role_kind"]
          tenant_id?: string | null
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string | null
          role: Database["public"]["Enums"]["role_kind"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          role?: Database["public"]["Enums"]["role_kind"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          role?: Database["public"]["Enums"]["role_kind"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          price_id: string | null
          slug: string
          stripe_customer_id: string | null
          subscription_status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          price_id?: string | null
          slug: string
          stripe_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          price_id?: string | null
          slug?: string
          stripe_customer_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      threads: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          tenant_id: string
          updated_at: string | null
          with: string
        }
        Insert: {
          channel: string
          created_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string | null
          with: string
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string | null
          with?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      unresolved_questions: {
        Row: {
          asked_by: string | null
          call_id: string | null
          created_at: string
          id: string
          notes: string | null
          question: string
          status: string
          tenant_id: string
        }
        Insert: {
          asked_by?: string | null
          call_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          question: string
          status?: string
          tenant_id: string
        }
        Update: {
          asked_by?: string | null
          call_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          question?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      mv_kpis_7d: {
        Row: {
          bookings_7d: number | null
          calls_7d: number | null
          leads_7d: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _is_active_tenant: {
        Args: { tid: string }
        Returns: boolean
      }
      binary_quantize: {
        Args: { "": string } | { "": unknown }
        Returns: unknown
      }
      get_quick_answer: {
        Args: { p_query: string; p_tenant: string }
        Returns: {
          answer: string
          confidence: number
          question_type: string
        }[]
      }
      halfvec_avg: {
        Args: { "": number[] }
        Returns: unknown
      }
      halfvec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_send: {
        Args: { "": unknown }
        Returns: string
      }
      halfvec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      has_role: {
        Args: {
          min_role: Database["public"]["Enums"]["role"]
          t: string
          u: string
        }
        Returns: boolean
      }
      hnsw_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_sparsevec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnswhandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      is_member: {
        Args: { t: string; u: string }
        Returns: boolean
      }
      is_member_of: {
        Args: { tid: string }
        Returns: boolean
      }
      ivfflat_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflathandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      l2_norm: {
        Args: { "": unknown } | { "": unknown }
        Returns: number
      }
      l2_normalize: {
        Args: { "": string } | { "": unknown } | { "": unknown }
        Returns: unknown
      }
      match_knowledge: {
        Args: {
          p_embedding: string
          p_match_count?: number
          p_min_cosine_similarity?: number
          p_tenant: string
        }
        Returns: {
          chunk_id: string
          content: string
          score: number
          source_id: string
        }[]
      }
      purge_old: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      refresh_kpis: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      search_knowledge_keywords: {
        Args: { p_match_count?: number; p_query: string; p_tenant: string }
        Returns: {
          chunk_id: string
          content: string
          score: number
          source_id: string
        }[]
      }
      sparsevec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      sparsevec_send: {
        Args: { "": unknown }
        Returns: string
      }
      sparsevec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      vector_avg: {
        Args: { "": number[] }
        Returns: string
      }
      vector_dims: {
        Args: { "": string } | { "": unknown }
        Returns: number
      }
      vector_norm: {
        Args: { "": string }
        Returns: number
      }
      vector_out: {
        Args: { "": string }
        Returns: unknown
      }
      vector_send: {
        Args: { "": string }
        Returns: string
      }
      vector_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
    }
    Enums: {
      role: "OWNER" | "MANAGER" | "AGENT" | "VIEWER"
      role_kind: "owner" | "admin" | "agent"
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
  public: {
    Enums: {
      role: ["OWNER", "MANAGER", "AGENT", "VIEWER"],
      role_kind: ["owner", "admin", "agent"],
    },
  },
} as const
