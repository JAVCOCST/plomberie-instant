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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          client_email: string | null
          client_first_name: string
          client_last_name: string
          client_phone: string | null
          created_at: string | null
          duration_minutes: number
          formatted_address: string | null
          google_event_id: string | null
          id: string
          notes: string | null
          scheduled_at: string
          soumission_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          client_email?: string | null
          client_first_name: string
          client_last_name?: string
          client_phone?: string | null
          created_at?: string | null
          duration_minutes?: number
          formatted_address?: string | null
          google_event_id?: string | null
          id?: string
          notes?: string | null
          scheduled_at: string
          soumission_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          client_email?: string | null
          client_first_name?: string
          client_last_name?: string
          client_phone?: string | null
          created_at?: string | null
          duration_minutes?: number
          formatted_address?: string | null
          google_event_id?: string | null
          id?: string
          notes?: string | null
          scheduled_at?: string
          soumission_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_soumission_id_fkey"
            columns: ["soumission_id"]
            isOneToOne: false
            referencedRelation: "soumissions"
            referencedColumns: ["id"]
          },
        ]
      }
      batiment_avec_lot: {
        Row: {
          altmax: number | null
          altmin: number | null
          altmoy: number | null
          datecreation: string | null
          datesource: string | null
          eval_adresse: string | null
          eval_annee_construction: number | null
          eval_annee_reference: number | null
          eval_fetched_at: string | null
          eval_municipalite: string | null
          eval_nb_logements: number | null
          eval_proprietaire: string | null
          eval_source_url: string | null
          eval_type_utilisation: string | null
          eval_valeur_batiment: number | null
          eval_valeur_terrain: number | null
          eval_valeur_totale: number | null
          fid: number | null
          geom_batiment: unknown
          geom_lot: unknown
          id: number | null
          idbati: string | null
          lot_id: number | null
          lot_objectid: number | null
          methoprod: string | null
          niveaucompl: string | null
          no_lot: string | null
          noseq: string | null
          perimetre: number | null
          producteur: string | null
          source: string | null
          superficie: number | null
          version: string | null
        }
        Insert: {
          altmax?: number | null
          altmin?: number | null
          altmoy?: number | null
          datecreation?: string | null
          datesource?: string | null
          eval_adresse?: string | null
          eval_annee_construction?: number | null
          eval_annee_reference?: number | null
          eval_fetched_at?: string | null
          eval_municipalite?: string | null
          eval_nb_logements?: number | null
          eval_proprietaire?: string | null
          eval_source_url?: string | null
          eval_type_utilisation?: string | null
          eval_valeur_batiment?: number | null
          eval_valeur_terrain?: number | null
          eval_valeur_totale?: number | null
          fid?: number | null
          geom_batiment?: unknown
          geom_lot?: unknown
          id?: number | null
          idbati?: string | null
          lot_id?: number | null
          lot_objectid?: number | null
          methoprod?: string | null
          niveaucompl?: string | null
          no_lot?: string | null
          noseq?: string | null
          perimetre?: number | null
          producteur?: string | null
          source?: string | null
          superficie?: number | null
          version?: string | null
        }
        Update: {
          altmax?: number | null
          altmin?: number | null
          altmoy?: number | null
          datecreation?: string | null
          datesource?: string | null
          eval_adresse?: string | null
          eval_annee_construction?: number | null
          eval_annee_reference?: number | null
          eval_fetched_at?: string | null
          eval_municipalite?: string | null
          eval_nb_logements?: number | null
          eval_proprietaire?: string | null
          eval_source_url?: string | null
          eval_type_utilisation?: string | null
          eval_valeur_batiment?: number | null
          eval_valeur_terrain?: number | null
          eval_valeur_totale?: number | null
          fid?: number | null
          geom_batiment?: unknown
          geom_lot?: unknown
          id?: number | null
          idbati?: string | null
          lot_id?: number | null
          lot_objectid?: number | null
          methoprod?: string | null
          niveaucompl?: string | null
          no_lot?: string | null
          noseq?: string | null
          perimetre?: number | null
          producteur?: string | null
          source?: string | null
          superficie?: number | null
          version?: string | null
        }
        Relationships: []
      }
      batiment_points_3857: {
        Row: {
          geom: unknown
          id: number | null
        }
        Insert: {
          geom?: unknown
          id?: number | null
        }
        Update: {
          geom?: unknown
          id?: number | null
        }
        Relationships: []
      }
      Batiment_poly: {
        Row: {
          AltMax: string | null
          AltMin: string | null
          AltMoy: string | null
          DateCreation: string | null
          DateSource: string | null
          fid: number | null
          geom: unknown
          id: number | null
          IdBati: string | null
          MethoProd: string | null
          NiveauCompl: string | null
          NoSeq: string | null
          Perimetre: number | null
          Producteur: string | null
          Source: string | null
          Superficie: number | null
          Version: string | null
        }
        Insert: {
          AltMax?: string | null
          AltMin?: string | null
          AltMoy?: string | null
          DateCreation?: string | null
          DateSource?: string | null
          fid?: number | null
          geom?: unknown
          id?: number | null
          IdBati?: string | null
          MethoProd?: string | null
          NiveauCompl?: string | null
          NoSeq?: string | null
          Perimetre?: number | null
          Producteur?: string | null
          Source?: string | null
          Superficie?: number | null
          Version?: string | null
        }
        Update: {
          AltMax?: string | null
          AltMin?: string | null
          AltMoy?: string | null
          DateCreation?: string | null
          DateSource?: string | null
          fid?: number | null
          geom?: unknown
          id?: number | null
          IdBati?: string | null
          MethoProd?: string | null
          NiveauCompl?: string | null
          NoSeq?: string | null
          Perimetre?: number | null
          Producteur?: string | null
          Source?: string | null
          Superficie?: number | null
          Version?: string | null
        }
        Relationships: []
      }
      batiment_poly_temp: {
        Row: {
          altmax: number | null
          altmin: number | null
          altmoy: number | null
          datecreation: string | null
          datesource: string | null
          fid: number | null
          geom: unknown
          id: number
          idbati: string | null
          methoprod: string | null
          niveaucompl: string | null
          noseq: string | null
          perimetre: number | null
          producteur: string | null
          source: string | null
          superficie: number | null
          version: string | null
        }
        Insert: {
          altmax?: number | null
          altmin?: number | null
          altmoy?: number | null
          datecreation?: string | null
          datesource?: string | null
          fid?: number | null
          geom?: unknown
          id?: number
          idbati?: string | null
          methoprod?: string | null
          niveaucompl?: string | null
          noseq?: string | null
          perimetre?: number | null
          producteur?: string | null
          source?: string | null
          superficie?: number | null
          version?: string | null
        }
        Update: {
          altmax?: number | null
          altmin?: number | null
          altmoy?: number | null
          datecreation?: string | null
          datesource?: string | null
          fid?: number | null
          geom?: unknown
          id?: number
          idbati?: string | null
          methoprod?: string | null
          niveaucompl?: string | null
          noseq?: string | null
          perimetre?: number | null
          producteur?: string | null
          source?: string | null
          superficie?: number | null
          version?: string | null
        }
        Relationships: []
      }
      batiment_rn: {
        Row: {
          id: number | null
          rn: number | null
        }
        Insert: {
          id?: number | null
          rn?: number | null
        }
        Update: {
          id?: number | null
          rn?: number | null
        }
        Relationships: []
      }
      contract_signature_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          request_id: string
          signer_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          request_id: string
          signer_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          request_id?: string
          signer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signature_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "contract_signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signature_events_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "contract_signers"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signature_fields: {
        Row: {
          created_at: string
          field_type: string
          height_pct: number
          id: string
          label: string | null
          page: number
          request_id: string
          required: boolean
          signed_at: string | null
          signer_id: string
          value: string | null
          width_pct: number
          x_pct: number
          y_pct: number
        }
        Insert: {
          created_at?: string
          field_type: string
          height_pct?: number
          id?: string
          label?: string | null
          page?: number
          request_id: string
          required?: boolean
          signed_at?: string | null
          signer_id: string
          value?: string | null
          width_pct?: number
          x_pct: number
          y_pct: number
        }
        Update: {
          created_at?: string
          field_type?: string
          height_pct?: number
          id?: string
          label?: string | null
          page?: number
          request_id?: string
          required?: boolean
          signed_at?: string | null
          signer_id?: string
          value?: string | null
          width_pct?: number
          x_pct?: number
          y_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_signature_fields_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "contract_signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signature_fields_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "contract_signers"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signature_requests: {
        Row: {
          access_token: string
          completed_at: string | null
          contract_html: string | null
          contract_pdf_url: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          message: string | null
          progress_percent: number
          sent_at: string | null
          signed_pdf_url: string | null
          soumission_id: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          access_token: string
          completed_at?: string | null
          contract_html?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          message?: string | null
          progress_percent?: number
          sent_at?: string | null
          signed_pdf_url?: string | null
          soumission_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          completed_at?: string | null
          contract_html?: string | null
          contract_pdf_url?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          message?: string | null
          progress_percent?: number
          sent_at?: string | null
          signed_pdf_url?: string | null
          soumission_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_signature_requests_soumission_id_fkey"
            columns: ["soumission_id"]
            isOneToOne: false
            referencedRelation: "soumissions"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signers: {
        Row: {
          color: string
          created_at: string
          declined_at: string | null
          email: string | null
          id: string
          ip_address: string | null
          name: string
          phone: string | null
          request_id: string
          role: string
          signature_image_url: string | null
          signed_at: string | null
          signer_order: number
          signer_token: string
          status: string
          user_agent: string | null
          viewed_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          declined_at?: string | null
          email?: string | null
          id?: string
          ip_address?: string | null
          name: string
          phone?: string | null
          request_id: string
          role?: string
          signature_image_url?: string | null
          signed_at?: string | null
          signer_order?: number
          signer_token: string
          status?: string
          user_agent?: string | null
          viewed_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          declined_at?: string | null
          email?: string | null
          id?: string
          ip_address?: string | null
          name?: string
          phone?: string | null
          request_id?: string
          role?: string
          signature_image_url?: string | null
          signed_at?: string | null
          signer_order?: number
          signer_token?: string
          status?: string
          user_agent?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "contract_signature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      dext_options: {
        Row: {
          accounts: Json
          clients: Json
          id: string
          projects: Json
          taxes: Json
          updated_at: string
          users: Json
        }
        Insert: {
          accounts?: Json
          clients?: Json
          id?: string
          projects?: Json
          taxes?: Json
          updated_at?: string
          users?: Json
        }
        Update: {
          accounts?: Json
          clients?: Json
          id?: string
          projects?: Json
          taxes?: Json
          updated_at?: string
          users?: Json
        }
        Relationships: []
      }
      dispatch_assignments: {
        Row: {
          assignment_date: string
          company_id: string
          created_at: string | null
          created_by: string | null
          employee_id: string
          equipment_id: string | null
          id: string
          notes: string | null
          period: string
          project_id: string | null
          schedule_task_id: string | null
          updated_at: string | null
        }
        Insert: {
          assignment_date: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          equipment_id?: string | null
          id?: string
          notes?: string | null
          period?: string
          project_id?: string | null
          schedule_task_id?: string | null
          updated_at?: string | null
        }
        Update: {
          assignment_date?: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          equipment_id?: string | null
          id?: string
          notes?: string | null
          period?: string
          project_id?: string | null
          schedule_task_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_assignments_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_assignments_schedule_task_id_fkey"
            columns: ["schedule_task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_mappings: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          notes: string | null
          qbo_employee_id: string
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          qbo_employee_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          qbo_employee_id?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      form_sessions: {
        Row: {
          color: string | null
          coverage_type: string | null
          created_at: string
          desired_install_date: string | null
          email: string | null
          first_name: string | null
          formatted_address: string | null
          id: string
          is_complete: boolean
          last_name: string | null
          last_step: number
          lat: number | null
          lng: number | null
          page_url: string | null
          phone: string | null
          product_brand: string | null
          product_name: string | null
          session_id: string
          slope: string | null
          soumission_id: string | null
          step_labels: Json | null
          step_timings: Json | null
          total_steps: number
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          color?: string | null
          coverage_type?: string | null
          created_at?: string
          desired_install_date?: string | null
          email?: string | null
          first_name?: string | null
          formatted_address?: string | null
          id?: string
          is_complete?: boolean
          last_name?: string | null
          last_step?: number
          lat?: number | null
          lng?: number | null
          page_url?: string | null
          phone?: string | null
          product_brand?: string | null
          product_name?: string | null
          session_id: string
          slope?: string | null
          soumission_id?: string | null
          step_labels?: Json | null
          step_timings?: Json | null
          total_steps?: number
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          color?: string | null
          coverage_type?: string | null
          created_at?: string
          desired_install_date?: string | null
          email?: string | null
          first_name?: string | null
          formatted_address?: string | null
          id?: string
          is_complete?: boolean
          last_name?: string | null
          last_step?: number
          lat?: number | null
          lng?: number | null
          page_url?: string | null
          phone?: string | null
          product_brand?: string | null
          product_name?: string | null
          session_id?: string
          slope?: string | null
          soumission_id?: string | null
          step_labels?: Json | null
          step_timings?: Json | null
          total_steps?: number
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_sessions_soumission_id_fkey"
            columns: ["soumission_id"]
            isOneToOne: false
            referencedRelation: "soumissions"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string
          created_at: string | null
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          calendar_id?: string
          created_at?: string | null
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          calendar_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      lots_cadastre: {
        Row: {
          geom: unknown
          id: number
          no_lot: string | null
          objectid: number | null
        }
        Insert: {
          geom?: unknown
          id?: number
          no_lot?: string | null
          objectid?: number | null
        }
        Update: {
          geom?: unknown
          id?: number
          no_lot?: string | null
          objectid?: number | null
        }
        Relationships: []
      }
      owner_lookup_results: {
        Row: {
          acquisition_date: string | null
          address: string | null
          city: string | null
          created_at: string | null
          id: string
          is_complete: boolean | null
          lot_number: string
          owner_name: string | null
          postal_code: string | null
          price: string | null
        }
        Insert: {
          acquisition_date?: string | null
          address?: string | null
          city?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean | null
          lot_number: string
          owner_name?: string | null
          postal_code?: string | null
          price?: string | null
        }
        Update: {
          acquisition_date?: string | null
          address?: string | null
          city?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean | null
          lot_number?: string
          owner_name?: string | null
          postal_code?: string | null
          price?: string | null
        }
        Relationships: []
      }
      pricing_matrix: {
        Row: {
          id: number
          material: string
          price_footprint_high: number | null
          price_footprint_low: number | null
          price_roof_high: number | null
          price_roof_low: number | null
          roof_subtype: string
          slope_coeff: number | null
          slope_label: string
          source_notes: string | null
          work_type: string
        }
        Insert: {
          id?: number
          material: string
          price_footprint_high?: number | null
          price_footprint_low?: number | null
          price_roof_high?: number | null
          price_roof_low?: number | null
          roof_subtype: string
          slope_coeff?: number | null
          slope_label: string
          source_notes?: string | null
          work_type: string
        }
        Update: {
          id?: number
          material?: string
          price_footprint_high?: number | null
          price_footprint_low?: number | null
          price_roof_high?: number | null
          price_roof_low?: number | null
          roof_subtype?: string
          slope_coeff?: number | null
          slope_label?: string
          source_notes?: string | null
          work_type?: string
        }
        Relationships: []
      }
      qb_customers: {
        Row: {
          balance: number | null
          bill_address: string | null
          company_name: string | null
          display_name: string
          email: string | null
          id: string
          mobile: string | null
          phone: string | null
          qb_id: string
          raw_data: Json | null
          synced_at: string | null
        }
        Insert: {
          balance?: number | null
          bill_address?: string | null
          company_name?: string | null
          display_name: string
          email?: string | null
          id?: string
          mobile?: string | null
          phone?: string | null
          qb_id: string
          raw_data?: Json | null
          synced_at?: string | null
        }
        Update: {
          balance?: number | null
          bill_address?: string | null
          company_name?: string | null
          display_name?: string
          email?: string | null
          id?: string
          mobile?: string | null
          phone?: string | null
          qb_id?: string
          raw_data?: Json | null
          synced_at?: string | null
        }
        Relationships: []
      }
      qb_products: {
        Row: {
          active: boolean | null
          brand: string | null
          coverage_types: string[] | null
          coverage_unit: string | null
          coverage_value: number | null
          description: string | null
          expense_account_name: string | null
          gamme: string | null
          id: string
          income_account_name: string | null
          name: string
          purchase_cost: number | null
          qb_id: string
          raw_data: Json | null
          sku: string | null
          supplier: string | null
          synced_at: string | null
          type: string | null
          unit_price: number | null
        }
        Insert: {
          active?: boolean | null
          brand?: string | null
          coverage_types?: string[] | null
          coverage_unit?: string | null
          coverage_value?: number | null
          description?: string | null
          expense_account_name?: string | null
          gamme?: string | null
          id?: string
          income_account_name?: string | null
          name: string
          purchase_cost?: number | null
          qb_id: string
          raw_data?: Json | null
          sku?: string | null
          supplier?: string | null
          synced_at?: string | null
          type?: string | null
          unit_price?: number | null
        }
        Update: {
          active?: boolean | null
          brand?: string | null
          coverage_types?: string[] | null
          coverage_unit?: string | null
          coverage_value?: number | null
          description?: string | null
          expense_account_name?: string | null
          gamme?: string | null
          id?: string
          income_account_name?: string | null
          name?: string
          purchase_cost?: number | null
          qb_id?: string
          raw_data?: Json | null
          sku?: string | null
          supplier?: string | null
          synced_at?: string | null
          type?: string | null
          unit_price?: number | null
        }
        Relationships: []
      }
      qbo_employee: {
        Row: {
          active: boolean | null
          company_id: string
          display_name: string
          family_name: string | null
          given_name: string | null
          id: string
          synced_at: string | null
        }
        Insert: {
          active?: boolean | null
          company_id?: string
          display_name: string
          family_name?: string | null
          given_name?: string | null
          id: string
          synced_at?: string | null
        }
        Update: {
          active?: boolean | null
          company_id?: string
          display_name?: string
          family_name?: string | null
          given_name?: string | null
          id?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      quickbooks_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          expires_at: string
          id: string
          realm_id: string
          refresh_token: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expires_at: string
          id?: string
          realm_id: string
          refresh_token: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          realm_id?: string
          refresh_token?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      quote_email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          payload: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          payload?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      schedule_baseline_tasks: {
        Row: {
          baseline_id: string
          duration_days: number
          end_date: string
          id: string
          progress: number | null
          snapshot_title: string
          start_date: string
          task_id: string
        }
        Insert: {
          baseline_id: string
          duration_days: number
          end_date: string
          id?: string
          progress?: number | null
          snapshot_title: string
          start_date: string
          task_id: string
        }
        Update: {
          baseline_id?: string
          duration_days?: number
          end_date?: string
          id?: string
          progress?: number | null
          snapshot_title?: string
          start_date?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_baseline_tasks_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "schedule_baselines"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_baselines: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          schedule_id: string
          version_name: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          schedule_id: string
          version_name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          schedule_id?: string
          version_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_baselines_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_dependencies: {
        Row: {
          created_at: string | null
          dependency_type: string
          id: string
          lag_days: number | null
          schedule_id: string
          source_task_id: string
          target_task_id: string
        }
        Insert: {
          created_at?: string | null
          dependency_type?: string
          id?: string
          lag_days?: number | null
          schedule_id: string
          source_task_id: string
          target_task_id: string
        }
        Update: {
          created_at?: string | null
          dependency_type?: string
          id?: string
          lag_days?: number | null
          schedule_id?: string
          source_task_id?: string
          target_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_dependencies_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_dependencies_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_dependencies_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_tasks: {
        Row: {
          assigned_team_summary: string | null
          assigned_to: string | null
          baseline_end_date: string | null
          baseline_start_date: string | null
          color: string | null
          created_at: string | null
          description: string | null
          duration_days: number
          end_date: string
          estimator: string | null
          id: string
          is_collapsed: boolean | null
          is_hidden: boolean | null
          labor_cost: number | null
          material_cost: number | null
          parent_id: string | null
          priority: string
          progress: number
          schedule_id: string
          sort_order: number
          soumission_id: string | null
          start_date: string
          status: string
          subcontract_cost: number | null
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          assigned_team_summary?: string | null
          assigned_to?: string | null
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          duration_days?: number
          end_date?: string
          estimator?: string | null
          id?: string
          is_collapsed?: boolean | null
          is_hidden?: boolean | null
          labor_cost?: number | null
          material_cost?: number | null
          parent_id?: string | null
          priority?: string
          progress?: number
          schedule_id: string
          sort_order?: number
          soumission_id?: string | null
          start_date?: string
          status?: string
          subcontract_cost?: number | null
          title: string
          type?: string
          updated_at?: string | null
        }
        Update: {
          assigned_team_summary?: string | null
          assigned_to?: string | null
          baseline_end_date?: string | null
          baseline_start_date?: string | null
          color?: string | null
          created_at?: string | null
          description?: string | null
          duration_days?: number
          end_date?: string
          estimator?: string | null
          id?: string
          is_collapsed?: boolean | null
          is_hidden?: boolean | null
          labor_cost?: number | null
          material_cost?: number | null
          parent_id?: string | null
          priority?: string
          progress?: number
          schedule_id?: string
          sort_order?: number
          soumission_id?: string | null
          start_date?: string
          status?: string
          subcontract_cost?: number | null
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_soumission_id_fkey"
            columns: ["soumission_id"]
            isOneToOne: false
            referencedRelation: "soumissions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          name: string
          project_id: string
          updated_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          id?: string
          name?: string
          project_id: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          name?: string
          project_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sms_conversations: {
        Row: {
          address: string | null
          client_name: string | null
          client_phone: string
          created_at: string | null
          id: string
          is_active: boolean | null
          summary: string | null
          updated_at: string | null
          work_type: string | null
        }
        Insert: {
          address?: string | null
          client_name?: string | null
          client_phone: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          summary?: string | null
          updated_at?: string | null
          work_type?: string | null
        }
        Update: {
          address?: string | null
          client_name?: string | null
          client_phone?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          summary?: string | null
          updated_at?: string | null
          work_type?: string | null
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          client_phone: string
          content: string
          created_at: string | null
          id: string
          sender: string
        }
        Insert: {
          client_phone: string
          content: string
          created_at?: string | null
          id?: string
          sender: string
        }
        Update: {
          client_phone?: string
          content?: string
          created_at?: string | null
          id?: string
          sender?: string
        }
        Relationships: []
      }
      soumission_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          soumission_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          soumission_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          soumission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "soumission_notes_soumission_id_fkey"
            columns: ["soumission_id"]
            isOneToOne: false
            referencedRelation: "soumissions"
            referencedColumns: ["id"]
          },
        ]
      }
      soumissions: {
        Row: {
          area_input: number | null
          area_sqft: number | null
          area_unit: string | null
          building_type: string | null
          color: string | null
          complexity: string | null
          complexity_factor: number | null
          contact_preference: string
          coverage_type: string | null
          created_at: string
          desired_install_date: string | null
          dynasty_breakdown: Json | null
          email: string
          first_name: string
          form_session_id: string | null
          formatted_address: string | null
          high_estimate: number | null
          id: string
          last_name: string
          lat: number | null
          lng: number | null
          low_estimate: number | null
          mobilisation: number | null
          page_url: string | null
          phone: string
          place_id: string | null
          price_per_sqft: number | null
          product_brand: string | null
          product_id: string | null
          product_name: string | null
          reference_id: string | null
          roof_category: string | null
          seq_number: number
          slope: string | null
          slope_factor: number | null
          status: string
          subtotal: number | null
          user_agent: string | null
          utm: Json | null
          work_type: string | null
        }
        Insert: {
          area_input?: number | null
          area_sqft?: number | null
          area_unit?: string | null
          building_type?: string | null
          color?: string | null
          complexity?: string | null
          complexity_factor?: number | null
          contact_preference?: string
          coverage_type?: string | null
          created_at?: string
          desired_install_date?: string | null
          dynasty_breakdown?: Json | null
          email: string
          first_name: string
          form_session_id?: string | null
          formatted_address?: string | null
          high_estimate?: number | null
          id?: string
          last_name: string
          lat?: number | null
          lng?: number | null
          low_estimate?: number | null
          mobilisation?: number | null
          page_url?: string | null
          phone: string
          place_id?: string | null
          price_per_sqft?: number | null
          product_brand?: string | null
          product_id?: string | null
          product_name?: string | null
          reference_id?: string | null
          roof_category?: string | null
          seq_number?: number
          slope?: string | null
          slope_factor?: number | null
          status?: string
          subtotal?: number | null
          user_agent?: string | null
          utm?: Json | null
          work_type?: string | null
        }
        Update: {
          area_input?: number | null
          area_sqft?: number | null
          area_unit?: string | null
          building_type?: string | null
          color?: string | null
          complexity?: string | null
          complexity_factor?: number | null
          contact_preference?: string
          coverage_type?: string | null
          created_at?: string
          desired_install_date?: string | null
          dynasty_breakdown?: Json | null
          email?: string
          first_name?: string
          form_session_id?: string | null
          formatted_address?: string | null
          high_estimate?: number | null
          id?: string
          last_name?: string
          lat?: number | null
          lng?: number | null
          low_estimate?: number | null
          mobilisation?: number | null
          page_url?: string | null
          phone?: string
          place_id?: string | null
          price_per_sqft?: number | null
          product_brand?: string | null
          product_id?: string | null
          product_name?: string | null
          reference_id?: string | null
          roof_category?: string | null
          seq_number?: number
          slope?: string | null
          slope_factor?: number | null
          status?: string
          subtotal?: number | null
          user_agent?: string | null
          utm?: Json | null
          work_type?: string | null
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      training_export_batches: {
        Row: {
          bundle_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          metadata: Json | null
          schema_version: string
          status: string
          takeoff_ids: string[]
        }
        Insert: {
          bundle_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          schema_version?: string
          status?: string
          takeoff_ids?: string[]
        }
        Update: {
          bundle_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          schema_version?: string
          status?: string
          takeoff_ids?: string[]
        }
        Relationships: []
      }
      training_roof_takeoffs: {
        Row: {
          address: string | null
          annotated_image_url: string | null
          annotations_json: Json | null
          // Phase 1 refonte training-lab (2026-06-05) — voir migration
          // 20260605_training_lab_batches_and_versions.sql.
          batch_id: string | null
          building_id: string | null
          building_polygon_px: Json | null
          calibration_confidence: number | null
          calibration_notes: string | null
          calibration_offset_m: Json | null
          calibration_offset_px: Json | null
          calibration_rotation_deg: number | null
          calibration_scale: number | null
          calibration_status: string | null
          centroid_lat: number | null
          centroid_lng: number | null
          corrected_building_geojson: Json | null
          corrected_lot_geojson: Json | null
          correction_time_sec: number | null
          created_at: string
          dataset_status: string
          debug_overlay_url: string | null
          display_settings: Json | null
          export_batch_id: string | null
          human_notes: string | null
          id: string
          json_url: string | null
          lot_id: string | null
          model_version_used: string | null
          original_building_geojson: Json | null
          original_lot_geojson: Json | null
          postprocessed_json: Json | null
          prediction_json: Json | null
          qc_status: string | null
          quality_score: number | null
          raw_image_url: string | null
          reference: string | null
          review_priority: number | null
          // Added by migration 20260530141155_training_lab_roof_model_columns.sql
          roof_model: Json | null
          roof_model_diff: Json | null
          roof_sections_v16: Json | null
          source_takeoff_id: string | null
          source_type: string | null
          tags: string[]
          updated_at: string
          zoom: number | null
        }
        Insert: {
          address?: string | null
          annotated_image_url?: string | null
          annotations_json?: Json | null
          batch_id?: string | null
          building_id?: string | null
          building_polygon_px?: Json | null
          calibration_confidence?: number | null
          calibration_notes?: string | null
          calibration_offset_m?: Json | null
          calibration_offset_px?: Json | null
          calibration_rotation_deg?: number | null
          calibration_scale?: number | null
          calibration_status?: string | null
          centroid_lat?: number | null
          centroid_lng?: number | null
          corrected_building_geojson?: Json | null
          corrected_lot_geojson?: Json | null
          correction_time_sec?: number | null
          created_at?: string
          dataset_status?: string
          debug_overlay_url?: string | null
          display_settings?: Json | null
          export_batch_id?: string | null
          human_notes?: string | null
          id?: string
          json_url?: string | null
          lot_id?: string | null
          model_version_used?: string | null
          original_building_geojson?: Json | null
          original_lot_geojson?: Json | null
          postprocessed_json?: Json | null
          prediction_json?: Json | null
          qc_status?: string | null
          quality_score?: number | null
          raw_image_url?: string | null
          reference?: string | null
          review_priority?: number | null
          roof_model?: Json | null
          roof_model_diff?: Json | null
          roof_sections_v16?: Json | null
          source_takeoff_id?: string | null
          source_type?: string | null
          tags?: string[]
          updated_at?: string
          zoom?: number | null
        }
        Update: {
          address?: string | null
          annotated_image_url?: string | null
          annotations_json?: Json | null
          batch_id?: string | null
          building_id?: string | null
          building_polygon_px?: Json | null
          calibration_confidence?: number | null
          calibration_notes?: string | null
          calibration_offset_m?: Json | null
          calibration_offset_px?: Json | null
          calibration_rotation_deg?: number | null
          calibration_scale?: number | null
          calibration_status?: string | null
          centroid_lat?: number | null
          centroid_lng?: number | null
          corrected_building_geojson?: Json | null
          corrected_lot_geojson?: Json | null
          correction_time_sec?: number | null
          created_at?: string
          dataset_status?: string
          debug_overlay_url?: string | null
          display_settings?: Json | null
          export_batch_id?: string | null
          human_notes?: string | null
          id?: string
          json_url?: string | null
          lot_id?: string | null
          model_version_used?: string | null
          original_building_geojson?: Json | null
          original_lot_geojson?: Json | null
          postprocessed_json?: Json | null
          prediction_json?: Json | null
          qc_status?: string | null
          quality_score?: number | null
          raw_image_url?: string | null
          reference?: string | null
          review_priority?: number | null
          roof_model?: Json | null
          roof_model_diff?: Json | null
          roof_sections_v16?: Json | null
          source_takeoff_id?: string | null
          source_type?: string | null
          tags?: string[]
          updated_at?: string
          zoom?: number | null
        }
        Relationships: []
      }
      // Phase 1 refonte training-lab (2026-06-05) — nouvelle table.
      training_batches: {
        Row: {
          auto_validated_count: number
          avg_correction_time_sec: number | null
          avg_correction_weight: number | null
          avg_quality_score: number | null
          batch_code: string
          city: string | null
          created_at: string
          created_by: string | null
          dataset_count: number
          description: string | null
          id: string
          limit_requested: number | null
          model_version_used: string | null
          name: string
          notes: string | null
          rejected_count: number
          source_type: string
          status: string
          validated_count: number
          zone_geojson: Json | null
        }
        Insert: {
          auto_validated_count?: number
          avg_correction_time_sec?: number | null
          avg_correction_weight?: number | null
          avg_quality_score?: number | null
          batch_code: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          dataset_count?: number
          description?: string | null
          id?: string
          limit_requested?: number | null
          model_version_used?: string | null
          name: string
          notes?: string | null
          rejected_count?: number
          source_type: string
          status?: string
          validated_count?: number
          zone_geojson?: Json | null
        }
        Update: {
          auto_validated_count?: number
          avg_correction_time_sec?: number | null
          avg_correction_weight?: number | null
          avg_quality_score?: number | null
          batch_code?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          dataset_count?: number
          description?: string | null
          id?: string
          limit_requested?: number | null
          model_version_used?: string | null
          name?: string
          notes?: string | null
          rejected_count?: number
          source_type?: string
          status?: string
          validated_count?: number
          zone_geojson?: Json | null
        }
        Relationships: []
      }
      // Phase 1 refonte training-lab (2026-06-05) — nouvelle table.
      model_versions: {
        Row: {
          created_at: string
          dataset_count: number | null
          hf_space_url: string | null
          id: string
          is_active: boolean
          metrics_json: Json | null
          model_code: string
          name: string
          notes: string | null
          onnx_url: string | null
          status: string
          test_count: number | null
          train_count: number | null
          trained_from_batch_ids: string[] | null
          training_config_json: Json | null
          val_count: number | null
          version: string
          weights_url: string | null
        }
        Insert: {
          created_at?: string
          dataset_count?: number | null
          hf_space_url?: string | null
          id?: string
          is_active?: boolean
          metrics_json?: Json | null
          model_code: string
          name: string
          notes?: string | null
          onnx_url?: string | null
          status?: string
          test_count?: number | null
          train_count?: number | null
          trained_from_batch_ids?: string[] | null
          training_config_json?: Json | null
          val_count?: number | null
          version: string
          weights_url?: string | null
        }
        Update: {
          created_at?: string
          dataset_count?: number | null
          hf_space_url?: string | null
          id?: string
          is_active?: boolean
          metrics_json?: Json | null
          model_code?: string
          name?: string
          notes?: string | null
          onnx_url?: string | null
          status?: string
          test_count?: number | null
          train_count?: number | null
          trained_from_batch_ids?: string[] | null
          training_config_json?: Json | null
          val_count?: number | null
          version?: string
          weights_url?: string | null
        }
        Relationships: []
      }
      training_skeleton_tests: {
        Row: {
          chamfer_distance_m: number | null
          created_at: string
          id: string
          length_ratio: number | null
          likely_error_source: string | null
          projection_consistent: boolean | null
          quality_score: number | null
          scale_consistent: boolean | null
          skeleton_json: Json
          takeoff_id: string
          visual_verdict: string | null
        }
        Insert: {
          chamfer_distance_m?: number | null
          created_at?: string
          id?: string
          length_ratio?: number | null
          likely_error_source?: string | null
          projection_consistent?: boolean | null
          quality_score?: number | null
          scale_consistent?: boolean | null
          skeleton_json: Json
          takeoff_id: string
          visual_verdict?: string | null
        }
        Update: {
          chamfer_distance_m?: number | null
          created_at?: string
          id?: string
          length_ratio?: number | null
          likely_error_source?: string | null
          projection_consistent?: boolean | null
          quality_score?: number | null
          scale_consistent?: boolean | null
          skeleton_json?: Json
          takeoff_id?: string
          visual_verdict?: string | null
        }
        Relationships: []
      }
      warranty_certificates: {
        Row: {
          certificate_number: string
          city: string
          client_name: string
          completion_date: string
          contract_amount: string
          created_at: string
          id: string
          invoice_number: string
          project_address: string
          reference_id: string | null
          roof_type: string
          soumission_id: string | null
          surface_area: string
          warranty_years: number
        }
        Insert: {
          certificate_number: string
          city?: string
          client_name: string
          completion_date?: string
          contract_amount?: string
          created_at?: string
          id?: string
          invoice_number?: string
          project_address: string
          reference_id?: string | null
          roof_type?: string
          soumission_id?: string | null
          surface_area?: string
          warranty_years?: number
        }
        Update: {
          certificate_number?: string
          city?: string
          client_name?: string
          completion_date?: string
          contract_amount?: string
          created_at?: string
          id?: string
          invoice_number?: string
          project_address?: string
          reference_id?: string | null
          roof_type?: string
          soumission_id?: string | null
          surface_area?: string
          warranty_years?: number
        }
        Relationships: []
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      find_building_polygon: {
        Args: { p_lat: number; p_lng: number; p_radius_meters?: number }
        Returns: {
          distance_meters: number
          geojson: string
          id: number
          largeur: number
          lot_geojson: string
          no_lot: string
          perimetre: number
          profondeur: number
          superficie: number
        }[]
      }
      find_buildings_near_point: {
        Args: { p_lat: number; p_lng: number; p_radius_meters?: number }
        Returns: {
          distance_meters: number
          fid: number
          id: number
          Perimetre: number
          Superficie: number
        }[]
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
    Enums: {},
  },
} as const
