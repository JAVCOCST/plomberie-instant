import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cors, runGuards, isAllowedGoogleUrl } from "../_shared/hardening.ts";

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guardResp = runGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  try {
    const body = await req.json();
    const { satelliteZoom18Url, satelliteZoom21Url, streetViewUrl, address, coverageType, lat, lng } = body ?? {};

    if (typeof lat !== "number" || typeof lng !== "number") {
      return new Response(JSON.stringify({ error: "Paramètres invalides (lat/lng)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isAllowedGoogleUrl(satelliteZoom18Url) || !isAllowedGoogleUrl(satelliteZoom21Url)) {
      return new Response(JSON.stringify({ error: "Invalid image URLs" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (streetViewUrl && !isAllowedGoogleUrl(streetViewUrl)) {
      return new Response(JSON.stringify({ error: "Invalid street view URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const systemPrompt = `Tu es un expert en analyse de pente de toiture au Québec.

Tu dois analyser les images satellite ET Street View fournies pour classifier la pente du toit principal.

CONTEXTE IMPORTANT :
Le type de toiture détecté précédemment est : ${coverageType || "inconnu"}.
La pente détectée ne doit JAMAIS contredire ce type.

RÈGLES DE COHÉRENCE :
- Toit plat (membrane_elastomere, membrane_gravier) → slope_category = "aucune" OBLIGATOIRE
- 2 pans / 4 pans (shingle ou tole) → slope_category IMPOSSIBLE = "aucune"
- Si incohérence détectée → choisir la pente compatible la plus logique

MÉTHODE D'ANALYSE :

ÉTAPE 1 — Analyse satellite (priorité géométrie)
Rechercher faîtage, pignon, maximum réel du toit, cassures de pente, ombres directionnelles, parapet.
Un toit plat n'a aucun maximum réel. Si maximum détecté → jamais "aucune".

ÉTAPE 2 — Analyse satellite zoom rapproché (relief + ombrage)
Observer les ombres portées et le relief pour estimer l'angle.

ÉTAPE 3 — Analyse Street View (PRIORITAIRE pour angle réel)
Hauteur mur vs hauteur sommet, angle visible du versant, présence d'un pignon.
Ne pas confondre lucarne, marquise, toit secondaire.

ÉTAPE 4 — Fusion et décision finale
- aucune → Aucun maximum + surface uniforme + indices de toit plat
- legere → Pente très faible mais réelle, élévation minimale
- moderee → Angle visible clairement sans forte élévation
- abrupte → Angle prononcé + versants longs + élévation marquée

Tu dois retourner STRICTEMENT un JSON valide :
{
  "slope_category": "aucune" | "legere" | "moderee" | "abrupte",
  "confidence": <nombre entre 0 et 1>,
  "reasoning_short": "<justification max 2 phrases>"
}

Pas de markdown, pas de backticks, juste le JSON brut.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        top_p: 1,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Le bâtiment cible est au CENTRE exact des images. Image 1 = vue large. Image 2 = vue rapprochée. Image 3 = Street View. Type détecté : ${coverageType || "inconnu"}. Retourne uniquement le JSON.`,
              },
              { type: "image_url", image_url: { url: satelliteZoom18Url } },
              { type: "image_url", image_url: { url: satelliteZoom21Url } },
              { type: "image_url", image_url: { url: streetViewUrl } },
            ],
          },
        ],
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI API error:", response.status, text);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const rawAnswer = result.choices?.[0]?.message?.content?.trim() || "";

    let parsed: Record<string, unknown>;
    try {
      const cleaned = rawAnswer.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI JSON:", rawAnswer);
      parsed = {
        slope_category: "moderee",
        confidence: 0.3,
        reasoning_short: "Parsing échoué, fallback appliqué.",
      };
    }

    console.log("Roof slope result:", { address, rawAnswer, parsed, coverageType });

    return new Response(
      JSON.stringify({
        ...parsed,
        raw_answer: rawAnswer,
        coverage_type_used: coverageType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("roof-slope error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
