/**
 * roof-vision-claude
 * ==================
 *
 * Pré-annotation de toits via Claude vision (claude-sonnet-4-6).
 * Alternative aux backends algo (v1.6 algorithmique) et ml_v1 (YOLOv8-OBB).
 *
 * Pourquoi Claude vision :
 *   - Comprend sémantiquement le toit ("hip à 4 facets avec lucarne")
 *     là où v1.6 algo ne fait que de la détection d'edges
 *   - Pas besoin de training data (modèle pré-entraîné)
 *   - Coût raisonnable (~$0.01 / toit)
 *   - Précision visuelle proche d'un humain
 *
 * Input JSON :
 *   {
 *     image_url: string,           // URL Google Static Maps
 *     building_polygon_px: number[][], // polygon bâtiment en pixels image
 *     image_size?: number,          // default 1280 (Static Maps scale=2)
 *     roof_type_hint?: string,      // optional: 'hip' | 'gable' | 'flat'
 *   }
 *
 * Output JSON :
 *   {
 *     schema_version: "sections-1.6.0",
 *     sections: [...],              // format v1.6 compatible
 *     metadata: {
 *       backend: "claude_vision",
 *       model: "claude-sonnet-4-6",
 *       cost_estimate_usd: number,
 *       tokens_used: { input, output },
 *     },
 *   }
 */
import { cors, runAdminGuards } from "../_shared/hardening.ts";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";

interface ClaudeRequest {
  image_url: string;
  building_polygon_px: number[][];
  image_size?: number;
  roof_type_hint?: string;
  // Mode de fonctionnement :
  //   'predict' (default) — Claude prédit les sections de zéro
  //   'refine' — Claude reçoit en plus les sections actuelles (de YOLO ou
  //              v1.6 algo) et les corrige/améliore. Plus rapide, moins
  //              cher en tokens d'output, et résultat plus précis car
  //              Claude n'a pas à "tout deviner" — il critique et corrige.
  mode?: 'predict' | 'refine';
  // Sections existantes (utilisées uniquement en mode 'refine')
  current_sections?: Array<{
    pts?: number[][];
    points?: number[][];
    roof_type?: string;
    pitch?: number;
    selection_status?: string;
  }>;
  current_backend?: string;  // 'algo_v1_6' | 'ml_v1' (pour le prompt context)
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt construit pour forcer Claude à sortir un JSON conforme v1.6
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `Tu es un expert en analyse de toitures résidentielles québécoises depuis des images satellite (Google Maps).

Ton job : identifier les SECTIONS du toit (chaque pan / facet visible) et retourner leurs polygones en coordonnées pixels image.

CONNAISSANCES MÉTIER :
- Toit "hip" (croupe) : 4 pans trapézoïdaux qui se rencontrent à un point central ou une ridge. Chaque pan a une base le long de l'avant-toit + un sommet le long de la faîtière + 2 hip lines à 45°.
- Toit "gable" (2 pans) : 2 rectangles symétriques qui se rencontrent à une faîtière unique.
- Toit "flat" : 1 grand polygone plat (souvent rectangulaire ou L-shape pour commercial).
- Toit "shed" (monopente) : 1 rectangle incliné.
- "Tower" (tourelle) : octogone régulier.
- Au Québec, presque tous les toits sont géométriques (lignes droites, angles à 90° ou 45°), rarement courbés.

RÈGLES STRICTES POUR L'OUTPUT :
1. Coordonnées en pixels image (origine top-left, axe Y vers le bas).
2. Chaque section = polygone fermé de 4 vertices (octogone 8 pour tower).
3. Les vertices sont ordonnés en sens horaire ou antihoraire (peu importe, mais cohérent).
4. Les sections doivent rester DANS le footprint du bâtiment (le polygone fourni).
5. Arêtes parallèles vraiment parallèles, angles vraiment 90° ou 45°.
6. Pitch = 7/12 par défaut (toit standard), 12/12 pour tourelle.
7. Pas plus de 12 sections (typique : 2-6).
8. Confidence ∈ [0, 1] selon ta certitude visuelle.

FORMAT JSON STRICT (retourne UNIQUEMENT ce JSON, aucun texte autour) :
{
  "roof_type": "hip" | "gable" | "flat" | "complex" | "mixed",
  "main_axis_deg": <angle en degrés de la faîtière principale par rapport à l'horizon image, 0-180>,
  "sections": [
    {
      "pts": [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],
      "roof_type": "hip" | "gable" | "shed" | "tower" | "flat",
      "pitch": 7,
      "confidence": 0.92
    }
  ]
}`;
}

