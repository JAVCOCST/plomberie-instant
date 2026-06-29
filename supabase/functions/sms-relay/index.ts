import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * SMS Relay — 3-way conversation bridge
 * 
 * Twilio webhook: when an SMS arrives on the Twilio number,
 * forward it to the other party and log in DB.
 * 
 * - Message from CLIENT → forward to OWNER (with client ID)
 * - Message from OWNER  → forward to last active CLIENT (from DB)
 */

serve(async (req) => {
  if (req.method === "GET" || req.method === "OPTIONS") {
    return new Response("SMS Relay active", { status: 200 });
  }

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER")!;
    const OWNER_PHONE = Deno.env.get("OWNER_PHONE")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !OWNER_PHONE) {
      console.error("Missing env vars");
      return twimlEmpty();
    }

    // Parse Twilio webhook (application/x-www-form-urlencoded)
    let from = "", body = "";
    const ct = req.headers.get("content-type") || "";

    if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      from = params.get("From") || "";
      body = params.get("Body") || "";
    } else {
      const json = await req.json();
      from = json.From || json.from || "";
      body = json.Body || json.body || "";
    }

    console.log(`SMS relay: from=${from}, body=${body.substring(0, 80)}`);
    if (!from || !body) return twimlEmpty();

    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

    const sendSms = async (to: string, msg: string) => {
      const resp = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: to, Body: msg }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error(`SMS to ${to} failed:`, err);
      }
      return resp.ok;
    };

    const dbHeaders = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    const logMessage = async (clientPhone: string, sender: string, content: string) => {
      if (!SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
          method: "POST",
          headers: dbHeaders,
          body: JSON.stringify({ client_phone: clientPhone, sender, content }),
        });
      } catch (e) {
        console.error("Failed to log message:", e);
      }
    };

    const normalize = (p: string) => p.replace(/[\s\-\(\)\.]/g, "");
    const fromNorm = normalize(from);
    const ownerNorm = normalize(OWNER_PHONE);
    const isFromOwner = fromNorm === ownerNorm || fromNorm.endsWith(ownerNorm.slice(-10));

    if (isFromOwner) {
      // Parse optional prefix: "1234: message" or "1234 message"
      const prefixMatch = body.match(/^(\d{4,10})\s*[:]\s*([\s\S]+)$/);
      let targetClient: string | null = null;
      let messageBody = body;

      if (prefixMatch) {
        const prefix = prefixMatch[1];
        messageBody = prefixMatch[2].trim();

        // Find client whose phone ends with this prefix
        if (SUPABASE_URL) {
          try {
            const resp = await fetch(
              `${SUPABASE_URL}/rest/v1/sms_conversations?is_active=eq.true&order=updated_at.desc`,
              { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
            );
            const rows = await resp.json();
            const match = (rows || []).find((r: any) => {
              const norm = normalize(r.client_phone);
              return norm.endsWith(prefix);
            });
            if (match) targetClient = match.client_phone;
          } catch (e) {
            console.error("DB prefix lookup failed:", e);
          }
        }

        if (!targetClient) {
          await sendSms(OWNER_PHONE, `Aucun client actif dont le numéro finit par ${prefix}.`);
          return twimlEmpty();
        }
      } else {
        // No prefix — check how many active conversations
        let activeClients: Array<{ client_phone: string; client_name: string }> = [];
        if (SUPABASE_URL) {
          try {
            const resp = await fetch(
              `${SUPABASE_URL}/rest/v1/sms_conversations?is_active=eq.true&order=updated_at.desc&select=client_phone,client_name`,
              { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
            );
            activeClients = await resp.json() || [];
          } catch (e) {
            console.error("DB lookup failed:", e);
          }
        }

        if (activeClients.length === 0) {
          await sendSms(OWNER_PHONE, "Aucune conversation client active.");
          return twimlEmpty();
        } else if (activeClients.length === 1) {
          targetClient = activeClients[0].client_phone;
        } else {
          // Multiple active clients — ask owner to specify
          const list = activeClients.map((c) => {
            const last4 = c.client_phone.replace(/\D/g, '').slice(-4);
            return `  ${last4}: ${c.client_name || 'Inconnu'} (${c.client_phone})`;
          }).join('\n');
          await sendSms(OWNER_PHONE, `Plusieurs clients actifs. Précisez le préfixe (4 derniers chiffres) :\n\n${list}\n\nEx: 1234: Votre message`);
          return twimlEmpty();
        }
      }

      console.log(`Owner reply → forwarding to ${targetClient}`);
      await sendSms(targetClient!, `${messageBody}\n\n— Toitures VB`);
      await logMessage(targetClient!, "owner", messageBody);

      // Update conversation timestamp
      if (SUPABASE_URL) {
        try {
          await fetch(
            `${SUPABASE_URL}/rest/v1/sms_conversations?client_phone=eq.${encodeURIComponent(targetClient!)}`,
            {
              method: "PATCH",
              headers: dbHeaders,
              body: JSON.stringify({ updated_at: new Date().toISOString() }),
            }
          );
        } catch (_) { /* ignore */ }
      }
    } else {
      // Client replying → forward to owner
      console.log(`Client ${from} → forwarding to owner`);
      await sendSms(OWNER_PHONE, `Client (${from}):\n${body}`);
      await logMessage(from, "client", body);

      // Update conversation timestamp
      if (SUPABASE_URL) {
        try {
          await fetch(
            `${SUPABASE_URL}/rest/v1/sms_conversations?client_phone=eq.${encodeURIComponent(from)}`,
            {
              method: "PATCH",
              headers: dbHeaders,
              body: JSON.stringify({ updated_at: new Date().toISOString() }),
            }
          );
        } catch (_) { /* ignore */ }
      }
    }

    return twimlEmpty();
  } catch (e) {
    console.error("sms-relay error:", e);
    return twimlEmpty();
  }
});

function twimlEmpty() {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { "Content-Type": "text/xml" } },
  );
}

async function findLastClientFromTwilio(
  accountSid: string,
  authHeader: string,
  twilioNumber: string,
  ownerPhone: string,
): Promise<string | null> {
  const normalize = (p: string) => p.replace(/[\s\-\(\)\.]/g, "");
  const ownerNorm = normalize(ownerPhone);

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?To=${encodeURIComponent(twilioNumber)}&PageSize=20`;
    const resp = await fetch(url, { headers: { Authorization: `Basic ${authHeader}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    for (const msg of (data.messages || [])) {
      const senderNorm = normalize(msg.from || "");
      if (senderNorm !== ownerNorm && !senderNorm.endsWith(ownerNorm.slice(-10))) {
        return msg.from;
      }
    }
    return null;
  } catch {
    return null;
  }
}
