/**
 * html-to-pdf — convertit un document HTML (ex. rapport de toiture) en PDF via
 * un service externe, puis le téléverse dans Storage (quote-pdfs/reports/…).
 *
 * Entrée (POST JSON) : { html, soumissionId?, filename? }
 * Sortie (JSON)      : { path, signedUrl }
 *
 * Moteur : PDFShift (`PDFSHIFT_API_KEY`) en priorité, sinon Browserless
 * (`BROWSERLESS_TOKEN`). Admin-only.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cors, runAdminGuards } from "../_shared/hardening.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

async function htmlToPdf(html: string): Promise<Uint8Array> {
  const PDFSHIFT = Deno.env.get("PDFSHIFT_API_KEY");
  const BROWSERLESS = Deno.env.get("BROWSERLESS_TOKEN");
  if (PDFSHIFT) {
    const r = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa("api:" + PDFSHIFT), "Content-Type": "application/json" },
      body: JSON.stringify({ source: html, format: "Letter", margin: "0", use_print: true }),
    });
    if (!r.ok) throw new Error(`PDFShift ${r.status}: ${await r.text()}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  if (BROWSERLESS) {
    const r = await fetch(`https://chrome.browserless.io/pdf?token=${BROWSERLESS}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, options: { format: "Letter", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } } }),
    });
    if (!r.ok) throw new Error(`Browserless ${r.status}: ${await r.text()}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  throw new Error("Aucune clé HTML→PDF configurée (PDFSHIFT_API_KEY ou BROWSERLESS_TOKEN).");
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { html, soumissionId, filename } = (await req.json()) ?? {};
    if (typeof html !== "string" || html.length < 50) return json({ error: "html requis" }, 400);

    const pdf = await htmlToPdf(html);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const safe = (typeof filename === "string" && filename ? filename : "rapport.pdf").replace(/[^\w.\-]/g, "_");
    const path = `reports/${soumissionId || "tmp"}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage.from("quote-pdfs").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(`Upload échoué : ${upErr.message}`);
    const { data: signed } = await supabase.storage.from("quote-pdfs").createSignedUrl(path, 60 * 60 * 24 * 7);

    return json({ path, signedUrl: signed?.signedUrl || null });
  } catch (e) {
    return json({ error: `PDF échoué : ${(e as Error).message}` }, 500);
  }
});
