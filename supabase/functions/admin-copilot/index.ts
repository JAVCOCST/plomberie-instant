import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const tools = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Rechercher des produits dans le catalogue QuickBooks (bardeaux, matériaux de toiture). Retourne nom, marque, gamme, prix unitaire, coût d'achat, couverture.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Terme de recherche (nom, marque, gamme, SKU)" },
          brand: { type: "string", description: "Filtrer par marque (ex: IKO, BP)" },
          gamme: { type: "string", description: "Filtrer par gamme (ex: Dynasty, Cambridge)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_clients",
      description: "Rechercher des clients QuickBooks par nom, email ou téléphone.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Terme de recherche (nom, email, téléphone)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_soumissions",
      description: "Rechercher des soumissions existantes par client, adresse, numéro de référence ou statut.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Terme de recherche" },
          status: { type: "string", description: "Filtrer par statut" },
          limit: { type: "number", description: "Nombre max de résultats (défaut: 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_quote_edits",
      description: "Suggérer des modifications aux postes du devis. Retourne un tableau d'actions (ajouter, modifier, supprimer des lignes).",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["add", "update", "remove"], description: "Type d'action" },
                lineIndex: { type: "number", description: "Index de la ligne à modifier/supprimer (0-based)" },
                description: { type: "string", description: "Description du poste" },
                quantity: { type: "number", description: "Quantité" },
                unit: { type: "string", description: "Unité (paquets, rouleaux, heures, etc.)" },
                rate: { type: "number", description: "Taux unitaire ($)" },
                reason: { type: "string", description: "Explication de la modification" },
              },
              required: ["action", "reason"],
            },
          },
        },
        required: ["actions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_soumission",
      description: "Créer une nouvelle soumission dans la base de données à partir d'informations client et projet. Utilise cet outil quand l'utilisateur veut créer/générer une nouvelle soumission ou un nouveau devis.",
      parameters: {
        type: "object",
        properties: {
          first_name: { type: "string", description: "Prénom du client" },
          last_name: { type: "string", description: "Nom du client" },
          email: { type: "string", description: "Email du client (défaut: info@toituresvb.com)" },
          phone: { type: "string", description: "Téléphone du client (défaut: 000-000-0000)" },
          formatted_address: { type: "string", description: "Adresse complète du projet" },
          coverage_type: { type: "string", enum: ["Bardeaux d'asphalte", "Membrane élastomère", "Membrane gravier", "Tôle"], description: "Type de couverture" },
          product_brand: { type: "string", enum: ["IKO", "BP"], description: "Marque du produit" },
          product_name: { type: "string", description: "Gamme du produit (ex: Dynasty, Cambridge)" },
          building_type: { type: "string", enum: ["2 versants", "4 versants", "4+ versants (complexe)"], description: "Type de bâtiment" },
          slope: { type: "string", enum: ["none", "light", "moderate", "steep"], description: "Pente du toit" },
          complexity: { type: "string", enum: ["simple", "moderate", "complex"], description: "Complexité" },
          work_type: { type: "string", enum: ["Réfection complète", "Nouvelle couverture", "Réparations mineures"], description: "Type de travaux" },
          area_sqft: { type: "number", description: "Superficie en pieds carrés" },
        },
        required: ["first_name", "last_name", "formatted_address"],
      },
    },
  },
];

