import { cors, assertOrigin, getClientIp, checkRateLimit } from "../_shared/hardening.ts";

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};
const handler = async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (origin && origin !== "null" && !assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(req);
  if (ip !== "unknown" && !checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Trop de requêtes." }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return new Response(JSON.stringify({ error: "Email service not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      clientName, clientEmail, clientPhone, address,
      product, productBrand, color, referenceId,
      totalFormatted, surfaceFormatted, slopeLabel, coverageLabel,
      dynastyBreakdown, buildingInfo,
      mergedPdfUrl, clientPdfUrl, pdfFilenameBase,
      // Nouveaux champs personnalisables
      customSubject, customBody, ccList, bccList, soumissionId, replyTo,
      // Pièces jointes additionnelles (depuis la section "Documents PDF")
      extraAttachments,
    } = body;

    // HTML-escape user-controlled values to prevent injection in email bodies
    const esc = (v: unknown): string => String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    // URL-encode for href attributes (mailto:, tel:)
    const encAttr = (v: unknown): string => encodeURIComponent(String(v ?? ''));

    console.log("send-quote-email:", { clientName, clientEmail, address });

    if (!clientName) {
      return new Response(JSON.stringify({ error: "Missing clientName" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toLocaleString('fr-CA', { timeZone: 'America/Montreal' });
    const b = buildingInfo || {};

    // Build line items table rows
    let lineItemsHtml = '';
    if (dynastyBreakdown?.lines?.length) {
      lineItemsHtml = `
        <tr><td colspan="2" style="padding:16px 0 8px;"><p style="margin:0;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Détail des postes</p></td></tr>
        <tr><td colspan="2">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;">
            <tr style="background:#edf2f7;">
              <td style="padding:6px 8px;font-weight:600;color:#4a5568;">Description</td>
              <td style="padding:6px 8px;text-align:center;font-weight:600;color:#4a5568;">Qté</td>
              <td style="padding:6px 8px;text-align:right;font-weight:600;color:#4a5568;">Taux</td>
              <td style="padding:6px 8px;text-align:right;font-weight:600;color:#4a5568;">Total</td>
            </tr>
            ${dynastyBreakdown.lines.map((l: { description: string; quantity: number; unit: string; rate: string; total_displayed: string }, i: number) => `
              <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8f9fa'};">
                <td style="padding:5px 8px;color:#1a202c;">${esc(l.description)}</td>
                <td style="padding:5px 8px;text-align:center;color:#4a5568;">${esc(l.quantity)} ${esc(l.unit)}</td>
                <td style="padding:5px 8px;text-align:right;color:#4a5568;">${esc(l.rate)} $</td>
                <td style="padding:5px 8px;text-align:right;color:#1a202c;font-weight:600;">${esc(l.total_displayed)} $</td>
              </tr>
            `).join('')}
          </table>
        </td></tr>`;
    }

    // Subtotals section
    let subtotalsHtml = '';
    if (dynastyBreakdown) {
      subtotalsHtml = `
        <tr>
          <td style="padding:6px 0;color:#718096;font-size:12px;border-top:2px solid #e2e8f0;">Sous-total</td>
          <td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;border-top:2px solid #e2e8f0;">${dynastyBreakdown.subtotal_displayed} $</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#718096;font-size:12px;">TPS (5%)</td>
          <td style="padding:4px 0;color:#1a202c;font-size:13px;text-align:right;">${dynastyBreakdown.tps} $</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#718096;font-size:12px;">TVQ (9,975%)</td>
          <td style="padding:4px 0;color:#1a202c;font-size:13px;text-align:right;">${dynastyBreakdown.tvq} $</td>
        </tr>`;
    }

    const internalHtml = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="660" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a32 0%,#2d3748 100%);padding:28px 32px;text-align:center;">
            <img src="https://www.soumission.toituresvb.ca/favicon.png" alt="Toitures VB" width="48" height="48" style="display:inline-block;margin-bottom:8px;border-radius:10px;" />
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Nouvelle soumission recue</h1>
            <p style="margin:6px 0 0;color:#a0aec0;font-size:13px;">${now}</p>
          </td>
        </tr>

        <!-- Client -->
        <tr>
          <td style="padding:28px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;border:1px solid #e2e8f0;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 4px;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Client</p>
                <p style="margin:0 0 12px;color:#1a202c;font-size:16px;font-weight:700;">${esc(clientName)}</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">Courriel</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;"><a href="mailto:${encAttr(clientEmail || '')}" style="color:#3182ce;text-decoration:none;">${esc(clientEmail || '—')}</a></td></tr>
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">Telephone</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;"><a href="tel:${encAttr(clientPhone || '')}" style="color:#3182ce;text-decoration:none;">${esc(clientPhone || '—')}</a></td></tr>
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">Adresse</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(address || '—')}</td></tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Building info -->
        <tr>
          <td style="padding:16px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 12px;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Batiment detecte</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">Superficie au sol</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(b.superficie || '—')}</td></tr>
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">Perimetre</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(b.perimetre || '—')}</td></tr>
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">Dimensions</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(b.largeur || '—')} x ${esc(b.profondeur || '—')}</td></tr>
                  <tr><td style="padding:4px 0;color:#718096;font-size:12px;">No Lot</td><td style="padding:4px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(b.noLot || '—')}</td></tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Project details + line items -->
        <tr>
          <td style="padding:16px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf8;border-radius:10px;border:1px solid #e2e8f0;">
              <tr><td style="padding:20px;">
                <p style="margin:0 0 12px;color:#718096;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Details du projet</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;border-bottom:1px solid #edf2f7;">Produit</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #edf2f7;">${esc(productBrand || '')} ${esc(product || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;border-bottom:1px solid #edf2f7;">Couleur</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #edf2f7;">${esc(color || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;border-bottom:1px solid #edf2f7;">Couverture</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #edf2f7;">${esc(coverageLabel || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;border-bottom:1px solid #edf2f7;">Superficie toiture</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #edf2f7;">${esc(surfaceFormatted || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;">Pente</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(slopeLabel || '—')}${dynastyBreakdown?.slope_factor ? ` (x${esc(dynastyBreakdown.slope_factor)})` : ''}</td></tr>
                </table>
                ${lineItemsHtml}
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                  ${subtotalsHtml}
                </table>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Total -->
        <tr>
          <td style="padding:16px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1a1a32 0%,#2d3748 100%);border-radius:10px;">
              <tr><td style="padding:20px;">
                <table width="100%">
                  <tr>
                    <td style="color:#a0aec0;font-size:13px;font-weight:500;">Estimation totale<br/><span style="font-size:11px;color:#718096;">(taxes incluses)</span></td>
                    <td style="color:#ffffff;font-size:26px;font-weight:800;text-align:right;letter-spacing:-0.5px;">${esc(totalFormatted || '—')}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>

        ${referenceId ? `<tr><td style="padding:8px 32px 0;"><p style="margin:0;color:#a0aec0;font-size:11px;">Ref : ${esc(referenceId)}</p></td></tr>` : ''}

        <!-- Footer -->
        <tr>
          <td style="background:#f7f7f5;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;margin-top:20px;">
            <p style="margin:0;color:#a0aec0;font-size:11px;">Notification interne — Toitures VB · soumission.toituresvb.ca</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Client confirmation email (simplified)
    const clientHtml = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a32 0%,#2d3748 100%);padding:28px 32px;text-align:center;">
            <img src="https://www.soumission.toituresvb.ca/favicon.png" alt="Toitures VB" width="48" height="48" style="display:inline-block;margin-bottom:8px;border-radius:10px;" />
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Merci pour votre demande, ${esc(clientName)} !</h1>
            ${referenceId ? `<p style="margin:6px 0 0;color:#a0aec0;font-size:12px;">Référence : ${esc(referenceId)}</p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 16px;color:#1a202c;font-size:15px;line-height:1.7;">
              Nous avons bien recu votre demande de soumission pour votre projet de toiture${address && address !== '—' ? ` au <strong>${esc(address)}</strong>` : ''}.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;border:1px solid #e2e8f0;margin:20px 0;">
              <tr><td style="padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;">Produit</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(productBrand || '')} ${esc(product || '—')} — ${esc(color || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;">Couverture</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(coverageLabel || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;">Superficie</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(surfaceFormatted || '—')}</td></tr>
                  <tr><td style="padding:6px 0;color:#718096;font-size:12px;">Estimation</td><td style="padding:6px 0;color:#1a202c;font-size:16px;font-weight:800;text-align:right;">${esc(totalFormatted || '—')}</td></tr>
                  ${referenceId ? `<tr><td style="padding:6px 0;color:#718096;font-size:12px;">Référence</td><td style="padding:6px 0;color:#1a202c;font-size:13px;font-weight:600;text-align:right;">${esc(referenceId)}</td></tr>` : ''}
                </table>
              </td></tr>
            </table>
            <p style="margin:0 0 16px;color:#1a202c;font-size:15px;line-height:1.7;">
              Un membre de notre equipe vous contactera sous peu pour confirmer les details et planifier les travaux.
            </p>
            <p style="margin:0;color:#718096;font-size:13px;line-height:1.6;">
              Si vous avez des questions, contactez-nous au <a href="tel:+14505213227" style="color:#3182ce;text-decoration:none;">450-521-3227</a> ou au <a href="tel:+14506758892" style="color:#3182ce;text-decoration:none;">1-450-675-8892</a>, ou par courriel a <a href="mailto:info@toituresvb.ca" style="color:#3182ce;text-decoration:none;">info@toituresvb.ca</a>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f7f7f5;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#a0aec0;font-size:11px;">Toitures VB · soumission.toituresvb.ca</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Fetch PDFs from Supabase Storage for attachments
    const fetchPdfAsBase64 = async (url: string): Promise<string | null> => {
      if (!url || !url.startsWith("https://") || !url.includes("supabase.co/storage/")) return null;
      try {
        const resp = await fetch(url);
        if (!resp.ok) { console.warn("PDF fetch failed:", resp.status, url); return null; }
        const buffer = await resp.arrayBuffer();
        const b64 = arrayBufferToBase64(buffer);
        console.log("Fetched PDF:", { url, sizeKb: (b64.length / 1024).toFixed(0) });
        return b64;
      } catch (e) { console.warn("PDF fetch error:", e); return null; }
    };

    const [mergedPdfB64, clientPdfB64] = await Promise.all([
      fetchPdfAsBase64(mergedPdfUrl),
      fetchPdfAsBase64(clientPdfUrl),
    ]);

    // Fetch extra attachments (additional PDFs uploaded in "Documents PDF")
    const extras: Array<{ name: string; url: string }> = Array.isArray(extraAttachments) ? extraAttachments : [];
    const extraFetched = await Promise.all(
      extras.map(async (att) => {
        const b64 = await fetchPdfAsBase64(att.url);
        return b64 ? { filename: att.name || 'document.pdf', content: b64, name: att.name } : null;
      }),
    );
    const extraAttachmentsResolved = extraFetched.filter(Boolean) as Array<{ filename: string; content: string; name: string }>;

    const baseName = pdfFilenameBase || `soumission-${(clientName || 'client').replace(/\s/g, '-')}`;

    // Liens accept/decline (publics, sans JWT)
    const supaProjectId = Deno.env.get('SUPABASE_PROJECT_ID') || 'eeradaaxmqzyvxvmahlf';
    const respondBase = `https://${supaProjectId}.supabase.co/functions/v1/quote-respond`;
    const acceptUrl = soumissionId ? `${respondBase}?id=${soumissionId}&action=accept` : '';
    const declineUrl = soumissionId ? `${respondBase}?id=${soumissionId}&action=decline` : '';

    // Construire le HTML client à partir d'un corps personnalisé (si fourni)
    const buildCustomClientHtml = (bodyText: string): string => {
      const safe = (bodyText || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
      const buttons = soumissionId ? `
        <table cellpadding="0" cellspacing="0" style="margin:24px auto;">
          <tr>
            <td style="padding:0 8px;">
              <a href="${acceptUrl}" style="display:inline-block;padding:14px 28px;background:#16a34a;color:#fff;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;">✓ Accepter la soumission</a>
            </td>
            <td style="padding:0 8px;">
              <a href="${declineUrl}" style="display:inline-block;padding:14px 28px;background:#dc2626;color:#fff;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;">✗ Refuser la soumission</a>
            </td>
          </tr>
        </table>` : '';
      // Liste des pièces jointes (annexe à la soumission)
      const attachedNames: string[] = [];
      if (clientPdfB64 || mergedPdfB64) attachedNames.push(`${baseName}.pdf — Soumission officielle`);
      for (const att of extraAttachmentsResolved) attachedNames.push(att.name);
      const attachmentsBlock = attachedNames.length ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#f8f9fa;border:1px solid #e2e8f0;border-radius:10px;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 10px;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Pièces jointes en annexe à la soumission</p>
            <ul style="margin:0;padding:0;list-style:none;">
              ${attachedNames.map((n) => `
                <li style="padding:6px 0;color:#1a202c;font-size:13px;border-bottom:1px solid #edf2f7;">
                  <span style="display:inline-block;width:18px;color:#3b82f6;font-weight:700;"></span>${esc(n)}
                </li>
              `).join('')}
            </ul>
          </td></tr>
        </table>` : '';
      return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;"><tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#1a1a32 0%,#2d3748 100%);padding:24px;text-align:center;">
    <img src="https://www.soumission.toituresvb.ca/favicon.png" alt="Toitures VB" width="48" height="48" style="display:inline-block;margin-bottom:8px;border-radius:10px;" />
    <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">Toitures VB</h1>
    ${referenceId ? `<p style="margin:6px 0 0;color:#a0aec0;font-size:12px;">Référence : ${esc(referenceId)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:28px 32px;color:#1a202c;font-size:14px;line-height:1.7;">${safe}${buttons}${attachmentsBlock}</td></tr>
  <tr><td style="background:#f7f7f5;padding:14px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#a0aec0;font-size:11px;">Toitures VB · soumission.toituresvb.ca · 450-521-3227</p>
  </td></tr>
</table></td></tr></table></body></html>`;
    };

    const finalClientHtml = customBody ? buildCustomClientHtml(customBody) : clientHtml;
    const finalClientSubject = customSubject || `Votre soumission de toiture — Toitures VB`;

    const internalAttachments = mergedPdfB64 ? [{ filename: `${baseName}_COMPLET.pdf`, content: mergedPdfB64 }] : [];
    const baseClientAttachments = clientPdfB64
      ? [{ filename: `${baseName}.pdf`, content: clientPdfB64 }]
      : mergedPdfB64
        ? [{ filename: `${baseName}.pdf`, content: mergedPdfB64 }]
        : [];
    const clientAttachments = [
      ...baseClientAttachments,
      ...extraAttachmentsResolved.map(({ filename, content }) => ({ filename, content })),
    ];

    // 1) Send internal email
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Toitures VB <noreply@toituresvb.ca>",
        to: ["info@toituresvb.ca"],
        subject: `Nouvelle soumission — ${clientName}${address && address !== '—' ? ` — ${address}` : ''}`,
        html: internalHtml,
        ...(internalAttachments.length ? { attachments: internalAttachments } : {}),
      }),
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      console.error("Resend API error (internal):", resendData);
      return new Response(JSON.stringify({ error: "Email send failed", details: resendData }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("Internal email sent:", resendData);

    // 2) Send client confirmation
    if (clientEmail) {
      try {
        const parseList = (v: any): string[] =>
          Array.isArray(v) ? v.filter(Boolean)
          : (typeof v === 'string' ? v.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : []);
        const ccArr = parseList(ccList);
        const bccArr = parseList(bccList);
        const clientRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Toitures VB <noreply@toituresvb.ca>",
            to: [clientEmail],
            ...(ccArr.length ? { cc: ccArr } : {}),
            ...(bccArr.length ? { bcc: bccArr } : {}),
            ...(replyTo ? { reply_to: replyTo } : {}),
            subject: finalClientSubject,
            html: finalClientHtml,
            ...(clientAttachments.length ? { attachments: clientAttachments } : {}),
          }),
        });
        const clientData = await clientRes.json();
        if (!clientRes.ok) {
          console.error("Resend API error (client):", clientData);
        } else {
          console.log("Client email sent:", clientData);
          // Update DB status -> sent
          if (soumissionId) {
            try {
              const SUPA_URL = `https://${supaProjectId}.supabase.co`;
              const SUPA_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
              if (SUPA_SERVICE) {
                await fetch(`${SUPA_URL}/rest/v1/soumissions?id=eq.${soumissionId}`, {
                  method: 'PATCH',
                  headers: {
                    'apikey': SUPA_SERVICE,
                    'Authorization': `Bearer ${SUPA_SERVICE}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                  },
                  body: JSON.stringify({
                    email_status: 'sent',
                    email_sent_at: new Date().toISOString(),
                    email_recipient: clientEmail,
                    email_cc: ccArr.join(', ') || null,
                    email_bcc: bccArr.join(', ') || null,
                  }),
                });
              }
            } catch (e) { console.warn('DB update failed:', e); }
          }
        }
      } catch (e) {
        console.error("Client email error:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-quote-email error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

Deno.serve(handler);
