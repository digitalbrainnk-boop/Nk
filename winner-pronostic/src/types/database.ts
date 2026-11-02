// Fichier généré par scripts/gen-db-types.mjs — ne pas modifier à la main.
// Régénérer après chaque migration : npm run db:types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          id: number;
          admin_id: string | null;
          action: string;
          target_table: string | null;
          target_id: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          admin_id?: string | null;
          action: string;
          target_table?: string | null;
          target_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          admin_id?: string | null;
          action?: string;
          target_table?: string | null;
          target_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      api_cache: {
        Row: {
          cache_key: string;
          payload: Json;
          fetched_at: string;
          expires_at: string;
        };
        Insert: {
          cache_key: string;
          payload: Json;
          fetched_at?: string;
          expires_at: string;
        };
        Update: {
          cache_key?: string;
          payload?: Json;
          fetched_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          description: string | null;
          is_public: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          description?: string | null;
          is_public?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          description?: string | null;
          is_public?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      competitions: {
        Row: {
          id: number;
          sport: string;
          external_id: number;
          name: string;
          type: string;
          country_name: string;
          country_code: string | null;
          country_flag_url: string | null;
          logo_url: string | null;
          current_season: string | null;
          is_enabled: boolean;
          is_featured: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: never;
          sport: string;
          external_id: number;
          name: string;
          type?: string;
          country_name: string;
          country_code?: string | null;
          country_flag_url?: string | null;
          logo_url?: string | null;
          current_season?: string | null;
          is_enabled?: boolean;
          is_featured?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: never;
          sport?: string;
          external_id?: number;
          name?: string;
          type?: string;
          country_name?: string;
          country_code?: string | null;
          country_flag_url?: string | null;
          logo_url?: string | null;
          current_season?: string | null;
          is_enabled?: boolean;
          is_featured?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "competitions_sport_fkey";
            columns: ["sport"];
            isOneToOne: false;
            referencedRelation: "sports";
            referencedColumns: ["code"];
          },
        ];
      };
      coupon_booking_codes: {
        Row: {
          id: number;
          coupon_id: string;
          bookmaker: string;
          country_code: string | null;
          code: string;
          created_by: string | null;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: never;
          coupon_id: string;
          bookmaker: string;
          country_code?: string | null;
          code: string;
          created_by?: string | null;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          id?: never;
          coupon_id?: string;
          bookmaker?: string;
          country_code?: string | null;
          code?: string;
          created_by?: string | null;
          created_at?: string;
          expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_booking_codes_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
        ];
      };
      coupon_selections: {
        Row: {
          id: number;
          coupon_id: string;
          event_id: number;
          pick_id: string | null;
          market: string;
          line: number | null;
          selection: string;
          odd: number;
          probability: number | null;
          result: Database["public"]["Enums"]["pick_result"];
        };
        Insert: {
          id?: never;
          coupon_id: string;
          event_id: number;
          pick_id?: string | null;
          market: string;
          line?: number | null;
          selection: string;
          odd: number;
          probability?: number | null;
          result?: Database["public"]["Enums"]["pick_result"];
        };
        Update: {
          id?: never;
          coupon_id?: string;
          event_id?: number;
          pick_id?: string | null;
          market?: string;
          line?: number | null;
          selection?: string;
          odd?: number;
          probability?: number | null;
          result?: Database["public"]["Enums"]["pick_result"];
        };
        Relationships: [
          {
            foreignKeyName: "coupon_selections_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_selections_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_selections_pick_id_fkey";
            columns: ["pick_id"];
            isOneToOne: false;
            referencedRelation: "prediction_picks";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          id: string;
          user_id: string | null;
          source: string;
          title: string | null;
          target_odds: number | null;
          risk_level: Database["public"]["Enums"]["risk_level"] | null;
          period: Database["public"]["Enums"]["coupon_period"] | null;
          sports: string[];
          total_odds: number;
          estimated_probability: number | null;
          analysis: Json | null;
          is_featured: boolean;
          is_premium: boolean;
          featured_by: string | null;
          status: Database["public"]["Enums"]["pick_result"];
          created_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          source: string;
          title?: string | null;
          target_odds?: number | null;
          risk_level?: Database["public"]["Enums"]["risk_level"] | null;
          period?: Database["public"]["Enums"]["coupon_period"] | null;
          sports?: string[];
          total_odds: number;
          estimated_probability?: number | null;
          analysis?: Json | null;
          is_featured?: boolean;
          is_premium?: boolean;
          featured_by?: string | null;
          status?: Database["public"]["Enums"]["pick_result"];
          created_at?: string;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          source?: string;
          title?: string | null;
          target_odds?: number | null;
          risk_level?: Database["public"]["Enums"]["risk_level"] | null;
          period?: Database["public"]["Enums"]["coupon_period"] | null;
          sports?: string[];
          total_odds?: number;
          estimated_probability?: number | null;
          analysis?: Json | null;
          is_featured?: boolean;
          is_premium?: boolean;
          featured_by?: string | null;
          status?: Database["public"]["Enums"]["pick_result"];
          created_at?: string;
          settled_at?: string | null;
        };
        Relationships: [];
      };
      event_incidents: {
        Row: {
          id: number;
          event_id: number;
          minute: number | null;
          extra_minute: number | null;
          period: string | null;
          team_id: number | null;
          player_name: string | null;
          assist_name: string | null;
          type: string;
          detail: string | null;
          comments: string | null;
          incident_key: string;
          created_at: string;
        };
        Insert: {
          id?: never;
          event_id: number;
          minute?: number | null;
          extra_minute?: number | null;
          period?: string | null;
          team_id?: number | null;
          player_name?: string | null;
          assist_name?: string | null;
          type: string;
          detail?: string | null;
          comments?: string | null;
          incident_key: string;
          created_at?: string;
        };
        Update: {
          id?: never;
          event_id?: number;
          minute?: number | null;
          extra_minute?: number | null;
          period?: string | null;
          team_id?: number | null;
          player_name?: string | null;
          assist_name?: string | null;
          type?: string;
          detail?: string | null;
          comments?: string | null;
          incident_key?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_incidents_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_incidents_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      event_odds: {
        Row: {
          id: number;
          event_id: number;
          bookmaker_id: number;
          bookmaker_name: string;
          market: string;
          line: number | null;
          selection: string;
          odd: number;
          updated_at: string;
        };
        Insert: {
          id?: never;
          event_id: number;
          bookmaker_id: number;
          bookmaker_name: string;
          market: string;
          line?: number | null;
          selection: string;
          odd: number;
          updated_at?: string;
        };
        Update: {
          id?: never;
          event_id?: number;
          bookmaker_id?: number;
          bookmaker_name?: string;
          market?: string;
          line?: number | null;
          selection?: string;
          odd?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_odds_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          id: number;
          sport: string;
          external_id: number;
          competition_id: number;
          season: string | null;
          round: string | null;
          starts_at: string;
          status_short: string;
          status_long: string | null;
          status_group: string;
          live_clock: string | null;
          elapsed: number | null;
          home_team_id: number;
          away_team_id: number;
          home_score: number | null;
          away_score: number | null;
          period_scores: Json | null;
          venue_name: string | null;
          venue_city: string | null;
          referee: string | null;
          last_synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: never;
          sport: string;
          external_id: number;
          competition_id: number;
          season?: string | null;
          round?: string | null;
          starts_at: string;
          status_short?: string;
          status_long?: string | null;
          status_group?: string;
          live_clock?: string | null;
          elapsed?: number | null;
          home_team_id: number;
          away_team_id: number;
          home_score?: number | null;
          away_score?: number | null;
          period_scores?: Json | null;
          venue_name?: string | null;
          venue_city?: string | null;
          referee?: string | null;
          last_synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: never;
          sport?: string;
          external_id?: number;
          competition_id?: number;
          season?: string | null;
          round?: string | null;
          starts_at?: string;
          status_short?: string;
          status_long?: string | null;
          status_group?: string;
          live_clock?: string | null;
          elapsed?: number | null;
          home_team_id?: number;
          away_team_id?: number;
          home_score?: number | null;
          away_score?: number | null;
          period_scores?: Json | null;
          venue_name?: string | null;
          venue_city?: string | null;
          referee?: string | null;
          last_synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_away_team_id_sport_fkey";
            columns: ["away_team_id", "sport"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "sport"];
          },
          {
            foreignKeyName: "events_competition_id_sport_fkey";
            columns: ["competition_id", "sport"];
            isOneToOne: false;
            referencedRelation: "competitions";
            referencedColumns: ["id", "sport"];
          },
          {
            foreignKeyName: "events_home_team_id_sport_fkey";
            columns: ["home_team_id", "sport"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "sport"];
          },
          {
            foreignKeyName: "events_sport_fkey";
            columns: ["sport"];
            isOneToOne: false;
            referencedRelation: "sports";
            referencedColumns: ["code"];
          },
        ];
      };
      favorite_teams: {
        Row: {
          user_id: string;
          team_id: number;
          created_at: string;
        };
        Insert: {
          user_id?: string;
          team_id: number;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          team_id?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "favorite_teams_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_log: {
        Row: {
          id: number;
          user_id: string;
          event_id: number | null;
          kind: string;
          dedupe_key: string;
          sent_at: string;
        };
        Insert: {
          id?: never;
          user_id: string;
          event_id?: number | null;
          kind: string;
          dedupe_key?: string;
          sent_at?: string;
        };
        Update: {
          id?: never;
          user_id?: string;
          event_id?: number | null;
          kind?: string;
          dedupe_key?: string;
          sent_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_log_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          user_id: string | null;
          plan_code: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_transaction_id: string;
          provider_reference: string | null;
          amount_xof: number;
          currency: string;
          operator: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          raw_payload: Json | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          plan_code: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_transaction_id: string;
          provider_reference?: string | null;
          amount_xof: number;
          currency?: string;
          operator?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          raw_payload?: Json | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          plan_code?: string;
          provider?: Database["public"]["Enums"]["payment_provider"];
          provider_transaction_id?: string;
          provider_reference?: string | null;
          amount_xof?: number;
          currency?: string;
          operator?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          raw_payload?: Json | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_plan_code_fkey";
            columns: ["plan_code"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["code"];
          },
        ];
      };
      plans: {
        Row: {
          code: string;
          name: string;
          price_xof: number;
          duration_days: number;
          is_active: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          name: string;
          price_xof: number;
          duration_days: number;
          is_active?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          name?: string;
          price_xof?: number;
          duration_days?: number;
          is_active?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prediction_picks: {
        Row: {
          id: string;
          prediction_id: string;
          event_id: number;
          competition_id: number;
          sport: string;
          market: string;
          line: number | null;
          selection: string;
          probability: number;
          best_odd: number | null;
          bookmaker_name: string | null;
          implied_probability: number | null;
          edge: number | null;
          is_value_bet: boolean;
          confidence: number;
          is_premium: boolean;
          published_at: string;
          result: Database["public"]["Enums"]["pick_result"];
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          prediction_id: string;
          event_id: number;
          competition_id: number;
          sport: string;
          market: string;
          line?: number | null;
          selection: string;
          probability: number;
          best_odd?: number | null;
          bookmaker_name?: string | null;
          implied_probability?: number | null;
          edge?: number | null;
          is_value_bet?: boolean;
          confidence: number;
          is_premium?: boolean;
          published_at?: string;
          result?: Database["public"]["Enums"]["pick_result"];
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          prediction_id?: string;
          event_id?: number;
          competition_id?: number;
          sport?: string;
          market?: string;
          line?: number | null;
          selection?: string;
          probability?: number;
          best_odd?: number | null;
          bookmaker_name?: string | null;
          implied_probability?: number | null;
          edge?: number | null;
          is_value_bet?: boolean;
          confidence?: number;
          is_premium?: boolean;
          published_at?: string;
          result?: Database["public"]["Enums"]["pick_result"];
          settled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prediction_picks_competition_id_fkey";
            columns: ["competition_id"];
            isOneToOne: false;
            referencedRelation: "competitions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prediction_picks_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prediction_picks_prediction_id_fkey";
            columns: ["prediction_id"];
            isOneToOne: false;
            referencedRelation: "predictions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prediction_picks_sport_fkey";
            columns: ["sport"];
            isOneToOne: false;
            referencedRelation: "sports";
            referencedColumns: ["code"];
          },
        ];
      };
      predictions: {
        Row: {
          id: string;
          event_id: number;
          model_version: string;
          expected_home: number;
          expected_away: number;
          home_rating: number | null;
          away_rating: number | null;
          probabilities: Json;
          inputs: Json | null;
          computed_at: string;
        };
        Insert: {
          id?: string;
          event_id: number;
          model_version: string;
          expected_home: number;
          expected_away: number;
          home_rating?: number | null;
          away_rating?: number | null;
          probabilities: Json;
          inputs?: Json | null;
          computed_at?: string;
        };
        Update: {
          id?: string;
          event_id?: number;
          model_version?: string;
          expected_home?: number;
          expected_away?: number;
          home_rating?: number | null;
          away_rating?: number | null;
          probabilities?: Json;
          inputs?: Json | null;
          computed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "predictions_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string;
          email: string | null;
          phone: string | null;
          birth_date: string;
          country_code: string;
          role: Database["public"]["Enums"]["user_role"];
          notify_kickoff: boolean;
          notify_goals: boolean;
          kickoff_lead_minutes: number;
          terms_accepted_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          email?: string | null;
          phone?: string | null;
          birth_date: string;
          country_code?: string;
          role?: Database["public"]["Enums"]["user_role"];
          notify_kickoff?: boolean;
          notify_goals?: boolean;
          kickoff_lead_minutes?: number;
          terms_accepted_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          email?: string | null;
          phone?: string | null;
          birth_date?: string;
          country_code?: string;
          role?: Database["public"]["Enums"]["user_role"];
          notify_kickoff?: boolean;
          notify_goals?: boolean;
          kickoff_lead_minutes?: number;
          terms_accepted_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth_key: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string;
          endpoint: string;
          p256dh: string;
          auth_key: string;
          user_agent?: string | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth_key?: string;
          user_agent?: string | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          key: string;
          window_start: string;
          hits: number;
        };
        Insert: {
          key: string;
          window_start: string;
          hits: number;
        };
        Update: {
          key?: string;
          window_start?: string;
          hits?: number;
        };
        Relationships: [];
      };
      sports: {
        Row: {
          code: string;
          name: string;
          emoji: string;
          has_draw: boolean;
          is_enabled: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          name: string;
          emoji: string;
          has_draw: boolean;
          is_enabled?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          name?: string;
          emoji?: string;
          has_draw?: boolean;
          is_enabled?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      standings: {
        Row: {
          competition_id: number;
          season: string;
          group_name: string;
          team_id: number;
          rank: number;
          points: number;
          played: number;
          won: number;
          drawn: number;
          lost: number;
          scored: number;
          conceded: number;
          home_played: number;
          home_won: number;
          home_drawn: number;
          home_lost: number;
          home_scored: number;
          home_conceded: number;
          away_played: number;
          away_won: number;
          away_drawn: number;
          away_lost: number;
          away_scored: number;
          away_conceded: number;
          form: string | null;
          description: string | null;
          updated_at: string;
        };
        Insert: {
          competition_id: number;
          season: string;
          group_name?: string;
          team_id: number;
          rank: number;
          points?: number;
          played?: number;
          won?: number;
          drawn?: number;
          lost?: number;
          scored?: number;
          conceded?: number;
          home_played?: number;
          home_won?: number;
          home_drawn?: number;
          home_lost?: number;
          home_scored?: number;
          home_conceded?: number;
          away_played?: number;
          away_won?: number;
          away_drawn?: number;
          away_lost?: number;
          away_scored?: number;
          away_conceded?: number;
          form?: string | null;
          description?: string | null;
          updated_at?: string;
        };
        Update: {
          competition_id?: number;
          season?: string;
          group_name?: string;
          team_id?: number;
          rank?: number;
          points?: number;
          played?: number;
          won?: number;
          drawn?: number;
          lost?: number;
          scored?: number;
          conceded?: number;
          home_played?: number;
          home_won?: number;
          home_drawn?: number;
          home_lost?: number;
          home_scored?: number;
          home_conceded?: number;
          away_played?: number;
          away_won?: number;
          away_drawn?: number;
          away_lost?: number;
          away_scored?: number;
          away_conceded?: number;
          form?: string | null;
          description?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "standings_competition_id_fkey";
            columns: ["competition_id"];
            isOneToOne: false;
            referencedRelation: "competitions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "standings_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_code: string;
          payment_id: string | null;
          status: Database["public"]["Enums"]["subscription_status"];
          starts_at: string;
          ends_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan_code: string;
          payment_id?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          starts_at?: string;
          ends_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          plan_code?: string;
          payment_id?: string | null;
          status?: Database["public"]["Enums"]["subscription_status"];
          starts_at?: string;
          ends_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: true;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_plan_code_fkey";
            columns: ["plan_code"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["code"];
          },
        ];
      };
      sync_runs: {
        Row: {
          id: number;
          job: string;
          status: string;
          api_requests: number;
          items_upserted: number;
          error: string | null;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: never;
          job: string;
          status?: string;
          api_requests?: number;
          items_upserted?: number;
          error?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: never;
          job?: string;
          status?: string;
          api_requests?: number;
          items_upserted?: number;
          error?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: number;
          sport: string;
          external_id: number;
          name: string;
          short_code: string | null;
          country_name: string | null;
          logo_url: string | null;
          is_national: boolean;
          venue_name: string | null;
          elo_rating: number;
          elo_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: never;
          sport: string;
          external_id: number;
          name: string;
          short_code?: string | null;
          country_name?: string | null;
          logo_url?: string | null;
          is_national?: boolean;
          venue_name?: string | null;
          elo_rating?: number;
          elo_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: never;
          sport?: string;
          external_id?: number;
          name?: string;
          short_code?: string | null;
          country_name?: string | null;
          logo_url?: string | null;
          is_national?: boolean;
          venue_name?: string | null;
          elo_rating?: number;
          elo_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_sport_fkey";
            columns: ["sport"];
            isOneToOne: false;
            referencedRelation: "sports";
            referencedColumns: ["code"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: { Args: never; Returns: boolean };
      is_premium: { Args: never; Returns: boolean };
      is_valid_market: { Args: { p_market: string }; Returns: boolean };
      is_valid_selection: { Args: { p_market: string; p_line: number; p_selection: string }; Returns: boolean };
      prune_rate_limits: { Args: { p_older_than_seconds?: number }; Returns: number };
      rate_limit_hit: { Args: { p_key: string; p_limit: number; p_window_seconds: number }; Returns: boolean };
    };
    Enums: {
      coupon_period: "jour" | "weekend" | "long_terme";
      payment_provider: "cinetpay" | "fedapay";
      payment_status: "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
      pick_result: "pending" | "won" | "lost" | "void";
      risk_level: "prudent" | "equilibre" | "audacieux";
      subscription_status: "active" | "expired" | "cancelled";
      user_role: "user" | "admin";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
