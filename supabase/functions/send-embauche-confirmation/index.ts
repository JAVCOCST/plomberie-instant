/**
 * send-embauche-confirmation
 * --------------------------
 * Envoie 2 emails après une nouvelle candidature couvreur :
 *  1. Confirmation au candidat (si email fourni) — accueil + récap.
 *  2. Notification à l'équipe recrutement (info@toituresvb.ca).
 *
 * POST body : { application_id: uuid }
 *
 * Variables d'env :
 *  - RESEND_API_KEY
 *  - RECRUTEMENT_EMAIL (défaut : info@toituresvb.ca)
 */
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOGO_URL = "https://www.soumission.toituresvb.ca/favicon.png";

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}

function ccqLabel(n: string | null) {
  const m: Record<string, string> = {
    apprenti_1: "Apprenti 1", apprenti_2: "Apprenti 2",
    apprenti_3: "Apprenti 3", compagnon: "Compagnon",
  };
  return n ? (m[n] || n) : "—";
}

function specsList(a: any) {
  const s: string[] = [];
  if (a.spec_soudeur_sbs) s.push("Soudeur SBS");
  if (a.spec_couvreur_bardeaux) s.push("Bardeaux");
  if (a.spec_toiture_tole) s.push("Tôle");
  if (a.spec_autre) s.push(a.spec_autre);
  return s.length ? s.join(", ") : "Non précisé";
}

function buildApplicantEmail(a: any) {
  return `
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Candidature reçue</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<!-- Header avec logo -->
<tr><td style="background:linear-gradient(135deg,#1a1a32 0%,#2d3748 100%);padding:32px;text-align:center;">
<img src="${LOGO_URL}" alt="Toitures VB" width="64" height="64" style="display:inline-block;margin-bottom:12px;border-radius:12px;" />
<h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Candidature bien reçue</h1>
<p style="margin:6px 0 0;color:#cbd5e0;font-size:14px;">Toitures VB — Granby, QC</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
<p style="margin:0 0 16px;font-size:16px;color:#1a202c;">Salut <strong>${esc(a.prenom)}</strong>,</p>
<p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.6;">
Merci d'avoir postulé chez Toitures VB. On a bien reçu ta candidature et on va la regarder rapidement.
${a.cv_storage_path ? "<br/>Ton CV a aussi été reçu." : ""}
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;border:1px solid #e2e8f0;margin:20px 0;">
<tr><td style="padding:20px;">
<p style="margin:0 0 12px;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Récapitulatif de ta candidature</p>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
<tr><td style="padding:4px 0;color:#718096;">Téléphone</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(a.telephone)}</td></tr>
<tr><td style="padding:4px 0;color:#718096;">Carte CCQ</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${a.carte_ccq ? "Oui — " + esc(ccqLabel(a.carte_ccq_niveau)) : "Non"}</td></tr>
<tr><td style="padding:4px 0;color:#718096;">Carte ASP</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${a.carte_asp ? "Oui" : "Non"}</td></tr>
<tr><td style="padding:4px 0;color:#718096;">Spécialités</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(specsList(a))}</td></tr>
${a.annees_experience != null ? `<tr><td style="padding:4px 0;color:#718096;">Expérience</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(a.annees_experience)} ans</td></tr>` : ""}
${a.disponibilite ? `<tr><td style="padding:4px 0;color:#718096;">Disponibilité</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(a.disponibilite)}</td></tr>` : ""}
</table>
</td></tr></table>

<p style="margin:16px 0 0;font-size:14px;color:#4a5568;line-height:1.6;">
On va te contacter rapidement au <strong>${esc(a.telephone)}</strong>${a.email ? " ou par courriel" : ""}.
</p>

<p style="margin:24px 0 0;font-size:13px;color:#718096;border-top:1px solid #e2e8f0;padding-top:20px;">
Une question ?<br/>
📞 <a href="tel:+14506758892" style="color:#3182ce;text-decoration:none;">450-675-8892</a><br/>
✉️ <a href="mailto:info@toituresvb.ca" style="color:#3182ce;text-decoration:none;">info@toituresvb.ca</a>
</p>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f8f9fa;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="margin:0;color:#a0aec0;font-size:11px;">
<strong>TOITURES VB INC.</strong> · RBQ 5854-9353-01 · Granby, QC
</p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildAdminEmail(a: any) {
  const portalUrl = "https://soumission.toituresvb.ca/admin/embauche";
  return `
<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Nouvelle candidature</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<tr><td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:24px 32px;text-align:center;">
<img src="${LOGO_URL}" alt="Toitures VB" width="48" height="48" style="display:inline-block;margin-bottom:8px;border-radius:10px;" />
<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Nouvelle candidature couvreur</h1>
</td></tr>

