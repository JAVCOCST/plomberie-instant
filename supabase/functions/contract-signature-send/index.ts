import { cors, assertOrigin } from "../_shared/hardening.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

function rndToken(len = 32): string {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

function publicSignUrl(origin: string | null, token: string): string {
  const base = origin && /^https?:\/\//.test(origin)
    ? origin
    : "https://soumission.toituresvb.ca";
  return `${base.replace(/\/$/, "")}/sign/${token}`;
}

const handler = async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (origin && origin !== "null" && !assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      soumissionId,
      contractHtml,
      contractPdfUrl,
      subject,
      message,
      signers,        // [{ name, email, phone, role, color, order }]
      fields,         // [{ signerIndex, type, page, x_pct, y_pct, width_pct, height_pct, required, label }]
      expiresInDays,
    } = body ?? {};

    if (!contractHtml || !Array.isArray(signers) || signers.length === 0) {
      return new Response(JSON.stringify({ error: "contractHtml et signers requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const access_token = rndToken(24);
    const expires_at = new Date(Date.now() + (Number(expiresInDays) || 30) * 86400000).toISOString();

    const { data: reqRow, error: e1 } = await sb
      .from("contract_signature_requests")
      .insert({
        soumission_id: soumissionId || null,
        contract_html: String(contractHtml),
        contract_pdf_url: contractPdfUrl || null,
        subject: subject || "Contrat à signer",
        message: message || null,
        status: "sent",
        access_token,
        sent_at: new Date().toISOString(),
        expires_at,
      })
      .select()
      .single();
    if (e1 || !reqRow) throw new Error("Création de la demande: " + (e1?.message || "inconnu"));

    // Insert signers
    const signerRows = signers.map((s: any, i: number) => ({
      request_id: reqRow.id,
      signer_order: Number(s.order ?? i + 1),
      name: String(s.name || "").trim() || `Signataire ${i + 1}`,
      email: s.email || null,
      phone: s.phone || null,
      role: s.role || "client",
      color: s.color || "#6366f1",
      signer_token: rndToken(20),
    }));
    const { data: insertedSigners, error: e2 } = await sb
      .from("contract_signers").insert(signerRows).select();
    if (e2 || !insertedSigners) throw new Error("Signataires: " + (e2?.message || "?"));

    // Insert fields (map signerIndex -> signer_id)
    const fieldRows = (Array.isArray(fields) ? fields : []).map((f: any) => {
      const signer = insertedSigners[Number(f.signerIndex) || 0];
      return {
        request_id: reqRow.id,
        signer_id: signer?.id,
        field_type: f.type,
        page: Number(f.page) || 1,
        x_pct: Number(f.x_pct),
        y_pct: Number(f.y_pct),
        width_pct: Number(f.width_pct) || 18,
        height_pct: Number(f.height_pct) || 5,
        required: f.required !== false,
        label: f.label || null,
      };
    }).filter((r: any) => r.signer_id && Number.isFinite(r.x_pct) && Number.isFinite(r.y_pct));
    if (fieldRows.length) {
      const { error: e3 } = await sb.from("contract_signature_fields").insert(fieldRows);
      if (e3) throw new Error("Champs: " + e3.message);
    }

    await sb.from("contract_signature_events").insert({
      request_id: reqRow.id, event_type: "sent", metadata: { signers: signerRows.length, fields: fieldRows.length },
    });

    // Send emails (best-effort)
    const sendResults: { email: string; ok: boolean; error?: string }[] = [];
    if (RESEND_API_KEY) {
      for (const s of insertedSigners) {
        if (!s.email) { sendResults.push({ email: "(aucun)", ok: false, error: "Pas de courriel" }); continue; }
        const link = publicSignUrl(origin, s.signer_token);
        const html = `
<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#f4f5f7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 10px;font-size:20px;color:#111827;">${esc(subject || "Contrat à signer")}</h1>
    <p style="font-size:14px;color:#374151;line-height:1.55;">Bonjour ${esc(s.name)},</p>
    <p style="font-size:14px;color:#374151;line-height:1.55;white-space:pre-wrap;">${esc(message || "Veuillez signer le contrat ci-joint en cliquant sur le bouton ci-dessous.")}</p>
    <p style="margin:24px 0;text-align:center;">
      <a href="${link}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px;">Ouvrir et signer le contrat</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">Lien sécurisé personnel — n'expire que le ${new Date(expires_at).toLocaleDateString("fr-CA")}.</p>
    <p style="font-size:11px;color:#9ca3af;margin-top:18px;word-break:break-all;">${link}</p>
  </div>
</body></html>`;
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Toitures VB Inc. <contrats@toituresvb.ca>",
              to: [s.email], subject: subject || "Contrat à signer", html,
            }),
          });
          const ok = r.ok;
          sendResults.push({ email: s.email, ok, error: ok ? undefined : await r.text() });
          await sb.from("contract_signature_events").insert({
            request_id: reqRow.id, signer_id: s.id, event_type: ok ? "email_sent" : "email_failed",
            metadata: { email: s.email },
          });
        } catch (err) {
          sendResults.push({ email: s.email, ok: false, error: String(err) });
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      requestId: reqRow.id,
      accessToken: reqRow.access_token,
      signers: insertedSigners.map(s => ({ id: s.id, name: s.name, email: s.email, token: s.signer_token, link: publicSignUrl(origin, s.signer_token) })),
      emailResults: sendResults,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("contract-signature-send error", err);
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

Deno.serve(handler);