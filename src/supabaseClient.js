import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://rnfwtloheitkhbnovgch.supabase.co";

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_fZNIEWOLSltlX2lOhcRKaA_k0oT9MSy";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