<tr><td style="padding:28px 32px;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;border:1px solid #e2e8f0;">
<tr><td style="padding:20px;">
<p style="margin:0 0 4px;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Candidat</p>
<p style="margin:0 0 12px;color:#1a202c;font-size:18px;font-weight:700;">${esc(a.prenom)} ${esc(a.nom)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
<tr><td style="padding:4px 0;color:#718096;">Téléphone</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;"><a href="tel:${esc(a.telephone)}" style="color:#3182ce;text-decoration:none;">${esc(a.telephone)}</a></td></tr>
${a.email ? `<tr><td style="padding:4px 0;color:#718096;">Courriel</td><td style="padding:4px 0;font-weight:600;text-align:right;"><a href="mailto:${esc(a.email)}" style="color:#3182ce;text-decoration:none;">${esc(a.email)}</a></td></tr>` : ""}
<tr><td style="padding:4px 0;color:#718096;">CCQ</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${a.carte_ccq ? "✓ " + esc(ccqLabel(a.carte_ccq_niveau)) : "Non"}</td></tr>
<tr><td style="padding:4px 0;color:#718096;">ASP</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${a.carte_asp ? "✓ Oui" : "Non"}</td></tr>
<tr><td style="padding:4px 0;color:#718096;">Spécialités</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(specsList(a))}</td></tr>
${a.annees_experience != null ? `<tr><td style="padding:4px 0;color:#718096;">Expérience</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(a.annees_experience)} ans</td></tr>` : ""}
${a.disponibilite ? `<tr><td style="padding:4px 0;color:#718096;">Disponibilité</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(a.disponibilite)}</td></tr>` : ""}
<tr><td style="padding:4px 0;color:#718096;">CV joint</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${a.cv_storage_path ? "✓ Oui" : "Non"}</td></tr>
<tr><td style="padding:4px 0;color:#718096;">Source</td><td style="padding:4px 0;color:#1a202c;font-weight:600;text-align:right;">${esc(a.source || "embauche_form")}</td></tr>
</table>
</td></tr></table>

${a.notes ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-radius:10px;border:1px solid #fcd34d;margin-top:16px;"><tr><td style="padding:16px;"><p style="margin:0 0 6px;color:#92400e;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Notes</p><p style="margin:0;color:#1a202c;font-size:13px;line-height:1.5;white-space:pre-wrap;">${esc(a.notes)}</p></td></tr></table>` : ""}
${a.references_text ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#dbeafe;border-radius:10px;border:1px solid #93c5fd;margin-top:12px;"><tr><td style="padding:16px;"><p style="margin:0 0 6px;color:#1e40af;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Références</p><p style="margin:0;color:#1a202c;font-size:13px;line-height:1.5;white-space:pre-wrap;">${esc(a.references_text)}</p></td></tr></table>` : ""}

<p style="margin:24px 0 0;text-align:center;">
<a href="${portalUrl}" style="display:inline-block;padding:12px 24px;background:#f59e0b;color:#000000;font-weight:700;text-decoration:none;border-radius:8px;font-size:14px;">
Voir dans le portail →
</a>
</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const { application_id } = await req.json();
    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: app, error } = await supabase
      .from("roofer_applications")
      .select("*")
      .eq("id", application_id)
      .single();

    if (error || !app) {
      console.error("[send-embauche-confirmation] application not found", error);
      return new Response(JSON.stringify({ error: "application not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[send-embauche-confirmation] RESEND_API_KEY not configured");
      return new Response(JSON.stringify({ error: "email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const RECRUTEMENT_EMAIL = Deno.env.get("RECRUTEMENT_EMAIL") || "info@toituresvb.ca";
    const results: any = { applicant: null, admin: null };

    // 1. Email au candidat (seulement si email fourni)
    if (app.email) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Toitures VB <noreply@toituresvb.ca>",
          to: [app.email],
          subject: "Candidature reçue — Toitures VB",
          html: buildApplicantEmail(app),
        }),
      });
      results.applicant = { ok: r.ok, status: r.status };
      if (!r.ok) results.applicant.error = await r.text();
    } else {
      results.applicant = { ok: false, skipped: "no email provided" };
    }

    // 2. Notification équipe recrutement
    const r2 = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Toitures VB <noreply@toituresvb.ca>",
        to: [RECRUTEMENT_EMAIL],
        subject: `Nouvelle candidature couvreur — ${app.prenom} ${app.nom}`,
        html: buildAdminEmail(app),
      }),
    });
    results.admin = { ok: r2.ok, status: r2.status };
    if (!r2.ok) results.admin.error = await r2.text();

    return new Response(JSON.stringify({ ok: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[send-embauche-confirmation] error", err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
