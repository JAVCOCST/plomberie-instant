import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth check
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const anonSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await anonSb.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ success: false, error: "Session invalide" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { message } = await req.json();
    if (!message) throw new Error("Le champ 'message' est requis");

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Fetch real product catalog
    const { data: products } = await sb
      .from("qb_products")
      .select("name, brand, gamme, unit_price, purchase_cost, coverage_value, coverage_unit, sku, coverage_types")
      .eq("active", true);

    // Fetch real customers
    const { data: customers } = await sb
      .from("qb_customers")
      .select("qb_id, display_name, email, phone, mobile, bill_address")
      .limit(200);

    const systemPrompt = `Tu es l'assistant de soumission de Toitures VB.
Tu reçois une description en langage naturel d'un projet de toiture et tu dois produire un objet JSON structuré.

PRODUITS DISPONIBLES (qb_products) :
${JSON.stringify(products?.slice(0, 80), null, 2)}

CLIENTS QUICKBOOKS EXISTANTS :
${JSON.stringify(customers?.slice(0, 50), null, 2)}

STATUTS VALIDES : "new" | "contacted" | "visit_scheduled" | "visit_done" | "quoted" | "approved" | "completed" | "cancelled"
TYPES DE COUVERTURE (coverage_type) : "Bardeaux d'asphalte" | "Membrane élastomère" | "Membrane gravier" | "Tôle"
MARQUES (product_brand) : "IKO" | "BP"
GAMMES (product_name) IKO : "Cambridge" | "Dynasty" | "Nordic" | "Royal Estate"
GAMMES (product_name) BP : "Mystique" | "Signature" | "Vangard" | "Dakota"
COMPLEXITÉ (complexity) : "simple" | "moderate" | "complex"
PENTES (slope) : "none" | "light" | "moderate" | "steep"
TYPES DE TRAVAUX (work_type) : "Réfection complète" | "Nouvelle couverture" | "Réparations mineures"
TYPES DE BÂTIMENT (building_type) : "2 versants" | "4 versants" | "4+ versants (complexe)"

Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas de backticks, pas d'explication) suivant CE schéma exact :
{
  "status": "new",
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "phone": "string",
  "formatted_address": "string",
  "coverage_type": "string | null",
  "product_brand": "string | null",
  "product_name": "string | null",
  "building_type": "string | null",
  "slope": "string | null",
  "complexity": "string | null",
  "work_type": "string | null",
  "area_sqft": number | null,
  "contact_preference": "email"
}

Règles :
- Si le nom du client est inconnu, mets "Inconnu" comme prénom et "Client" comme nom.
- Si l'email est inconnu, mets "info@toituresvb.com".
- Si le téléphone est inconnu, mets "000-000-0000".
- Utilise les valeurs exactes des enums ci-dessus.
- Pour area_sqft, convertis en pieds carrés si donné en pi².
- Ne fabrique pas de prix, ne calcule rien.`;

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY n'est pas configurée. Ajoutez-la dans les secrets Supabase.");

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Claude API error:", anthropicRes.status, errText);
      throw new Error(`Erreur Claude API (${anthropicRes.status})`);
    }

    const anthropicData = await anthropicRes.json();
    const raw = anthropicData.content[0].text.trim();
    // Strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    let quoteData: any;
    try {
      quoteData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("JSON parse failed. Raw response:", raw);
      throw new Error("Claude a retourné un JSON invalide. Réessayez avec une description plus simple.");
    }

    // Insert into soumissions with real schema
    const insertPayload = {
      status: quoteData.status || "new",
      first_name: quoteData.first_name || "Inconnu",
      last_name: quoteData.last_name || "Client",
      email: quoteData.email || "info@toituresvb.com",
      phone: quoteData.phone || "000-000-0000",
      formatted_address: quoteData.formatted_address || "",
      coverage_type: quoteData.coverage_type || null,
      product_brand: quoteData.product_brand || null,
      product_name: quoteData.product_name || null,
      building_type: quoteData.building_type || null,
      slope: quoteData.slope || null,
      complexity: quoteData.complexity || null,
      work_type: quoteData.work_type || null,
      area_sqft: quoteData.area_sqft || null,
      contact_preference: quoteData.contact_preference || "email",
    };

    const { data: inserted, error: insertError } = await sb
      .from("soumissions")
      .insert(insertPayload)
      .select("id, seq_number, reference_id")
      .single();

    if (insertError) {
      console.error("DB insert error:", insertError);
      throw new Error(`Erreur d'insertion: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        soumission_id: inserted.id,
        reference_id: inserted.reference_id,
        seq_number: inserted.seq_number,
        preview: {
          client: `${insertPayload.first_name} ${insertPayload.last_name}`,
          address: insertPayload.formatted_address,
          coverage: insertPayload.coverage_type,
          product: [insertPayload.product_brand, insertPayload.product_name].filter(Boolean).join(" "),
          area: insertPayload.area_sqft ? `${insertPayload.area_sqft} pi²` : null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("quote-assistant error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
