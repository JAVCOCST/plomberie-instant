import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HANDOFF_PROMPT = `Tu es un agent de transfert chez Toitures VB. Tu reçois la transcription d'une conversation entre un client et notre assistant IA.

Tu dois retourner un JSON avec exactement 3 clés:
1. "summary": Un résumé de 3-4 phrases maximum pour l'équipe interne (nom, adresse, problème, urgence, détails clés).
2. "intro_client": Un court message chaleureux (2 phrases max) pour le client, disant qu'un conseiller prendra le relais par texto. Tutoie pas, vouvoie.
3. "extracted": Un objet JSON avec les champs: name, phone, address, problem_type, urgency, roof_age, details.

IMPORTANT: Retourne UNIQUEMENT du JSON valide, rien d'autre.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientName, clientPhone, address, messages, workType, buildingType } = await req.json();

    if (!clientPhone) {
      return new Response(JSON.stringify({ error: "Numéro de téléphone requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");
    const OWNER_PHONE = Deno.env.get("OWNER_PHONE");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      throw new Error("Twilio credentials not configured");
    }
    if (!OWNER_PHONE) throw new Error("OWNER_PHONE not configured");

    // Build conversation transcript
    const transcript = (messages || [])
      .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'Client' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const contextBlock = `
Client: ${clientName || 'Inconnu'}
Téléphone: ${clientPhone}
Adresse: ${address || 'Non spécifiée'}
Type de travaux: ${workType || 'Non spécifié'}
Type de bâtiment: ${buildingType || 'Non spécifié'}

Transcription:
${transcript || '(Aucun message échangé)'}`;

    // Call AI for summary
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: HANDOFF_PROMPT },
          { role: "user", content: contextBlock },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_handoff",
            description: "Generate handoff summary and intro message",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Internal summary for the team" },
                intro_client: { type: "string", description: "Warm intro message for the client" },
                extracted: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    phone: { type: "string" },
                    address: { type: "string" },
                    problem_type: { type: "string" },
                    urgency: { type: "string" },
                    roof_age: { type: "string" },
                    details: { type: "string" },
                  },
                },
              },
              required: ["summary", "intro_client", "extracted"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_handoff" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error("AI summary generation failed");
    }

    const aiData = await aiResponse.json();
    let handoff: { summary: string; intro_client: string; extracted: Record<string, string> };

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      handoff = JSON.parse(toolCall.function.arguments);
    } else {
      handoff = {
        summary: `Client: ${clientName}, Tél: ${clientPhone}, Adresse: ${address}. Type: ${workType}. Demande de suivi par texto.`,
        intro_client: `Bonjour ${clientName || ''}, un conseiller de Toitures VB prendra le relais par texto sous peu. Merci de votre confiance!`,
        extracted: { name: clientName, phone: clientPhone, address: address || '' },
      };
    }

    // Register conversation in DB for the relay to work
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sms_conversations`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          client_phone: clientPhone,
          client_name: clientName || "Inconnu",
          address: address || null,
          work_type: workType || null,
          summary: handoff.summary,
          is_active: true,
          updated_at: new Date().toISOString(),
        }),
      });
      console.log("Conversation registered in DB for relay");
    } catch (dbErr) {
      console.error("Failed to register conversation:", dbErr);
    }

    // Generate vCard for the client contact
    const vcfName = (clientName || 'Client Inconnu').trim();
    const vcfNameParts = vcfName.split(' ');
    const vcfLast = vcfNameParts.length > 1 ? vcfNameParts.slice(1).join(' ') : vcfName;
    const vcfFirst = vcfNameParts.length > 1 ? vcfNameParts[0] : '';
    const vcfOrg = address ? `Proprio – ${address}` : 'Client Toitures VB';
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${vcfLast};${vcfFirst};;;`,
      `FN:${vcfName}`,
      `TEL;TYPE=CELL:${clientPhone}`,
      `ORG:${vcfOrg}`,
      address ? `NOTE:${workType || 'Toiture'} – ${address}` : '',
      'END:VCARD',
    ].filter(Boolean).join('\r\n');

    // Upload vCard to Supabase Storage for Twilio MediaUrl
    let vcardUrl: string | null = null;
    try {
      const vcfFileName = `contacts/${Date.now()}_${clientPhone.replace(/\D/g, '')}.vcf`;
      const uploadResp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sms-vcards/${vcfFileName}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'text/vcard',
            'x-upsert': 'true',
          },
          body: vcard,
        }
      );
      if (uploadResp.ok) {
        vcardUrl = `${SUPABASE_URL}/storage/v1/object/public/sms-vcards/${vcfFileName}`;
        console.log('vCard uploaded:', vcardUrl);
      } else {
        console.error('vCard upload failed:', await uploadResp.text());
      }
    } catch (vcardErr) {
      console.error('vCard upload error:', vcardErr);
    }

    // Send SMS via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const sendSms = async (to: string, body: string, mediaUrl?: string) => {
      const params: Record<string, string> = { From: TWILIO_FROM_NUMBER, To: to, Body: body };
      if (mediaUrl) params.MediaUrl = mediaUrl;
      const resp = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params),
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        console.error(`Twilio SMS to ${to} failed:`, resp.status, errBody);
        return { success: false, error: errBody };
      }
      const data = await resp.json();
      return { success: true, sid: data.sid };
    };

    // Messages: tell both parties to reply to the TWILIO number for a group convo
    const clientMsg = `${handoff.intro_client}\n\nRépondez directement à ce message pour discuter avec notre équipe.\n\n— Toitures VB`;
    const ownerMsg = `Nouveau client SMS\n\n${clientName || 'Inconnu'} (${clientPhone})\n${address || 'N/A'}\n${workType || 'N/A'}\n\n${handoff.summary}\n\nRépondez ici pour lui écrire directement.`;

    const [clientResult, ownerResult] = await Promise.all([
      sendSms(clientPhone, clientMsg),
      sendSms(OWNER_PHONE, ownerMsg, vcardUrl || undefined),
    ]);

    // Log initial messages
    try {
      await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ client_phone: clientPhone, sender: "system", content: clientMsg }),
        }),
        fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ client_phone: clientPhone, sender: "system", content: `[→ Proprio] ${ownerMsg}` }),
        }),
      ]);
    } catch (logErr) {
      console.error("Failed to log initial messages:", logErr);
    }

    return new Response(JSON.stringify({
      success: true,
      intro_message: handoff.intro_client,
      twilio_number: TWILIO_FROM_NUMBER,
      client_sms: clientResult,
      owner_sms: ownerResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("sms-handoff error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
