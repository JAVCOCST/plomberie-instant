import { cors, assertOrigin } from "../_shared/hardening.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (origin && origin !== "null" && !assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  try {
    const { requestId, signerIds } = await req.json();
    if (!requestId) return new Response(JSON.stringify({ error: "requestId requis" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: reqRow } = await sb.from("contract_signature_requests").select("*").eq("id", requestId).single();
    if (!reqRow) return new Response(JSON.stringify({ error: "Demande introuvable" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const q = sb.from("contract_signers").select("*").eq("request_id", requestId).neq("status", "signed");
    const { data: signers } = signerIds?.length ? await q.in("id", signerIds) : await q;
    const base = (origin && /^https?:\/\//.test(origin)) ? origin : "https://soumission.toituresvb.ca";
    const results: any[] = [];
    for (const s of signers || []) {
      if (!s.email || !RESEND_API_KEY) { results.push({ id: s.id, ok: false }); continue; }
      const link = `${base.replace(/\/$/, "")}/sign/${s.signer_token}`;
      const html = `<p>Bonjour ${esc(s.name)},</p><p>Rappel: votre contrat est en attente de signature.</p><p><a href="${link}">Ouvrir le contrat</a></p>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Toitures VB Inc. <contrats@toituresvb.ca>", to: [s.email], subject: `Rappel — ${reqRow.subject}`, html }),
      });
      results.push({ id: s.id, ok: r.ok });
      await sb.from("contract_signature_events").insert({ request_id: requestId, signer_id: s.id, event_type: "reminder_sent" });
    }
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});