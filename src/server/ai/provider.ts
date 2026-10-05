import "server-only";
import OpenAI from "openai";

// OpenAI-compatible provider (Phase 9). Any endpoint speaking the OpenAI API
// works via OPENAI_BASE_URL. When no key is configured the app runs in
// rule-based mode — copilot.ts never calls the network in that case.

export interface AIConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export function aiConfig(): AIConfig | null {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: (process.env.OPENAI_MODEL ?? "").trim() || "gpt-4o-mini",
    baseURL: (process.env.OPENAI_BASE_URL ?? "").trim() || undefined,
  };
}

export function hasLLM(): boolean {
  return aiConfig() !== null;
}

export function openAIClient(): OpenAI {
  const cfg = aiConfig();
  if (!cfg) throw new Error("AI is not configured. Set OPENAI_API_KEY to enable the LLM copilot.");
  return new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: 30000, maxRetries: 1 });
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  tokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; args: string }[];
}

/** Single OpenAI chat call with function-calling. Guardrails: low temperature, capped tokens, hard timeout. */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
): Promise<ChatResult> {
  const cfg = aiConfig();
  if (!cfg) throw new Error("AI is not configured.");
  const client = openAIClient();
  const response = await client.chat.completions.create(
    {
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 1200,
      messages: messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId ?? "" };
        }
        if (m.role === "assistant" && m.toolCalls) {
          return {
            role: "assistant" as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((t) => ({
              id: t.id,
              type: "function" as const,
              function: { name: t.name, arguments: t.args },
            })),
          };
        }
        return { role: m.role as "system" | "user" | "assistant", content: m.content };
      }),
      tools: tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: "auto",
    },
    { signal: AbortSignal.timeout(45000) },
  );
  const choice = response.choices[0];
  const calls: ToolCall[] = (choice.message.tool_calls ?? []).map((c) => {
    if (c.type !== "function") throw new Error("Unexpected tool call type.");
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    return { id: c.id, name: c.function.name, args };
  });
  return {
    content: choice.message.content,
    toolCalls: calls,
    tokens: response.usage?.total_tokens ?? 0,
  };
}

/** JSON-mode call for structured outputs (daily brief). Returns parsed JSON. */
export async function chatJson(system: string, user: string): Promise<{ data: unknown; tokens: number }> {
  const cfg = aiConfig();
  if (!cfg) throw new Error("AI is not configured.");
  const client = openAIClient();
  const response = await client.chat.completions.create(
    {
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { signal: AbortSignal.timeout(60000) },
  );
  const text = response.choices[0].message.content ?? "{}";
  return { data: JSON.parse(text) as unknown, tokens: response.usage?.total_tokens ?? 0 };
}
