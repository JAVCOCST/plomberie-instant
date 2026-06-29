// Bridges Anthropic's Messages API to the OpenAI-style chat-completion SSE
// shape the client stream parsers already consume. Used by the customer-facing
// "Marie-Ève" chats (advisor-chat, repair-chat) after migrating off the Lovable
// AI gateway, so the frontend keeps working unchanged.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function callAnthropicStream(opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}): Promise<Response> {
  // Anthropic takes the system prompt as a top-level field, not as a message.
  const messages = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  return await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages,
      stream: true,
    }),
  });
}

// Converts Anthropic's SSE event stream into OpenAI-compatible chunks
// (`data: {"choices":[{"delta":{"content":"..."}}]}` then `data: [DONE]`).
// `onComplete`, if given, receives the full assembled assistant text once the
// stream closes — used to log the exchange without affecting what the client
// receives.
export function anthropicToOpenAIStream(
  anthropicBody: ReadableStream<Uint8Array>,
  onComplete?: (fullText: string) => void,
): ReadableStream<Uint8Array> {
  const reader = anthropicBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let fullText = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        if (onComplete) { try { onComplete(fullText); } catch { /* never break the stream */ } }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            fullText += evt.delta.text;
            const chunk = { choices: [{ delta: { content: evt.delta.text } }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        } catch {
          // Ignore keep-alive / non-JSON lines.
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
