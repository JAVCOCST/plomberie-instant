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
    const { satelliteZoom18Url, satelliteZoom21Url, streetViewUrl, address, lat, lng } = body ?? {};

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

    const systemPrompt = `Tu es un expert en analyse de toiture au Québec.

Tu dois analyser UNIQUEMENT les images satellite fournies.

Tu dois raisonner visuellement en suivant EXACTEMENT cette méthode interne :

ÉTAPE 1 — Déterminer la géométrie
Observer les ombrages, arêtes et lignes de faîtage.
Si aucune ombre directionnelle et surface uniforme → toiture plate.
Si deux versants opposés avec une seule ligne de faîtage → 2 pans.
Si quatre versants principaux → 4 pans.
Si plus de quatre versants, angles multiples, ruptures complexes → 4 pans et +.

ÉTAPE 2 — Si toiture plate, déterminer le matériau
Texture granuleuse, mouchetée, irrégulière gris/blanc → membrane recouverte de gravier.
Surface plus uniforme, joints linéaires visibles, apparence lisse → membrane élastomère.

ÉTAPE 3 — Si toiture en pente, déterminer le matériau
Texture fine répétitive, motif granuleux sombre → bardeaux d'asphalte.
Surface lisse, lignes parallèles longues, reflet uniforme → tôle.

ÉTAPE 4 — Déterminer la pente
Aucune → Aucun faîtage, surface plane uniforme.
Légère → Pente très faible mais réelle, élévation minimale.
Modérée → Angle visible clairement sans forte élévation.
Abrupte → Angle prononcé, versants longs, élévation marquée.

ÉTAPE 5 — Vérifier que le bâtiment analysé est celui au centre exact de l'image.
Ignorer les bâtiments voisins.

Ne jamais deviner.
Si incertitude légère, choisir la catégorie la plus probable selon texture dominante.

ÉTAPE 6 — Déterminer le type de bâtiment
Observer la forme, la taille, le nombre de sections de toiture, et le contexte urbain.
- Unifamiliale : bâtiment isolé, 1-2 étages, une seule unité visible.
- Duplex : bâtiment avec 2 unités (souvent 2 portes visibles ou escalier extérieur typique québécois).
- Triplex : 3 unités empilées.
- Multiplex : 4+ unités ou bâtiment résidentiel large.
- Commercial : bâtiment commercial, industriel, grande surface, toit plat large.
- Condo : immeuble à condos, plus de 3 étages typiquement.

Tu dois retourner STRICTEMENT un JSON valide avec ces champs :
{
  "roof_type": "2pans" | "4pans" | "4pans_plus",
  "slope_category": "aucune" | "legere" | "moderee" | "abrupte",
  "confidence": <nombre entre 0 et 1>,
  "reasoning_short": "<justification max 2 phrases>",
  "material": "membrane_elastomere" | "membrane_gravier" | "shingle" | "tole",
  "is_flat": <true|false>,
  "building_type": "unifamiliale" | "duplex" | "triplex" | "multiplex" | "commercial" | "condo"
}

RÈGLES :
- Si toiture plate (membrane) → roof_type n'est pas applicable, retourne "4pans" par défaut, slope_category = "aucune", is_flat = true.
- Si bardeaux → is_flat = false, roof_type selon géométrie.
- Si tôle → is_flat = false, roof_type selon géométrie.
- Ne retourne RIEN d'autre que le JSON.
- Pas de markdown, pas de backticks, juste le JSON brut.`;

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
                text: `Le bâtiment cible est au CENTRE exact des images (pas de marqueur). Image 1 = vue large (géométrie). Image 2 = vue rapprochée (texture/matériau). Retourne uniquement le JSON.`,
              },
              { type: "image_url", image_url: { url: satelliteZoom18Url } },
              { type: "image_url", image_url: { url: satelliteZoom21Url } },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI API error:", response.status, text);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const rawAnswer = result.choices?.[0]?.message?.content?.trim() || "";

    // Parse the JSON response
    let parsed: Record<string, unknown>;
    try {
      // Strip potential markdown fences
      const cleaned = rawAnswer.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI JSON:", rawAnswer);
      // Fallback: try to extract from old format for backwards compat
      parsed = {
        roof_type: "4pans",
        slope_category: "moderee",
        confidence: 0.3,
        reasoning_short: "Parsing échoué, fallback appliqué.",
        material: "shingle",
        is_flat: false,
      };
    }

    console.log("Roof classification result:", { address, rawAnswer, parsed });

    return new Response(
      JSON.stringify({
        ...parsed,
        raw_answer: rawAnswer,
        satellite_zoom18_url: satelliteZoom18Url,
        satellite_zoom21_url: satelliteZoom21Url,
        street_view_url: streetViewUrl,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("roof-classify error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
