import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType: m[1] };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || (req.method === "POST" ? "submit" : "get");

  try {
    if (action === "get") {
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "Token requis" }, 400);
      const { data: signer, error: e0 } = await sb
        .from("contract_signers").select("*").eq("signer_token", token).maybeSingle();
      if (e0 || !signer) return json({ error: "Lien invalide" }, 404);

      const { data: reqRow } = await sb
        .from("contract_signature_requests").select("*").eq("id", signer.request_id).single();
      if (!reqRow) return json({ error: "Demande introuvable" }, 404);
      if (reqRow.status === "voided") return json({ error: "Demande annulée" }, 410);
      if (reqRow.expires_at && new Date(reqRow.expires_at) < new Date()) {
        await sb.from("contract_signature_requests").update({ status: "expired" }).eq("id", reqRow.id);
        return json({ error: "Lien expiré" }, 410);
      }

      const { data: fields } = await sb
        .from("contract_signature_fields").select("*").eq("request_id", reqRow.id);
      const { data: allSigners } = await sb
        .from("contract_signers").select("id,name,email,role,color,status,signed_at,viewed_at,ip_address,user_agent,signer_order,signature_image_url")
        .eq("request_id", reqRow.id).order("signer_order");

      // Mark viewed
      if (signer.status === "pending") {
        await sb.from("contract_signers").update({
          status: "viewed", viewed_at: new Date().toISOString(),
          ip_address: getIp(req), user_agent: req.headers.get("user-agent") || null,
        }).eq("id", signer.id);
        await sb.from("contract_signature_events").insert({
          request_id: reqRow.id, signer_id: signer.id, event_type: "viewed", ip_address: getIp(req),
        });
        if (reqRow.status === "sent") {
          await sb.from("contract_signature_requests").update({ status: "viewed" }).eq("id", reqRow.id);
        }
      }

      // Audit events (for certificate)
      const { data: events } = await sb
        .from("contract_signature_events")
        .select("event_type,signer_id,ip_address,created_at,metadata")
        .eq("request_id", reqRow.id)
        .order("created_at", { ascending: true });

      return json({
        request: {
          id: reqRow.id, subject: reqRow.subject, message: reqRow.message,
          contractHtml: reqRow.contract_html, contractPdfUrl: reqRow.contract_pdf_url,
          status: reqRow.status, expiresAt: reqRow.expires_at,
          createdAt: reqRow.created_at, sentAt: reqRow.sent_at, completedAt: reqRow.completed_at,
        },
        signer: {
          id: signer.id, name: signer.name, email: signer.email, role: signer.role, color: signer.color,
          status: signer.status, signedAt: signer.signed_at, signatureImageUrl: signer.signature_image_url,
        },
        signers: allSigners || [],
        events: events || [],
        fields: (fields || []).map(f => ({
          id: f.id, signerId: f.signer_id, type: f.field_type, page: f.page,
          x: Number(f.x_pct), y: Number(f.y_pct), w: Number(f.width_pct), h: Number(f.height_pct),
          required: f.required, label: f.label, value: f.value,
          signedAt: f.signed_at,
          mine: f.signer_id === signer.id,
        })),
      });
    }

    if (action === "submit") {
      const body = await req.json();
      const { token, fieldValues, signatureDataUrl, consent } = body || {};
      if (!token) return json({ error: "Token requis" }, 400);
      if (!consent) return json({ error: "Consentement requis" }, 400);

      const { data: signer } = await sb
        .from("contract_signers").select("*").eq("signer_token", token).maybeSingle();
      if (!signer) return json({ error: "Lien invalide" }, 404);
      if (signer.status === "signed") return json({ error: "Déjà signé" }, 400);

      const { data: reqRow } = await sb
        .from("contract_signature_requests").select("*").eq("id", signer.request_id).single();
      if (!reqRow || reqRow.status === "voided") return json({ error: "Demande indisponible" }, 410);

      // Upload signature image
      let signatureUrl: string | null = null;
      if (signatureDataUrl) {
        const parsed = dataUrlToBytes(signatureDataUrl);
        if (parsed) {
          const path = `signatures/${reqRow.id}/${signer.id}.png`;
          const { error: upErr } = await sb.storage.from("contract-signatures")
            .upload(path, parsed.bytes, { contentType: parsed.contentType, upsert: true });
          if (!upErr) {
            signatureUrl = sb.storage.from("contract-signatures").getPublicUrl(path).data.publicUrl;
          }
        }
      }

      // Update fields with values
      const { data: myFields } = await sb
        .from("contract_signature_fields").select("*")
        .eq("request_id", reqRow.id).eq("signer_id", signer.id);
      const nowIso = new Date().toISOString();
      for (const f of myFields || []) {
        let val: string | null = null;
        const submitted = (fieldValues || {})[f.id];
        if (f.field_type === "signature") val = signatureUrl;
        else if (f.field_type === "date") val = new Date().toLocaleDateString("fr-CA");
        else if (f.field_type === "name") val = signer.name;
        else val = submitted != null ? String(submitted) : null;
        if (f.required && (val == null || val === "" || (f.field_type === "checkbox" && val !== "true"))) {
          return json({ error: `Champ requis manquant: ${f.label || f.field_type}` }, 400);
        }
        await sb.from("contract_signature_fields").update({ value: val, signed_at: nowIso }).eq("id", f.id);
      }

      await sb.from("contract_signers").update({
        status: "signed", signed_at: nowIso, signature_image_url: signatureUrl,
        ip_address: getIp(req), user_agent: req.headers.get("user-agent") || null,
      }).eq("id", signer.id);

      await sb.from("contract_signature_events").insert({
        request_id: reqRow.id, signer_id: signer.id, event_type: "signed", ip_address: getIp(req),
      });

      // Recompute progress
      const { data: allSigners } = await sb.from("contract_signers")
        .select("id,status,email,name").eq("request_id", reqRow.id);
      const total = (allSigners || []).length;
      const signed = (allSigners || []).filter(s => s.status === "signed").length;
      const pct = total ? Math.round((signed / total) * 100) : 0;
      const newStatus = signed === total ? "completed" : "partially_signed";
      await sb.from("contract_signature_requests").update({
        progress_percent: pct, status: newStatus,
        completed_at: signed === total ? nowIso : null,
      }).eq("id", reqRow.id);

      // If completed, notify admin (best-effort)
      if (signed === total && RESEND_API_KEY) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Toitures VB Inc. <contrats@toituresvb.ca>",
              to: ["info@toituresvb.ca"],
              subject: `Contrat signé — ${reqRow.subject || reqRow.id}`,
              html: `<p>Tous les signataires ont signé.</p><p>Demande: <code>${reqRow.id}</code></p>`,
            }),
          });
        } catch (_) {}
      }

      return json({ ok: true, progress: pct, status: newStatus });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (err) {
    console.error("contract-signature-public", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }

  function json(b: unknown, status = 200) {
    return new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
};

Deno.serve(handler);