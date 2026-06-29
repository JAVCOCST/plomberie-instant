// Knowledge + conversation logging for the Marie-Ève customer chats.
// Both helpers use the service-role key (they run server-side in the edge
// function and must bypass RLS), and both fail soft: a knowledge-fetch or
// logging error must never break the chat itself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function admin() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

// Builds a text block of staff-authored directives to append to the system
// prompt. `source` is 'advisor' or 'repair'; rows scoped 'all' apply to both.
export async function fetchKnowledgeBlock(source: "advisor" | "repair"): Promise<string> {
  try {
    const sb = admin();
    const { data, error } = await sb
      .from("marieve_knowledge")
      .select("kind,title,content,scope,priority")
      .eq("enabled", true)
      .in("scope", ["all", source])
      .order("priority", { ascending: false });
    if (error || !data || !data.length) return "";

    const facts = data.filter((r: any) => r.kind === "fact");
    const allow = data.filter((r: any) => r.kind === "allow");
    const forbid = data.filter((r: any) => r.kind === "forbid");
    const qa = data.filter((r: any) => r.kind === "qa");

    const parts: string[] = ["\n\n=== DIRECTIVES INTERNES (à respecter absolument) ==="];
    if (facts.length) parts.push("INFORMATIONS QUE TU PEUX DONNER:\n" + facts.map((r: any) => "- " + r.content).join("\n"));
    if (allow.length) parts.push("TU PEUX:\n" + allow.map((r: any) => "- " + r.content).join("\n"));
    if (forbid.length) parts.push("TU NE DOIS JAMAIS:\n" + forbid.map((r: any) => "- " + r.content).join("\n"));
    if (qa.length) parts.push("RÉPONSES VALIDÉES PAR L'ÉQUIPE (réutilise-les si la question correspond):\n" + qa.map((r: any) => `Q: ${r.title || ""}\nR: ${r.content}`).join("\n\n"));
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

// Persists one (question -> answer) exchange. Fire-and-forget at the call site.
export async function logExchange(args: {
  source: "advisor" | "repair";
  userMessage: string;
  assistantMessage: string;
  context: unknown;
}): Promise<void> {
  try {
    await admin().from("marieve_exchanges").insert({
      source: args.source,
      user_message: args.userMessage,
      assistant_message: args.assistantMessage,
      context: args.context ?? null,
    });
  } catch {
    // ignore — logging must never affect the chat
  }
}

// Runs a promise to completion even after the response stream has closed,
// using the edge runtime's waitUntil when available.
export function runInBackground(p: Promise<unknown>): void {
  try {
    const er = (globalThis as any).EdgeRuntime;
    if (er && typeof er.waitUntil === "function") er.waitUntil(p);
    else void p;
  } catch {
    void p;
  }
}
