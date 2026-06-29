import { cors, assertOrigin } from "../_shared/hardening.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (origin && origin !== "null" && !assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  try {
    const { requestId, reason } = await req.json();
    if (!requestId) return new Response(JSON.stringify({ error: "requestId requis" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    await sb.from("contract_signature_requests").update({ status: "voided" }).eq("id", requestId);
    await sb.from("contract_signature_events").insert({ request_id: requestId, event_type: "voided", metadata: { reason } });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});