import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * dispatch-send-sms
 * Envoie un SMS de récap hebdo à chaque employé affecté dans le Dispatch.
 * Body: { messages: [{ to: "+15145551234", name: "Jean", body: "..." }] }
 * Retourne le détail par destinataire (success / error).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OutMessage {
  to: string;
  name?: string;
  body: string;
}

function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;          // NA local
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SID = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
    const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
    const FROM = normalizePhone(Deno.env.get("TWILIO_FROM_NUMBER")?.trim() || "");
    if (!SID || !TOKEN || !FROM) {
      return new Response(
        JSON.stringify({ error: "Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER manquant)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await req.json().catch(() => null);
    const messages: OutMessage[] = Array.isArray(json?.messages) ? json.messages : [];
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "Aucun message à envoyer" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = btoa(`${SID}:${TOKEN}`);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;

    const results = await Promise.all(messages.map(async (m) => {
      const to = normalizePhone(m.to);
      if (!to) {
        return { name: m.name, to: m.to, success: false, error: "Numéro invalide" };
      }
      if (!m.body || m.body.length > 1500) {
        return { name: m.name, to, success: false, error: "Corps de message invalide" };
      }
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: FROM, To: to, Body: m.body }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          console.error("Twilio error", {
            to, from: FROM, http: resp.status,
            twilio_code: data?.code, twilio_message: data?.message,
            more_info: data?.more_info,
            sid_prefix: SID.slice(0, 2),
            sid_length: SID.length,
            token_length: TOKEN.length,
            token_hex_format: /^[a-f0-9]{32}$/i.test(TOKEN),
          });
          return {
            name: m.name, to, success: false,
            error: `[${data?.code ?? resp.status}] ${data?.message || "Erreur Twilio"}`,
            twilio_code: data?.code,
            http_status: resp.status,
          };
        }
        return { name: m.name, to, success: true, sid: data?.sid };
      } catch (e) {
        return { name: m.name, to, success: false, error: (e as Error).message };
      }
    }));

    const sent = results.filter(r => r.success).length;
    const failed = results.length - sent;
    return new Response(JSON.stringify({ sent, failed, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("dispatch-send-sms error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});