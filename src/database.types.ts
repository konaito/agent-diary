
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "cc_sessions": {
                  Row: {
                    "cc_version": string | null,"created_at": string,"entrypoint": string | null,"first_event_at": string | null,"git_branch": string | null,"last_event_at": string | null,"project_dir": string,"project_name": string | null,"session_id": string,"title": string | null,"transcript_path": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cc_version"?: string | null,"created_at"?: string,"entrypoint"?: string | null,"first_event_at"?: string | null,"git_branch"?: string | null,"last_event_at"?: string | null,"project_dir": string,"project_name"?: never,"session_id": string,"title"?: string | null,"transcript_path": string,"updated_at"?: string
                  }
                  Update: {
                    "cc_version"?: string | null,"created_at"?: string,"entrypoint"?: string | null,"first_event_at"?: string | null,"git_branch"?: string | null,"last_event_at"?: string | null,"project_dir"?: string,"project_name"?: never,"session_id"?: string,"title"?: string | null,"transcript_path"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"diary_entries": {
                  Row: {
                    "attempts": number,"body": string | null,"created_at": string,"diary_date": string | null,"did": (string)[],"end_reason": string,"ended_at": string,"failed": (string)[],"files_touched": (string)[],"generation_cost_usd": number | null,"hook_input": NonNullable<Json>,"id": number,"last_error": string | null,"last_message_uuid": string | null,"learned": (string)[],"model": string | null,"open_threads": (string)[],"pr_urls": (string)[],"session_id": string,"skip_reason": string | null,"span_ended_at": string | null,"span_started_at": string | null,"stats": NonNullable<Json>,"status": Database["public"]['Enums']["diary_entry_status"],"tags": (string)[],"title": string | null,"updated_at": string,"written_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body"?: string | null,"created_at"?: string,"diary_date"?: never,"did"?: (string)[],"end_reason": string,"ended_at": string,"failed"?: (string)[],"files_touched"?: (string)[],"generation_cost_usd"?: number | null,"hook_input": NonNullable<Json>,"id"?: never,"last_error"?: string | null,"last_message_uuid"?: string | null,"learned"?: (string)[],"model"?: string | null,"open_threads"?: (string)[],"pr_urls"?: (string)[],"session_id": string,"skip_reason"?: string | null,"span_ended_at"?: string | null,"span_started_at"?: string | null,"stats"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["diary_entry_status"],"tags"?: (string)[],"title"?: string | null,"updated_at"?: string,"written_at"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"body"?: string | null,"created_at"?: string,"diary_date"?: never,"did"?: (string)[],"end_reason"?: string,"ended_at"?: string,"failed"?: (string)[],"files_touched"?: (string)[],"generation_cost_usd"?: number | null,"hook_input"?: NonNullable<Json>,"id"?: never,"last_error"?: string | null,"last_message_uuid"?: string | null,"learned"?: (string)[],"model"?: string | null,"open_threads"?: (string)[],"pr_urls"?: (string)[],"session_id"?: string,"skip_reason"?: string | null,"span_ended_at"?: string | null,"span_started_at"?: string | null,"stats"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["diary_entry_status"],"tags"?: (string)[],"title"?: string | null,"updated_at"?: string,"written_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "diary_entries_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "cc_sessions"
      referencedColumns: ["session_id"]
    }
                  ]
                }
          }
          Views: {
            "daily_diary": {
                  Row: {
                    "diary_date": string | null,"entry_count": number | null,"markdown": string | null,"projects": (string)[] | null,"tool_calls": number | null,"user_prompts": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "diary_entry_status": "pending"|"generating"|"written"|"skipped"|"failed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "diary_entry_status": ["pending", "generating", "written", "skipped", "failed"]
          }
        }
} as const
