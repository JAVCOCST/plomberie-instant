import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAnthropicStream, anthropicToOpenAIStream } from "../_shared/anthropic-stream.ts";
import { fetchKnowledgeBlock, logExchange, runInBackground } from "../_shared/marieve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Tu es Marie-Ève, conseillère chez Toitures VB (Québec). Tu qualifies les demandes de réparation/inspection/construction de toiture.

RÈGLES CRITIQUES:
- Français québécois, ton pro mais chaleureux. Vouvoie par défaut.
- ULTRA CONCISE : 1 phrase d'intro MAX + 1 SEULE question par message.
- L'adresse est déjà connue, ne la redemande JAMAIS.
- Ne donne jamais de prix ni de délai. Un représentant confirmera après inspection.
- Si urgence (infiltration active), propose un appel rapide.
- IMPORTANT: Tu as accès à l'historique complet. Ne repose JAMAIS une question déjà répondue.
- Chaque question doit avoir 2 options maximum, JAMAIS 3 ou plus.
- PAS de longue intro, PAS de récapitulatif à chaque message. Va droit au but.

FORMAT OBLIGATOIRE:
1 phrase + 1 bloc $$CHOICES$$ avec UNE SEULE question et 2 options.

Exemple:
C'est noté ! Parlons de votre toit :

$$CHOICES$$[{"q":"Quel âge a votre toiture ?","opts":["Moins de 15 ans","Plus de 15 ans"]}]

SÉQUENCE (1 question par échange, 3-4 échanges max):
1. Nature/urgence du problème
2. Âge du toit
3. Disponibilité pour inspection
4. Résumé final SANS $$CHOICES$$ (2-3 lignes max)

GESTION DES DEMANDES HORS SUJET / CONVERSATION EN BOUCLE:
- Si le client demande à parler à quelqu'un, s'il pose des questions auxquelles tu ne peux pas répondre, ou si la conversation tourne en rond après 4+ échanges:
- Réponds poliment en lui expliquant qu'il peut cliquer sur le bouton « Texto » en bas de l'écran pour écrire directement à notre équipe.
- Ajoute le marqueur $$SMS_GLOW$$ à la fin de ta réponse (avant $$CHOICES$$ s'il y en a). Ce marqueur ne sera PAS affiché au client.
- Exemple: "Bien sûr ! Vous pouvez cliquer sur le bouton « Texto » en bas de l'écran pour écrire directement à notre équipe. $$SMS_GLOW$$"

INTERDICTIONS: pas de prix, pas d'adresse, pas de markdown, JAMAIS plus de 1 question par message, JAMAIS plus de 2 options par question, JAMAIS de longue intro.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, context } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const contextInfo = context
      ? `\n\nClient: ${context.firstName || 'Inconnu'}, Adresse: ${context.address || 'connue'}`
      : '';

    const knowledge = await fetchKnowledgeBlock("repair");

    const response = await callAnthropicStream({
      apiKey: ANTHROPIC_API_KEY,
      model: "claude-haiku-4-5-20251001",
      system: SYSTEM_PROMPT + contextInfo + knowledge,
      messages,
      maxTokens: 1024,
    });

    if (!response.ok || !response.body) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Trop de demandes, réessayez dans un moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Anthropic error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
    const stream = anthropicToOpenAIStream(response.body, (fullText) => {
      runInBackground(logExchange({
        source: "repair",
        userMessage: lastUser?.content ?? "",
        assistantMessage: fullText,
        context,
      }));
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("repair-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