async function executeTool(name: string, args: any): Promise<string> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  switch (name) {
    case "search_products": {
      let q = sb.from("qb_products").select("name, brand, gamme, unit_price, purchase_cost, coverage_value, coverage_unit, sku, coverage_types").eq("active", true);
      if (args.brand) q = q.ilike("brand", `%${args.brand}%`);
      if (args.gamme) q = q.ilike("gamme", `%${args.gamme}%`);
      if (args.query) q = q.or(`name.ilike.%${args.query}%,sku.ilike.%${args.query}%,brand.ilike.%${args.query}%`);
      const { data, error } = await q.limit(20);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data);
    }
    case "search_clients": {
      const { data, error } = await sb.from("qb_customers")
        .select("display_name, email, phone, mobile, bill_address, balance")
        .or(`display_name.ilike.%${args.query}%,email.ilike.%${args.query}%,phone.ilike.%${args.query}%`)
        .limit(10);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data);
    }
    case "search_soumissions": {
      let q = sb.from("soumissions")
        .select("seq_number, reference_id, first_name, last_name, email, phone, formatted_address, coverage_type, product_name, product_brand, color, area_sqft, slope, subtotal, high_estimate, status, created_at")
        .order("created_at", { ascending: false });
      if (args.status) q = q.eq("status", args.status);
      if (args.query) {
        q = q.or(`first_name.ilike.%${args.query}%,last_name.ilike.%${args.query}%,email.ilike.%${args.query}%,formatted_address.ilike.%${args.query}%,reference_id.ilike.%${args.query}%`);
      }
      const { data, error } = await q.limit(args.limit || 10);
      if (error) return JSON.stringify({ error: error.message });
      return JSON.stringify(data);
    }
    case "suggest_quote_edits": {
      return JSON.stringify({ actions: args.actions, type: "quote_edits" });
    }
    case "create_soumission": {
      const payload = {
        status: "new",
        first_name: args.first_name || "Inconnu",
        last_name: args.last_name || "Client",
        email: args.email || "info@toituresvb.com",
        phone: args.phone || "000-000-0000",
        formatted_address: args.formatted_address || "",
        coverage_type: args.coverage_type || null,
        product_brand: args.product_brand || null,
        product_name: args.product_name || null,
        building_type: args.building_type || null,
        slope: args.slope || null,
        complexity: args.complexity || null,
        work_type: args.work_type || null,
        area_sqft: args.area_sqft || null,
        contact_preference: "email",
      };
      const { data: inserted, error: insertError } = await sb
        .from("soumissions")
        .insert(payload)
        .select("id, seq_number, reference_id")
        .single();
      if (insertError) return JSON.stringify({ error: insertError.message });
      return JSON.stringify({
        type: "soumission_created",
        soumission_id: inserted.id,
        reference_id: inserted.reference_id,
        seq_number: inserted.seq_number,
        client: `${payload.first_name} ${payload.last_name}`,
        address: payload.formatted_address,
        coverage: payload.coverage_type,
        product: [payload.product_brand, payload.product_name].filter(Boolean).join(" "),
        area: payload.area_sqft ? `${payload.area_sqft} pi²` : null,
      });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Non autorisé" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Session invalide" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { messages, context } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const systemPrompt = `Tu es un assistant copilote pour Toitures VB, intégré dans le générateur de soumissions admin. Tu aides l'administrateur à créer et modifier des soumissions de toiture.

Tu as accès à :
- Le catalogue de produits QuickBooks (bardeaux, matériaux)
- La liste des clients QuickBooks
- L'historique des soumissions
- La possibilité de suggérer des modifications aux postes du devis

Contexte actuel de la soumission en cours :
${context ? JSON.stringify(context) : 'Aucune soumission en cours'}

Règles :
- Réponds en français québécois, de manière professionnelle et concise
- Quand on te demande de modifier le devis, utilise l'outil suggest_quote_edits
- Quand on te demande des infos sur les produits, utilise search_products
- Quand on te demande des infos sur les clients, utilise search_clients
- Quand on te demande des infos sur les soumissions passées, utilise search_soumissions
- Formate les prix en dollars canadiens
- Ne fabrique pas de données, utilise toujours les outils pour chercher`;

    // Convert OpenAI-style tools to Anthropic format
    const anthropicTools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    // Convert messages: separate system from user/assistant, handle tool results
    const anthropicMessages: any[] = [];
    for (const m of messages) {
      if (m.role === 'system') continue; // system handled separately
      anthropicMessages.push({ role: m.role, content: m.content });
    }

    let conversationMessages = [...anthropicMessages];

    const MAX_ITERATIONS = 5;
    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: conversationMessages,
          tools: anthropicTools,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Trop de demandes, réessayez dans un moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (status === 402 || status === 400) {
          const t = await response.text();
          console.error("Anthropic error:", status, t);
          return new Response(JSON.stringify({ error: "Erreur du service IA" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const t = await response.text();
        console.error("Anthropic error:", status, t);
        return new Response(JSON.stringify({ error: "Erreur du service IA" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const result = await response.json();

      // Anthropic format: content is an array of blocks
      const contentBlocks = result.content || [];
      const toolUseBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");
      const textBlocks = contentBlocks.filter((b: any) => b.type === "text");

      // Add assistant message to conversation
      conversationMessages.push({ role: "assistant", content: contentBlocks });

      if (toolUseBlocks.length > 0) {
        // Execute tool calls and add results
        const toolResults: any[] = [];
        for (const tc of toolUseBlocks) {
          console.log(`Tool call: ${tc.name}`, tc.input);
          const toolResult = await executeTool(tc.name, tc.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: toolResult,
          });
        }
        conversationMessages.push({ role: "user", content: toolResults });

        if (result.stop_reason === "tool_use") {
          continue; // Let Claude process tool results
        }
      }

      // Extract text content
      const textContent = textBlocks.map((b: any) => b.text).join("\n");

      // Check if suggest_quote_edits or create_soumission was called
      let quoteEdits = null;
      let soumissionCreated = null;
      for (const msg of conversationMessages) {
        if (msg.role === "user" && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.content) {
              try {
                const parsed = JSON.parse(block.content);
                if (parsed.type === "quote_edits") {
                  quoteEdits = parsed.actions;
                }
                if (parsed.type === "soumission_created") {
                  soumissionCreated = parsed;
                }
              } catch {}
            }
          }
        }
      }

      return new Response(JSON.stringify({
        content: textContent || "",
        quote_edits: quoteEdits,
        soumission_created: soumissionCreated,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ content: "Désolé, la requête a pris trop de temps.", quote_edits: null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-copilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
