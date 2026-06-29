/**
 * invoice-ocr — OCR d'une facture fournisseur (PDF/image) puis extraction
 * structurée des lignes pour calculer le COÛTANT MATÉRIAUX réel d'un projet.
 *
 * Entrée (POST JSON) :
 *   { file_url, mime }       ← recommandé (URL signée Storage, pas de gros body)
 *   { file_base64, mime }    ← repli
 * Sortie (JSON) : { supplier, invoice_number, invoice_date, currency,
 *                   lines:[{description,quantity,unit,unit_price,total,is_material}],
 *                   material_total, grand_total, engine }
 *
 * Moteur : Mistral (`mistral-ocr-latest` → `mistral-large-latest`) si
 * MISTRAL_API_KEY, sinon Gemini (`gemini-2.0-flash`). Admin-only.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cors, runAdminGuards } from "../_shared/hardening.ts";

const EXTRACT_PROMPT = `Tu es un comptable expert. À partir du texte d'une facture fournisseur (matériaux de toiture/construction au Québec), retourne UNIQUEMENT un objet JSON strict :
{
  "supplier": string, "invoice_number": string, "invoice_date": string, "currency": string,
  "lines": [ { "description": string, "quantity": number, "unit": string, "unit_price": number, "total": number, "is_material": boolean } ],
  "material_total": number, "grand_total": number
}
Règles :
- is_material = true pour un MATÉRIEL physique (bardeaux, membrane, clous, solins, bois, ventilation, scellant, etc.).
- is_material = false pour main-d'œuvre, livraison/transport, frais, taxes (TPS/TVQ), consignes, frais environnementaux.
- Tous les montants sont des NOMBRES, sans symbole ni séparateur de milliers.
- N'invente rien : si une valeur est absente, mets 0 ou "".
- Réponds avec le JSON seul.`;

function coerceNum(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
  return 0;
}

function normalize(raw: any, engine: string) {
  const lines = Array.isArray(raw?.lines) ? raw.lines.map((l: any) => ({
    description: String(l?.description ?? "").slice(0, 300),
    quantity: coerceNum(l?.quantity), unit: String(l?.unit ?? ""),
    unit_price: coerceNum(l?.unit_price), total: coerceNum(l?.total),
    is_material: l?.is_material !== false,
  })) : [];
  const computedMat = lines.filter((l: any) => l.is_material).reduce((s: number, l: any) => s + l.total, 0);
  return {
    supplier: String(raw?.supplier ?? ""), invoice_number: String(raw?.invoice_number ?? ""),
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(raw?.invoice_date) ? raw.invoice_date : "",
    currency: String(raw?.currency || "CAD"), lines,
    material_total: coerceNum(raw?.material_total) || computedMat,
    grand_total: coerceNum(raw?.grand_total), engine,
  };
}

async function urlToBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch fichier ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

async function viaMistral(key: string, input: { url: string | null; base64: string | null }, mime: string) {
  const docRef = input.url || `data:${mime};base64,${input.base64}`;
  const document = mime.startsWith("image/") ? { type: "image_url", image_url: docRef } : { type: "document_url", document_url: docRef };
  const ocrResp = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "mistral-ocr-latest", document, include_image_base64: false }),
  });
  if (!ocrResp.ok) throw new Error(`Mistral OCR ${ocrResp.status}: ${await ocrResp.text()}`);
  const ocr = await ocrResp.json();
  const markdown = (ocr.pages || []).map((p: any) => p.markdown || "").join("\n\n").slice(0, 60000);

  const chatResp = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral-large-latest", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: EXTRACT_PROMPT }, { role: "user", content: `Texte OCR de la facture :\n\n${markdown}` }],
    }),
  });
  if (!chatResp.ok) throw new Error(`Mistral chat ${chatResp.status}: ${await chatResp.text()}`);
  const chat = await chatResp.json();
  return normalize(JSON.parse(chat.choices?.[0]?.message?.content || "{}"), "mistral");
}

async function viaGemini(key: string, input: { url: string | null; base64: string | null }, mime: string) {
  const b64 = input.base64 || await urlToBase64(input.url!);
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: EXTRACT_PROMPT }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
  const g = await resp.json();
  return normalize(JSON.parse(g.candidates?.[0]?.content?.parts?.[0]?.text || "{}"), "gemini");
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
    const { file_url, file_base64, mime } = (await req.json()) ?? {};
    const input = {
      url: typeof file_url === "string" && file_url ? file_url : null,
      base64: typeof file_base64 === "string" && file_base64.length > 50 ? file_base64 : null,
    };
    if (!input.url && !input.base64) return json({ error: "file_url ou file_base64 requis" }, 400);
    const contentType = typeof mime === "string" && mime ? mime : "application/pdf";

    const MISTRAL = Deno.env.get("MISTRAL_API_KEY");
    const GEMINI = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
    if (!MISTRAL && !GEMINI) return json({ error: "Aucune clé OCR configurée (MISTRAL_API_KEY ou GEMINI_API_KEY)." }, 503);

    const result = MISTRAL ? await viaMistral(MISTRAL, input, contentType) : await viaGemini(GEMINI!, input, contentType);
    return json(result);
  } catch (e) {
    return json({ error: `OCR échoué : ${(e as Error).message}` }, 500);
  }
});
