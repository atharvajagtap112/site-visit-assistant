import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";

export type LlmRequest = {
  system: string;
  contents: Content[];
  tools: FunctionDeclaration[];
};

export type LlmResponse = {
  /** Replayed unchanged within a turn: Gemini requires its thought signatures back. */
  content: Content | undefined;
  functionCalls: { id?: string; name?: string; args?: Record<string, unknown> }[];
  text: string;
};

export type Llm = (request: LlmRequest) => Promise<LlmResponse>;

// Tried in order, all on free tiers. A "groq:" prefix sends the call to Groq, anything else to Gemini.
// Chosen by running scripts/eval-chat.ts against real models. gpt-oss-20b is left out because it
// showed raw tool JSON to buyers. Gemini answered 403 for an unpaid balance, so it is only a backstop.
const MODELS = (
  process.env.CHAT_MODELS ?? "groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,gemini-3.1-flash-lite"
).split(",");
const MODEL_TIMEOUT_MS = 12_000;
const PASSES = 2;
const RETRY_PAUSE_MS = 1500;
const GROQ_PREFIX = "groq:";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Free-tier "busy" errors are usually brief, so go through the models twice before giving up. */
export async function tryModels<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  pauseMs = RETRY_PAUSE_MS,
): Promise<T> {
  let lastError: unknown;
  for (let pass = 0; pass < PASSES; pass++) {
    if (pass > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    for (const model of models) {
      try {
        return await call(model);
      } catch (error) {
        lastError = error;
        console.warn(`Model ${model} failed: ${(error as { status?: number }).status ?? "no status"}`);
      }
    }
  }
  throw lastError;
}

async function callGemini(model: string, { system, contents, tools }: LlmRequest): Promise<LlmResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: system,
      tools: [{ functionDeclarations: tools }],
      // The reply is short and the code checks it, so speed matters more than deliberation.
      thinkingConfig: { thinkingBudget: 0 },
      httpOptions: { timeout: MODEL_TIMEOUT_MS },
    },
  });
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return {
    content: response.candidates?.[0]?.content,
    functionCalls: response.functionCalls ?? [],
    text: parts
      .map((part) => part.text ?? "")
      .join("")
      .trim(),
  };
}

// A Gemini call may have no id, so both sides of a tool call fall back to its name.
const callId = (part: { id?: string; name?: string }) => part.id ?? part.name ?? "call";

/** The chat loop keeps history in Gemini's shape. This turns it into the shape Groq expects. */
export function toGroqMessages(system: string, contents: Content[]) {
  const messages: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const { role, parts = [] } of contents) {
    for (const { functionResponse } of parts) {
      if (functionResponse) {
        messages.push({
          role: "tool",
          tool_call_id: callId(functionResponse),
          content: JSON.stringify(functionResponse.response),
        });
      }
    }
    const text = parts.map((part) => part.text ?? "").join("");
    const calls = parts.flatMap(({ functionCall }) => (functionCall ? [functionCall] : []));
    if (role !== "model") {
      if (text) messages.push({ role: "user", content: text });
    } else if (text || calls.length) {
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length && {
          tool_calls: calls.map((call) => ({
            id: callId(call),
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
          })),
        }),
      });
    }
  }
  return messages;
}

/** Gemini writes schema types in capitals ("OBJECT"); standard JSON Schema uses lower case. */
function lowerCaseTypes(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(lowerCaseTypes);
  if (typeof schema !== "object" || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [
      key,
      key === "type" && typeof value === "string" ? value.toLowerCase() : lowerCaseTypes(value),
    ]),
  );
}

export const toGroqTools = (tools: FunctionDeclaration[]) =>
  tools.map(({ name, description, parameters }) => ({
    type: "function",
    function: { name, description, parameters: lowerCaseTypes(parameters) },
  }));

async function callGroq(model: string, { system, contents, tools }: LlmRequest): Promise<LlmResponse> {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: toGroqMessages(system, contents),
      tools: toGroqTools(tools),
      temperature: 0.2,
      max_completion_tokens: 1024,
      include_reasoning: false,
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) throw Object.assign(new Error(`Groq ${response.status}`), { status: response.status });

  const { message } = (await response.json()).choices[0];
  // Some models write their reasoning into the reply, and a buyer must never see that.
  const text = (message.content ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
  const functionCalls = (message.tool_calls ?? []).map(
    (call: { id: string; function: { name: string; arguments?: string } }) => ({
      id: call.id,
      name: call.function.name,
      args: JSON.parse(call.function.arguments || "{}"),
    }),
  );
  return {
    content: {
      role: "model",
      parts: [...(text ? [{ text }] : []), ...functionCalls.map((functionCall: object) => ({ functionCall }))],
    },
    functionCalls,
    text,
  };
}

export const chatModel: Llm = (request) =>
  tryModels(MODELS, (model) =>
    model.startsWith(GROQ_PREFIX) ? callGroq(model.slice(GROQ_PREFIX.length), request) : callGemini(model, request),
  );