function buildUserPrompt(req: ClaudeRequest): string {
  const polygonStr = req.building_polygon_px
    .map(([x, y]) => `[${Math.round(x)}, ${Math.round(y)}]`)
    .join(", ");
  const size = req.image_size || 1280;
  let hint = "";
  if (req.roof_type_hint) {
    hint = `\nHint : l'opérateur suspecte un toit de type "${req.roof_type_hint}".`;
  }

  // Mode 'refine' : Claude reçoit une pré-annotation existante et la corrige
  // (au lieu de prédire de zéro). Bcp plus efficace en tokens + résultats
  // plus précis (Claude critique au lieu de deviner tout).
  if (req.mode === 'refine' && Array.isArray(req.current_sections) && req.current_sections.length > 0) {
    const backendLabel = req.current_backend || 'modèle inconnu';
    const sectionsForPrompt = req.current_sections.map((s, i) => ({
      id: `S${i + 1}`,
      roof_type: s.roof_type || 'hip',
      pts: (s.pts || s.points || []).map((p: any) => Array.isArray(p) ? p : [p.x, p.y]),
    }));
    return `Image satellite ${size}×${size} pixels d'un bâtiment résidentiel québécois.

Le footprint du bâtiment (polygone cadastral) :
[${polygonStr}]
${hint}

PRÉ-ANNOTATION EXISTANTE (sortie par "${backendLabel}") :
${JSON.stringify(sectionsForPrompt, null, 2)}

TON RÔLE EN MODE "REFINE" :
Analyse l'image et la pré-annotation existante. Pour CHAQUE section présente :
- KEEP si elle est bien placée (juste ajuste légèrement les coins si nécessaire)
- DROP si elle n'a pas de sens (pas de toit là)
- REPLACE si la forme est mauvaise (réécris les vertices proprement)

PUIS ajoute les sections MANQUANTES que tu vois dans l'image mais qui ne sont pas dans la pré-annotation.

Retourne le JSON final au schema strict (PAS la pré-annotation, mais ta version corrigée).`;
  }

  // Mode 'predict' (default) : Claude prédit de zéro
  return `Image satellite ${size}×${size} pixels d'un bâtiment résidentiel québécois.

Le footprint du bâtiment (polygone cadastral) est défini par ces coordonnées pixels :
[${polygonStr}]
${hint}

Analyse l'image et retourne le JSON des sections du toit selon le schema strict.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch image + encode base64
// ─────────────────────────────────────────────────────────────────────────────
async function fetchImageAsBase64(url: string): Promise<{ b64: string; mime: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`fetch image failed: ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  // Encode base64 (Deno n'a pas Buffer mais a btoa via TextEncoder workaround)
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = btoa(bin);
  // Devine le mime : Static Maps renvoie du JPEG par défaut
  const ct = resp.headers.get("content-type") || "image/jpeg";
  return { b64, mime: ct.split(";")[0].trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert Claude output → v1.6 schema
// ─────────────────────────────────────────────────────────────────────────────
function toV16Schema(
  claudeOut: any,
  metadata: { input_tokens: number; output_tokens: number; mode?: string; refined_from_backend?: string | null },
): any {
  const sections = Array.isArray(claudeOut?.sections) ? claudeOut.sections : [];
  const v16Sections = sections.map((s: any, i: number) => {
    const pts = Array.isArray(s.pts) ? s.pts : [];
    return {
      id: `S${i + 1}`,
      points: pts,
      roof_type: String(s.roof_type || "hip"),
      pitch: typeof s.pitch === "number" ? s.pitch : 7,
      selection_status: "kept",
      selection_reason: "claude_vision_kept",
      score: {
        total: typeof s.confidence === "number" ? s.confidence : 0.8,
        ml_confidence: typeof s.confidence === "number" ? s.confidence : 0.8,
      },
      relationship_type: i === 0 ? "main" : null,
      role: i === 0 ? "main" : null,
      parent_id: null,
      group_id: null,
      top_k_alternatives: [],
      related_ids: [],
      pruned_by: [],
    };
  });

  // Prix Claude Sonnet 4 (au 2026-01) : $3/1M input, $15/1M output
  // Image ~1500 tokens, prompt système ~600, user ~200 → ~2300 input
  // Output JSON ~300-800 tokens
  const cost = (metadata.input_tokens / 1_000_000) * 3
    + (metadata.output_tokens / 1_000_000) * 15;

  return {
    schema_version: "sections-1.6.0",
    sections: v16Sections,
    metadata: {
      backend: "claude_vision",
      mode: metadata.mode || "predict",
      refined_from_backend: metadata.refined_from_backend ?? null,
      model: ANTHROPIC_MODEL,
      roof_type_detected: claudeOut?.roof_type || null,
      main_axis_deg: claudeOut?.main_axis_deg ?? null,
      cost_estimate_usd: Math.round(cost * 10000) / 10000,
      tokens_used: {
        input: metadata.input_tokens,
        output: metadata.output_tokens,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, requestedHeaders);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  let body: ClaudeRequest;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.image_url || !Array.isArray(body.building_polygon_px) || body.building_polygon_px.length < 3) {
    return new Response(JSON.stringify({ error: "image_url + building_polygon_px (≥3 pts) required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "ANTHROPIC_API_KEY secret manquant côté Supabase Edge Functions",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 1. Download l'image satellite
  let imageData: { b64: string; mime: string };
  try {
    imageData = await fetchImageAsBase64(body.image_url);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `fetch image: ${e.message}` }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Call Claude vision
  const anthropicPayload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imageData.mime, data: imageData.b64 } },
          { type: "text", text: buildUserPrompt(body) },
        ],
      },
    ],
  };

  const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(anthropicPayload),
  });

  if (!claudeResp.ok) {
    const errBody = await claudeResp.text().catch(() => "");
    return new Response(JSON.stringify({
      error: `Anthropic API ${claudeResp.status}: ${errBody.slice(0, 300)}`,
    }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const claudeData = await claudeResp.json();
  const textBlock = (claudeData.content || []).find((b: any) => b.type === "text");
  if (!textBlock) {
    return new Response(JSON.stringify({ error: "Claude returned no text block" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Parse le JSON (Claude peut wrapper en ```json ... ```)
  let parsed: any;
  try {
    let raw = textBlock.text.trim();
    // Strip code fences si présents
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return new Response(JSON.stringify({
      error: `Claude returned invalid JSON: ${e.message}. Raw: ${textBlock.text.slice(0, 200)}`,
    }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 4. Convert au schema v1.6
  const usage = claudeData.usage || {};
  const result = toV16Schema(parsed, {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    mode: body.mode || 'predict',
    refined_from_backend: body.mode === 'refine' ? (body.current_backend || null) : null,
  });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
