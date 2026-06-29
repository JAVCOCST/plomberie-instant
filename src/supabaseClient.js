import { createClient } from "@supabase/supabase-js";

// Les valeurs par défaut permettent à l'app de fonctionner même sans config locale.
// La clé publique (publishable/anon) est conçue pour être exposée côté client.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://rnfwtloheitkhbnovgch.supabase.co";

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_fZNIEWOLSltlX2lOhcRKaA_k0oT9MSy";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
