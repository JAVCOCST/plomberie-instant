import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cors, assertOrigin, getClientIp, checkRateLimit } from "../_shared/hardening.ts";
import { callAnthropicStream, anthropicToOpenAIStream } from "../_shared/anthropic-stream.ts";
import { fetchKnowledgeBlock, logExchange, runInBackground } from "../_shared/marieve.ts";

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = cors(origin, req.headers.get("access-control-request-headers"));

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (origin && origin !== "null" && !assertOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(req);
  if (ip !== "unknown" && !checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Trop de requêtes, réessayez dans 1 minute." }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  try {
    const { messages, context } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const systemPrompt = `Tu es Marie-Ève, conseillère en toiture chez Toitures VB. Tu réponds aux questions des clients sur leur soumission de toiture de manière amicale, professionnelle et concise (max 3-4 phrases). Tu parles en français québécois.

Contexte de la soumission du client:
${context ? JSON.stringify(context) : 'Aucun contexte disponible'}

Règles:
- Reste dans le sujet de la toiture et des services de Toitures VB
- Sois chaleureuse et rassurante
- Si tu ne sais pas, suggère de contacter l'équipe directement
- Ne donne jamais de prix différents de ceux de la soumission`;

    const knowledge = await fetchKnowledgeBlock("advisor");

    const response = await callAnthropicStream({
      apiKey: ANTHROPIC_API_KEY,
      model: "claude-haiku-4-5-20251001",
      system: systemPrompt + knowledge,
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
        source: "advisor",
        userMessage: lastUser?.content ?? "",
        assistantMessage: fullText,
        context,
      }));
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("advisor-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
