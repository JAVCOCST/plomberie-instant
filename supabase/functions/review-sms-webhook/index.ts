import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const form = await req.formData();
    const sid = String(form.get("MessageSid") || form.get("SmsSid") || "");
    const status = String(form.get("MessageStatus") || form.get("SmsStatus") || "").toLowerCase();
    const errorCode = form.get("ErrorCode")?.toString();
    const from = String(form.get("From") || "");
    const body = String(form.get("Body") || "").trim().toUpperCase();

    // Inbound STOP handling (Twilio inbound webhook can also point here)
    if (body === "STOP" || body === "ARRET" || body === "ARRÊT" || body === "UNSUBSCRIBE") {
      if (from) await sb.from("review_optouts").upsert({ phone: from, reason: "STOP reply" }, { onConflict: "phone" });
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Vous êtes désinscrit. Merci.</Message></Response>`;
      return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
    }

    if (sid) {
      await sb.from("review_sms_log").update({
        status: status || "unknown",
        error_message: errorCode ? `Twilio code ${errorCode}` : null,
        updated_at: new Date().toISOString(),
      }).eq("twilio_sid", sid);
    }

    return new Response("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (e) {
    console.error("review-sms-webhook error", e);
    return new Response("ERR", { status: 200 });
  }
});