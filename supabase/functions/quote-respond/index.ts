import { cors } from "../_shared/hardening.ts";

const PROJECT_ID = Deno.env.get('SUPABASE_PROJECT_ID') || 'eeradaaxmqzyvxvmahlf';
const SUPA_URL = `https://${PROJECT_ID}.supabase.co`;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));

const shell = (title: string, inner: string, accent = '#3b82f6') => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#1a202c}
  .card{background:#fff;border-radius:20px;padding:40px 32px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4)}
  h1{margin:0 0 8px;font-size:24px;color:#0f172a}
  p{color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px}
  .badge{width:64px;height:64px;border-radius:50%;background:${accent};margin:0 auto 20px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px;font-weight:bold}
  label{display:block;background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:8px 0;cursor:pointer;transition:all .15s;font-size:15px;color:#334155}
  label:hover{border-color:${accent};background:#fff}
  input[type=radio]{margin-right:10px;accent-color:${accent}}
  input[type=radio]:checked + span{font-weight:600;color:#0f172a}
  textarea{width:100%;min-height:90px;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-family:inherit;font-size:14px;resize:vertical;margin-top:8px}
  textarea:focus{outline:none;border-color:${accent}}
  button{width:100%;padding:14px 24px;background:${accent};color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:16px;transition:opacity .15s}
  button:hover{opacity:.9}
  .footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:24px}
  .center{text-align:center}
  .alt{display:block;margin-top:12px;color:${accent};text-decoration:none;font-size:13px;font-weight:600}
</style></head>
<body><div class="card">${inner}<p class="footer">Toitures VB · 450-521-3227</p></div></body></html>`;

const successPage = (title: string, msg: string, color: string) =>
  shell(title, `<div class="badge">${title.startsWith('✓') ? '✓' : '✗'}</div><div class="center"><h1>${esc(title)}</h1><p>${esc(msg)}</p></div>`, color);

const declineForm = (id: string, err = '') => shell('Refus de la soumission', `
  <div class="center" style="margin-bottom:24px"><h1>Avant de partir…</h1><p>Pouvons-nous savoir pourquoi ? Cela nous aide à nous améliorer.</p></div>
  ${err ? `<p style="color:#dc2626;background:#fee2e2;padding:10px;border-radius:8px;">${esc(err)}</p>` : ''}
  <form method="POST" action="?id=${esc(id)}&action=decline">
    <label><input type="radio" name="action_type" value="revision" required/><span>Je voudrais une révision de la soumission</span></label>
    <label><input type="radio" name="action_type" value="decline"/><span>Je refuse définitivement la soumission</span></label>
    <div style="margin:20px 0 8px;font-weight:600;color:#0f172a;font-size:14px;">Raison principale :</div>
    <label><input type="radio" name="reason" value="too_expensive" required/><span>Prix trop élevé</span></label>
    <label><input type="radio" name="reason" value="another_contractor"/><span>Choisi un autre entrepreneur</span></label>
    <label><input type="radio" name="reason" value="postponed"/><span>Projet reporté</span></label>
    <label><input type="radio" name="reason" value="cancelled"/><span>Projet annulé</span></label>
    <label><input type="radio" name="reason" value="scope_change"/><span>Travaux à modifier (ajouter/retirer)</span></label>
    <label><input type="radio" name="reason" value="other"/><span>Autre raison</span></label>
    <textarea name="details" placeholder="Commentaires additionnels (optionnel)"></textarea>
    <button type="submit">Envoyer ma réponse</button>
    <a class="alt center" href="?id=${esc(id)}&action=accept">← Finalement, j'accepte la soumission</a>
  </form>
`, '#dc2626');

const reasonLabels: Record<string, string> = {
  too_expensive: 'Prix trop élevé',
  another_contractor: 'Choisi un autre entrepreneur',
  postponed: 'Projet reporté',
  cancelled: 'Projet annulé',
  scope_change: 'Travaux à modifier',
  other: 'Autre raison',
};

async function notifyInternal(subject: string, html: string) {
  if (!RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Toitures VB <noreply@toituresvb.ca>', to: ['info@toituresvb.ca'], subject, html }),
    });
  } catch (e) { console.warn('Notif interne échouée:', e); }
}

async function patchSoumission(id: string, body: Record<string, unknown>) {
  return await fetch(`${SUPA_URL}/rest/v1/soumissions?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8' };

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    const action = url.searchParams.get('action') || '';

    if (!id || !['accept', 'decline'].includes(action)) {
      return new Response(successPage('! Lien invalide', 'Le lien utilisé est invalide ou incomplet.', '#f59e0b'),
        { status: 400, headers: htmlHeaders });
    }
    if (!SERVICE_KEY) {
      return new Response(successPage('! Erreur serveur', 'Configuration manquante.', '#dc2626'),
        { status: 500, headers: htmlHeaders });
    }

    // ACCEPT — direct update
    if (action === 'accept') {
      const res = await patchSoumission(id, {
        email_status: 'accepted',
        email_response_at: new Date().toISOString(),
        status: 'accepted',
        revision_requested: false,
      });
      if (!res.ok) {
        console.error('quote-respond accept failed', await res.text());
        return new Response(successPage('! Erreur', 'Impossible de mettre à jour la soumission.', '#dc2626'),
          { status: 500, headers: htmlHeaders });
      }
      await notifyInternal(`Soumission ACCEPTÉE ✓ — ${id.slice(0, 8)}`,
        `<p>Le client a <strong>accepté</strong> la soumission <code>${id}</code> à ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Montreal' })}.</p>`);
      return new Response(successPage('✓ Soumission acceptée',
        'Merci ! Nous avons bien reçu votre acceptation. Notre équipe vous contactera très bientôt pour planifier les travaux.', '#16a34a'),
        { status: 200, headers: htmlHeaders });
    }

    // DECLINE — show form on GET, process on POST
    if (req.method === 'GET') {
      return new Response(declineForm(id), { status: 200, headers: htmlHeaders });
    }

    // POST: parse form
    const form = await req.formData();
    const actionType = String(form.get('action_type') || '');
    const reason = String(form.get('reason') || '');
    const details = String(form.get('details') || '').slice(0, 2000);

    if (!actionType || !reason) {
      return new Response(declineForm(id, 'Veuillez sélectionner une option et une raison.'), { status: 400, headers: htmlHeaders });
    }

    const isRevision = actionType === 'revision';
    const reasonLabel = reasonLabels[reason] || reason;

    const res = await patchSoumission(id, {
      email_status: isRevision ? 'revision_requested' : 'declined',
      email_response_at: new Date().toISOString(),
      status: isRevision ? 'revision_requested' : 'cancelled',
      decline_reason: reasonLabel,
      decline_details: details,
      revision_requested: isRevision,
    });
    if (!res.ok) {
      console.error('quote-respond decline failed', await res.text());
      return new Response(successPage('! Erreur', 'Impossible d\'enregistrer votre réponse.', '#dc2626'),
        { status: 500, headers: htmlHeaders });
    }

    await notifyInternal(
      `Soumission ${isRevision ? 'RÉVISION DEMANDÉE ✎' : 'REFUSÉE ✗'} — ${id.slice(0, 8)}`,
      `<p>Le client a <strong>${isRevision ? 'demandé une révision' : 'refusé'}</strong> la soumission <code>${id}</code>.</p>
       <p><strong>Raison :</strong> ${esc(reasonLabel)}</p>
       ${details ? `<p><strong>Commentaires :</strong><br/>${esc(details).replace(/\n/g, '<br/>')}</p>` : ''}
       <p style="color:#64748b;font-size:12px;">${new Date().toLocaleString('fr-CA', { timeZone: 'America/Montreal' })}</p>`,
    );

    if (isRevision) {
      return new Response(successPage('✎ Révision demandée',
        `Merci ! Nous avons enregistré votre demande de révision (raison : ${reasonLabel}). Notre équipe vous contactera rapidement pour ajuster la soumission.`, '#3b82f6'),
        { status: 200, headers: htmlHeaders });
    }
    return new Response(successPage('✗ Soumission refusée',
      'Votre refus a bien été enregistré. Merci pour votre temps — n\'hésitez pas à nous recontacter si vos besoins changent.', '#dc2626'),
      { status: 200, headers: htmlHeaders });

  } catch (err) {
    console.error('quote-respond error:', err);
    return new Response(successPage('! Erreur', String(err), '#dc2626'),
      { status: 500, headers: htmlHeaders });
  }
});
