import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(p: string): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (p.startsWith("+")) return p;
  return null;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? "");
}

function moisAnnee(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-CA", { month: "long", year: "numeric" });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { campaignId, recipients } = await req.json();
    if (!campaignId || !Array.isArray(recipients)) {
      return new Response(JSON.stringify({ error: "campaignId & recipients requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      throw new Error("Twilio non configuré");
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: campaign, error: campErr } = await sb
      .from("review_campaigns").select("*").eq("id", campaignId).single();
    if (campErr || !campaign) throw new Error("Campagne introuvable");

    await sb.from("review_campaigns").update({ status: "sending" }).eq("id", campaignId);

    const { data: optouts } = await sb.from("review_optouts").select("phone");
    const optoutSet = new Set((optouts || []).map((o: any) => o.phone));

    const statusCallback = `${SUPABASE_URL}/functions/v1/review-sms-webhook`;
    let sent = 0, failed = 0;

    for (const r of recipients) {
      const phone = normalizePhone(r.phone);
      if (!phone || optoutSet.has(phone)) {
        failed++;
        await sb.from("review_sms_log").insert({
          campaign_id: campaignId,
          soumission_id: r.soumission_id ?? null,
          client_first_name: r.first_name ?? null,
          client_last_name: r.last_name ?? null,
          client_phone: r.phone,
          message_body: "",
          status: "failed",
          error_message: optoutSet.has(phone) ? "Désabonné" : "Téléphone invalide",
        });
        continue;
      }

      const body = renderTemplate(campaign.template_body, {
        prenom: r.first_name ?? "",
        nom: r.last_name ?? "",
        mois_année: moisAnnee(r.service_date),
        mois_annee: moisAnnee(r.service_date),
        lien: campaign.google_review_url ?? "",
      });

      try {
        const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
        const params = new URLSearchParams({
          To: phone, From: TWILIO_FROM_NUMBER, Body: body,
          StatusCallback: statusCallback,
        });
        const tr = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params },
        );
        const tdata = await tr.json();
        if (!tr.ok) throw new Error(tdata.message || "Twilio error");

        sent++;
        await sb.from("review_sms_log").insert({
          campaign_id: campaignId,
          soumission_id: r.soumission_id ?? null,
          client_first_name: r.first_name ?? null,
          client_last_name: r.last_name ?? null,
          client_phone: phone,
          message_body: body,
          twilio_sid: tdata.sid,
          status: "sent",
        });
      } catch (e: any) {
        failed++;
        await sb.from("review_sms_log").insert({
          campaign_id: campaignId,
          soumission_id: r.soumission_id ?? null,
          client_first_name: r.first_name ?? null,
          client_last_name: r.last_name ?? null,
          client_phone: phone,
          message_body: body,
          status: "failed",
          error_message: String(e?.message || e),
        });
      }
    }

    await sb.from("review_campaigns").update({
      status: failed === recipients.length ? "failed" : "sent",
      sent_count: sent, failed_count: failed,
      total_recipients: recipients.length,
      sent_at: new Date().toISOString(),
    }).eq("id", campaignId);

    return new Response(JSON.stringify({ sent, failed, total: recipients.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("review-send-batch error", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});